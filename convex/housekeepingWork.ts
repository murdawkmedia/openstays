import { ConvexError, v } from 'convex/values';

import { normalizeDailyOperationsText } from '../shared/dailyOperations';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import {
  requireMutationPropertyCapability,
  requirePropertyCapability,
  requirePropertyFeature,
} from './staff';

const cleaningType = v.union(
  v.literal('turnover'),
  v.literal('stayover'),
  v.literal('inspection'),
  v.literal('deep_clean'),
  v.literal('custom'),
);
const checklistStatus = v.union(
  v.literal('pending'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('not_applicable'),
);
const inspectionResult = v.union(v.literal('passed'), v.literal('failed'));

async function replay<T extends Record<string, unknown>>(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  requestId: string,
  action: string,
): Promise<T | null> {
  const row = await ctx.db
    .query('operationRequests')
    .withIndex('by_property_request', (q) =>
      q.eq('propertyId', propertyId).eq('requestId', requestId),
    )
    .unique();
  if (!row) return null;
  if (row.action !== action) throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
  return JSON.parse(row.resultJson) as T;
}

function text(value: string, maxLength: number, required = false): string | undefined {
  try {
    const normalized = normalizeDailyOperationsText(value, maxLength);
    if (required && normalized.length === 0) throw new ConvexError('TEXT_REQUIRED');
    return normalized || undefined;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError('TEXT_TOO_LONG');
  }
}

function assignmentConflict(assignment: Doc<'housekeepingAssignments'>): never {
  throw new ConvexError({
    code: 'VERSION_CONFLICT',
    currentVersion: assignment.version,
    current: {
      status: assignment.status,
      assignedStaffProfileId: assignment.assignedStaffProfileId,
      priority: assignment.priority,
    },
  });
}

function serviceConflict(service: Doc<'unitServiceStates'> | null): never {
  throw new ConvexError({
    code: 'VERSION_CONFLICT',
    currentVersion: service?.version ?? 0,
    current: { state: service?.state ?? 'ready' },
  });
}

async function requireOwned(
  access: { role: string; profile: Doc<'staffProfiles'> },
  assignment: Doc<'housekeepingAssignments'>,
) {
  if (
    access.role === 'housekeeping' &&
    assignment.assignedStaffProfileId !== access.profile._id
  ) {
    throw new ConvexError('ASSIGNMENT_NOT_OWNED');
  }
}

async function validateAssignee(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  staffProfileId?: Id<'staffProfiles'>,
) {
  if (!staffProfileId) return;
  const [profile, assignment] = await Promise.all([
    ctx.db.get(staffProfileId),
    ctx.db.query('staffPropertyAssignments')
      .withIndex('by_profile_property', (q) =>
        q.eq('staffProfileId', staffProfileId).eq('propertyId', propertyId),
      )
      .unique(),
  ]);
  if (!profile?.active) throw new ConvexError('ASSIGNEE_UNAVAILABLE');
  if (!assignment?.active) throw new ConvexError('ASSIGNEE_PROPERTY_MISMATCH');
}

async function finish(
  ctx: MutationCtx,
  args: {
    propertyId: Id<'properties'>;
    requestId: string;
    action: string;
    actorUserId: Id<'users'>;
    actorName: string;
    assignmentId: Id<'housekeepingAssignments'>;
    detail: string;
    metadata?: Record<string, unknown>;
    result: Record<string, unknown>;
  },
) {
  const now = Date.now();
  await ctx.db.insert('operationRequests', {
    propertyId: args.propertyId,
    requestId: args.requestId,
    action: args.action,
    actorUserId: args.actorUserId,
    resultJson: JSON.stringify(args.result),
    createdAt: now,
  });
  await ctx.db.insert('auditLog', {
    actorUserId: args.actorUserId,
    actorName: args.actorName,
    propertyId: args.propertyId,
    action: args.action,
    detail: args.detail,
    entityType: 'housekeeping_assignment',
    entityId: args.assignmentId,
    requestId: args.requestId,
    metadataJson: args.metadata ? JSON.stringify(args.metadata) : undefined,
    ts: now,
  });
}

async function readService(
  ctx: MutationCtx,
  assignment: Doc<'housekeepingAssignments'>,
) {
  const service = await ctx.db
    .query('unitServiceStates')
    .withIndex('by_unit', (q) => q.eq('unitId', assignment.unitId))
    .unique();
  if (service && service.propertyId !== assignment.propertyId) {
    throw new ConvexError('PROPERTY_RECORD_MISMATCH');
  }
  return service;
}

async function writeService(
  ctx: MutationCtx,
  args: {
    assignment: Doc<'housekeepingAssignments'>;
    current: Doc<'unitServiceStates'> | null;
    expectedVersion: number;
    state: 'ready' | 'dirty' | 'cleaning' | 'inspection' | 'do_not_disturb' | 'out_of_service';
    userId: Id<'users'>;
    now: number;
  },
) {
  const version = args.current?.version ?? 0;
  if (version !== args.expectedVersion) serviceConflict(args.current);
  const nextVersion = version + 1;
  if (args.current) {
    await ctx.db.patch(args.current._id, {
      state: args.state,
      version: nextVersion,
      updatedBy: args.userId,
      updatedAt: args.now,
    });
  } else {
    await ctx.db.insert('unitServiceStates', {
      propertyId: args.assignment.propertyId,
      unitId: args.assignment.unitId,
      state: args.state,
      version: nextVersion,
      updatedBy: args.userId,
      updatedAt: args.now,
    });
  }
  return nextVersion;
}

export const listAssignments = query({
  args: { propertyId: v.id('properties'), serviceDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'housekeeping.read');
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping');
    const assignments = await ctx.db.query('housekeepingAssignments')
      .withIndex('by_property_date', (q) =>
        q.eq('propertyId', args.propertyId).eq('serviceDate', args.serviceDate),
      )
      .collect();
    const checklistFeature = await ctx.db.query('propertyFeatures')
      .withIndex('by_property_feature', (q) =>
        q.eq('propertyId', args.propertyId).eq('feature', 'housekeeping_checklists'),
      )
      .unique();
    const result = [];
    for (const assignment of assignments) {
      const [unit, profile, items, service] = await Promise.all([
        ctx.db.get(assignment.unitId),
        assignment.assignedStaffProfileId ? ctx.db.get(assignment.assignedStaffProfileId) : null,
        checklistFeature?.enabled
          ? ctx.db.query('housekeepingChecklistItems')
              .withIndex('by_assignment_order', (q) => q.eq('assignmentId', assignment._id))
              .collect()
          : Promise.resolve([]),
        ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', assignment.unitId)).unique(),
      ]);
      result.push({
        ...assignment,
        unitName: unit?.name ?? 'Unknown unit',
        assigneeName: profile?.name,
        checklist: items,
        serviceState: service?.state ?? 'ready',
        serviceVersion: service?.version ?? 0,
      });
    }
    return result.sort((left, right) =>
      left.priority - right.priority || left.unitName.localeCompare(right.unitName),
    );
  },
});

