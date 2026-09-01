import { ConvexError, v } from 'convex/values';

import {
  RESTRICTED_FLAG_KINDS,
  normalizeDailyOperationsText,
  type BookingOperationalFlagKind,
  type RestrictedFlagKind,
} from '../shared/dailyOperations';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import {
  requireMutationPropertyCapability,
  requirePropertyCapability,
  requirePropertyFeature,
} from './staff';

const flagKind = v.union(
  v.literal('late_checkout'),
  v.literal('due_out'),
  v.literal('departure_overdue'),
  v.literal('lockout'),
  v.literal('sleep_out'),
  v.literal('payment_concern'),
);
const flagSeverity = v.union(v.literal('info'), v.literal('attention'), v.literal('urgent'));

type OperationResult = Record<string, unknown>;

async function replay<T extends OperationResult>(
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

function normalize(value: string, maxLength: number, required = false): string | undefined {
  try {
    const result = normalizeDailyOperationsText(value, maxLength);
    if (required && result.length === 0) throw new ConvexError('TEXT_REQUIRED');
    return result || undefined;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError('TEXT_TOO_LONG');
  }
}

function requiredCapability(kind: BookingOperationalFlagKind) {
  return RESTRICTED_FLAG_KINDS.includes(kind as RestrictedFlagKind)
    ? 'front_desk.restricted_flag.write' as const
    : 'front_desk.flag.write' as const;
}

async function validateAssignee(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  staffProfileId?: Id<'staffProfiles'>,
) {
  if (!staffProfileId) return;
  const [profile, assignment] = await Promise.all([
    ctx.db.get(staffProfileId),
    ctx.db
      .query('staffPropertyAssignments')
      .withIndex('by_profile_property', (q) =>
        q.eq('staffProfileId', staffProfileId).eq('propertyId', propertyId),
      )
      .unique(),
  ]);
  if (!profile?.active) throw new ConvexError('ASSIGNEE_UNAVAILABLE');
  if (!assignment?.active) throw new ConvexError('ASSIGNEE_PROPERTY_MISMATCH');
}

function throwVersionConflict(flag: Doc<'bookingOperationalFlags'>): never {
  throw new ConvexError({
    code: 'VERSION_CONFLICT',
    currentVersion: flag.version,
    current: {
      state: flag.state,
      severity: flag.severity,
      assignedStaffProfileId: flag.assignedStaffProfileId,
    },
  });
}

async function finish(
  ctx: MutationCtx,
  args: {
    propertyId: Id<'properties'>;
    requestId: string;
    action: string;
    actorUserId: Id<'users'>;
    actorName: string;
    flagId: Id<'bookingOperationalFlags'>;
    detail: string;
    metadata: Record<string, unknown>;
    result: OperationResult;
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
    entityType: 'booking_operational_flag',
    entityId: args.flagId,
    requestId: args.requestId,
    metadataJson: JSON.stringify(args.metadata),
    ts: now,
  });
}

export const listForDate = query({
  args: { propertyId: v.id('properties'), businessDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk_exceptions');
    const rows = await ctx.db
      .query('bookingOperationalFlags')
      .withIndex('by_property_state', (q) =>
        q.eq('propertyId', args.propertyId).eq('state', 'open'),
      )
      .collect();
    const result = [];
    for (const row of rows) {
      const booking = await ctx.db.get(row.bookingId);
      if (!booking || booking.propertyId !== args.propertyId) continue;
      if (
        booking.checkIn > args.businessDate ||
        booking.checkOut < args.businessDate
      ) continue;
      result.push({
        flagId: row._id,
        bookingId: row.bookingId,
        unitId: row.unitId,
        kind: row.kind,
        severity: row.severity,
        summary: row.summary,
        dueAt: row.dueAt,
        assignedStaffProfileId: row.assignedStaffProfileId,
        version: row.version,
      });
    }
    return result;
  },
});