export const audit = query({
  args: {
    propertyId: v.id('properties'),
    from: v.string(),
    to: v.string(),
    unitId: v.optional(v.id('units')),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    cleaningType: v.optional(cleaningType),
    inspectionResult: v.optional(inspectionResult),
  },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'housekeeping.read');
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping');
    const assignments = await ctx.db.query('housekeepingAssignments')
      .withIndex('by_property_date', (q) =>
        q.eq('propertyId', args.propertyId)
          .gte('serviceDate', args.from)
          .lte('serviceDate', args.to),
      )
      .collect();
    const filtered = assignments.filter((row) =>
      (args.unitId === undefined || row.unitId === args.unitId) &&
      (args.assignedStaffProfileId === undefined || row.assignedStaffProfileId === args.assignedStaffProfileId) &&
      (args.cleaningType === undefined || row.cleaningType === args.cleaningType) &&
      (args.inspectionResult === undefined || row.inspectionResult === args.inspectionResult),
    );
    const auditRows = await ctx.db.query('auditLog')
      .withIndex('by_property_ts', (q) => q.eq('propertyId', args.propertyId))
      .order('desc')
      .take(500);
    return await Promise.all(filtered.map(async (assignment) => {
      const [unit, profile] = await Promise.all([
        ctx.db.get(assignment.unitId),
        assignment.assignedStaffProfileId ? ctx.db.get(assignment.assignedStaffProfileId) : null,
      ]);
      return {
        ...assignment,
        unitName: unit?.name ?? 'Unknown unit',
        assigneeName: profile?.name,
        actualMinutes: assignment.startedAt && (assignment.verifiedAt ?? assignment.completedAt)
          ? Math.max(0, Math.round(((assignment.verifiedAt ?? assignment.completedAt)! - assignment.startedAt) / 60_000))
          : undefined,
        events: auditRows
          .filter((event) => event.entityType === 'housekeeping_assignment' && event.entityId === assignment._id)
          .map(({ actorName, action, detail, ts }) => ({ actorName, action, detail, ts })),
      };
    }));
  },
});

export const updateAssignment = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    priority: v.number(),
    cleaningType,
    customCleaningLabel: v.optional(v.string()),
    expectedMinutes: v.number(),
    assignmentNote: v.optional(v.string()),
    expectedVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.assignment.update';
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, 'housekeeping.verify', action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<{ assignmentId: Id<'housekeepingAssignments'>; version: number }>(
      ctx, args.propertyId, args.requestId, action,
    );
    if (previous) return { ...previous, replayed: true };
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (assignment.version !== args.expectedVersion) assignmentConflict(assignment);
    if (assignment.status === 'verified' || assignment.status === 'cancelled') throw new ConvexError('ASSIGNMENT_CLOSED');
    if (!Number.isInteger(args.priority) || args.priority < 0 || args.priority > 100) throw new ConvexError('INVALID_PRIORITY');
    if (!Number.isInteger(args.expectedMinutes) || args.expectedMinutes < 5 || args.expectedMinutes > 480) throw new ConvexError('INVALID_EXPECTED_MINUTES');
    const customCleaningLabel = args.cleaningType === 'custom'
      ? text(args.customCleaningLabel ?? '', 80, true)
      : undefined;
    const assignmentNote = args.assignmentNote === undefined
      ? undefined
      : text(args.assignmentNote, 1_000);
    await validateAssignee(ctx, args.propertyId, args.assignedStaffProfileId);
    const version = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      assignedStaffProfileId: args.assignedStaffProfileId,
      priority: args.priority,
      cleaningType: args.cleaningType,
      customCleaningLabel,
      expectedMinutes: args.expectedMinutes,
      assignmentNote,
      version,
      updatedAt: Date.now(),
    });
    const result = { assignmentId: assignment._id, version };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: 'updated housekeeping assignment', result,
    });
    return { ...result, replayed: false };
  },
});

export const start = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    expectedAssignmentVersion: v.number(),
    expectedServiceVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.assignment.start';
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, 'housekeeping.checklist.update', action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<Record<string, unknown>>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    await requireOwned(access, assignment);
    if (assignment.version !== args.expectedAssignmentVersion) assignmentConflict(assignment);
    if (assignment.status !== 'assigned') throw new ConvexError('ASSIGNMENT_NOT_ASSIGNED');
    const service = await readService(ctx, assignment);
    if (service?.state === 'out_of_service') throw new ConvexError('UNIT_OUT_OF_SERVICE');
    const now = Date.now();
    const serviceVersion = await writeService(ctx, {
      assignment, current: service, expectedVersion: args.expectedServiceVersion,
      state: 'cleaning', userId: access.userId, now,
    });
    const assignmentVersion = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      status: 'in_progress',
      startedAt: assignment.startedAt ?? now,
      version: assignmentVersion,
      updatedAt: now,
    });
    const result = {
      assignmentId: assignment._id,
      assignmentStatus: 'in_progress',
      assignmentVersion,
      serviceState: 'cleaning',
      serviceVersion,
    };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: 'started housekeeping assignment', result,
    });
    return { ...result, replayed: false };
  },
});

export const updateChecklistItem = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    itemId: v.id('housekeepingChecklistItems'),
    status: checklistStatus,
    note: v.optional(v.string()),
    expectedItemVersion: v.number(),
    expectedAssignmentVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.checklist.item';
    const [assignment, item] = await Promise.all([
      ctx.db.get(args.assignmentId),
      ctx.db.get(args.itemId),
    ]);
    if (
      !assignment || !item ||
      assignment.propertyId !== args.propertyId ||
      item.propertyId !== args.propertyId ||
      item.assignmentId !== assignment._id
    ) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const capability = item.required && args.status === 'not_applicable'
      ? 'housekeeping.verify' as const
      : 'housekeeping.checklist.update' as const;
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, capability, action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<Record<string, unknown>>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    await requireOwned(access, assignment);
    if (assignment.version !== args.expectedAssignmentVersion) assignmentConflict(assignment);
    if (item.version !== args.expectedItemVersion) {
      throw new ConvexError({
        code: 'VERSION_CONFLICT',
        currentVersion: item.version,
        current: { status: item.status },
      });
    }
    if (assignment.status !== 'assigned' && assignment.status !== 'in_progress') {
      throw new ConvexError('ASSIGNMENT_NOT_EDITABLE');
    }
    const note = args.note === undefined ? undefined : text(args.note, 500);
    if (item.required && args.status === 'not_applicable' && !note) {
      throw new ConvexError('OVERRIDE_REASON_REQUIRED');
    }
    const now = Date.now();
    const itemVersion = item.version + 1;
    const assignmentVersion = assignment.version + 1;
    await ctx.db.patch(item._id, {
      status: args.status,
      note,
      version: itemVersion,
      updatedBy: access.userId,
      updatedAt: now,
      completedAt: args.status === 'completed' || args.status === 'not_applicable' ? now : undefined,
    });
    await ctx.db.patch(assignment._id, { version: assignmentVersion, updatedAt: now });
    const result = { assignmentId: assignment._id, assignmentVersion, itemId: item._id, itemVersion, status: args.status };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: `updated checklist item ${item.itemKey}`,
      metadata: { itemKey: item.itemKey, status: args.status, required: item.required }, result,
    });
    return { ...result, replayed: false };
  },
});