export const create = mutation({
  args: {
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    kind: flagKind,
    severity: flagSeverity,
    summary: v.string(),
    note: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    expectedBookingVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'front_desk.flag.create';
    const access = await requireMutationPropertyCapability(
      ctx,
      args.propertyId,
      requiredCapability(args.kind),
      action,
      args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk_exceptions');
    const previous = await replay<{
      flagId: Id<'bookingOperationalFlags'>;
      state: 'open';
      version: number;
      existingOpen: boolean;
    }>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.propertyId !== args.propertyId) {
      throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    if ((booking.version ?? 0) !== args.expectedBookingVersion) {
      throw new ConvexError({
        code: 'VERSION_CONFLICT',
        currentVersion: booking.version ?? 0,
        current: { status: booking.status },
      });
    }
    if (args.dueAt !== undefined && (!Number.isFinite(args.dueAt) || args.dueAt <= 0)) {
      throw new ConvexError('INVALID_DUE_AT');
    }
    await validateAssignee(ctx, args.propertyId, args.assignedStaffProfileId);
    const summary = normalize(args.summary, 120, true)!;
    const note = args.note === undefined ? undefined : normalize(args.note, 1_000);
    const open = await ctx.db
      .query('bookingOperationalFlags')
      .withIndex('by_booking_state', (q) =>
        q.eq('bookingId', booking._id).eq('state', 'open'),
      )
      .collect();
    const existing = open.find((row) => row.kind === args.kind);
    if (existing) {
      const result = {
        flagId: existing._id,
        state: 'open' as const,
        version: existing.version,
        existingOpen: true,
      };
      await finish(ctx, {
        propertyId: args.propertyId,
        requestId: args.requestId,
        action,
        actorUserId: access.userId,
        actorName: access.profile.name,
        flagId: existing._id,
        detail: `reused open ${args.kind} flag`,
        metadata: { kind: args.kind, existingOpen: true },
        result,
      });
      return { ...result, replayed: false };
    }
    const now = Date.now();
    const flagId = await ctx.db.insert('bookingOperationalFlags', {
      propertyId: args.propertyId,
      bookingId: booking._id,
      unitId: booking.unitId,
      kind: args.kind,
      severity: args.severity,
      state: 'open',
      summary,
      note,
      dueAt: args.dueAt,
      assignedStaffProfileId: args.assignedStaffProfileId,
      version: 0,
      createdBy: access.userId,
      createdAt: now,
      updatedBy: access.userId,
      updatedAt: now,
    });
    const result = { flagId, state: 'open' as const, version: 0, existingOpen: false };
    await finish(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action,
      actorUserId: access.userId,
      actorName: access.profile.name,
      flagId,
      detail: `created ${args.kind} flag`,
      metadata: { kind: args.kind, severity: args.severity },
      result,
    });
    return { ...result, replayed: false };
  },
});

export const assign = mutation({
  args: {
    propertyId: v.id('properties'),
    flagId: v.id('bookingOperationalFlags'),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    expectedVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'front_desk.flag.assign';
    const flag = await ctx.db.get(args.flagId);
    if (!flag || flag.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, requiredCapability(flag.kind), action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk_exceptions');
    const previous = await replay<{ flagId: Id<'bookingOperationalFlags'>; version: number }>(
      ctx, args.propertyId, args.requestId, action,
    );
    if (previous) return { ...previous, replayed: true };
    if (flag.state !== 'open') throw new ConvexError('FLAG_NOT_OPEN');
    if (flag.version !== args.expectedVersion) throwVersionConflict(flag);
    await validateAssignee(ctx, args.propertyId, args.assignedStaffProfileId);
    const version = flag.version + 1;
    await ctx.db.patch(flag._id, {
      assignedStaffProfileId: args.assignedStaffProfileId,
      version,
      updatedBy: access.userId,
      updatedAt: Date.now(),
    });
    const result = { flagId: flag._id, version };
    await finish(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action,
      actorUserId: access.userId,
      actorName: access.profile.name,
      flagId: flag._id,
      detail: `assigned ${flag.kind} flag`,
      metadata: { kind: flag.kind, assigned: args.assignedStaffProfileId !== undefined },
      result,
    });
    return { ...result, replayed: false };
  },
});

export const resolve = mutation({
  args: {
    propertyId: v.id('properties'),
    flagId: v.id('bookingOperationalFlags'),
    expectedVersion: v.number(),
    resolutionNote: v.optional(v.string()),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'front_desk.flag.resolve';
    const flag = await ctx.db.get(args.flagId);
    if (!flag || flag.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const access = await requireMutationPropertyCapability(
      ctx, args.propertyId, requiredCapability(flag.kind), action, args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk_exceptions');
    const previous = await replay<{
      flagId: Id<'bookingOperationalFlags'>;
      state: 'resolved';
      version: number;
    }>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    if (flag.state !== 'open') throw new ConvexError('FLAG_NOT_OPEN');
    if (flag.version !== args.expectedVersion) throwVersionConflict(flag);
    const resolutionNote = args.resolutionNote === undefined
      ? undefined
      : normalize(args.resolutionNote, 500);
    const now = Date.now();
    const version = flag.version + 1;
    await ctx.db.patch(flag._id, {
      state: 'resolved',
      version,
      resolutionNote,
      resolvedBy: access.userId,
      resolvedAt: now,
      updatedBy: access.userId,
      updatedAt: now,
    });
    const result = { flagId: flag._id, state: 'resolved' as const, version };
    await finish(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action,
      actorUserId: access.userId,
      actorName: access.profile.name,
      flagId: flag._id,
      detail: `resolved ${flag.kind} flag`,
      metadata: { kind: flag.kind },
      result,
    });
    return { ...result, replayed: false };
  },
});