export const submitForInspection = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    expectedAssignmentVersion: v.number(),
    expectedServiceVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.inspection.submit';
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, 'housekeeping.checklist.update', action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<Record<string, unknown>>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    await requireOwned(access, assignment);
    if (assignment.version !== args.expectedAssignmentVersion) assignmentConflict(assignment);
    if (assignment.status !== 'in_progress') throw new ConvexError('ASSIGNMENT_NOT_IN_PROGRESS');
    const items = await ctx.db.query('housekeepingChecklistItems')
      .withIndex('by_assignment_order', (q) => q.eq('assignmentId', assignment._id))
      .collect();
    if (items.length === 0) throw new ConvexError('CHECKLIST_NOT_ATTACHED');
    if (items.some((item) => item.required && !['completed', 'not_applicable'].includes(item.status))) {
      throw new ConvexError('REQUIRED_CHECKLIST_INCOMPLETE');
    }
    if (items.some((item) => item.status === 'failed')) throw new ConvexError('CHECKLIST_HAS_FAILURES');
    const service = await readService(ctx, assignment);
    const now = Date.now();
    const serviceVersion = await writeService(ctx, {
      assignment, current: service, expectedVersion: args.expectedServiceVersion,
      state: 'inspection', userId: access.userId, now,
    });
    const assignmentVersion = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      status: 'ready_for_inspection',
      completedAt: now,
      version: assignmentVersion,
      updatedAt: now,
    });
    const result = {
      assignmentId: assignment._id,
      assignmentStatus: 'ready_for_inspection',
      assignmentVersion,
      serviceState: 'inspection',
      serviceVersion,
    };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: 'submitted housekeeping assignment for inspection', result,
    });
    return { ...result, replayed: false };
  },
});

export const reviewInspection = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    outcome: inspectionResult,
    note: v.optional(v.string()),
    expectedAssignmentVersion: v.number(),
    expectedServiceVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.inspection.review';
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, 'housekeeping.verify', action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<Record<string, unknown>>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (assignment.version !== args.expectedAssignmentVersion) assignmentConflict(assignment);
    if (assignment.status !== 'ready_for_inspection') throw new ConvexError('ASSIGNMENT_NOT_READY_FOR_INSPECTION');
    const note = args.note === undefined ? undefined : text(args.note, 500);
    if (args.outcome === 'failed' && !note) throw new ConvexError('INSPECTION_NOTE_REQUIRED');
    const service = await readService(ctx, assignment);
    const now = Date.now();
    const serviceState = args.outcome === 'passed' ? 'ready' as const : 'cleaning' as const;
    const serviceVersion = await writeService(ctx, {
      assignment, current: service, expectedVersion: args.expectedServiceVersion,
      state: serviceState, userId: access.userId, now,
    });
    const assignmentStatus = args.outcome === 'passed' ? 'verified' as const : 'in_progress' as const;
    const assignmentVersion = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      status: assignmentStatus,
      inspectionResult: args.outcome,
      inspectionNote: note,
      completedAt: args.outcome === 'passed' ? assignment.completedAt ?? now : undefined,
      verifiedAt: args.outcome === 'passed' ? now : undefined,
      verifiedBy: args.outcome === 'passed' ? access.userId : undefined,
      version: assignmentVersion,
      updatedAt: now,
    });
    const result = {
      assignmentId: assignment._id,
      assignmentStatus,
      assignmentVersion,
      serviceState,
      serviceVersion,
    };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: `${args.outcome} housekeeping inspection`,
      metadata: { outcome: args.outcome }, result,
    });
    return { ...result, replayed: false };
  },
});

export const cancel = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    expectedVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.assignment.cancel';
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, 'housekeeping.verify', action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<Record<string, unknown>>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (assignment.version !== args.expectedVersion) assignmentConflict(assignment);
    if (assignment.status === 'verified' || assignment.status === 'cancelled') throw new ConvexError('ASSIGNMENT_CLOSED');
    const version = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      status: 'cancelled',
      cancelledBy: access.userId,
      version,
      updatedAt: Date.now(),
    });
    const result = { assignmentId: assignment._id, assignmentStatus: 'cancelled', version };
    await finish(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action,
      actorUserId: access.userId, actorName: access.profile.name,
      assignmentId: assignment._id, detail: 'cancelled housekeeping assignment', result,
    });
    return { ...result, replayed: false };
  },
});
