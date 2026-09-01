import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { markPropertyDirtyInline } from './channel/ari';
import { requireMutationPropertyCapability, requirePropertyCapability, requirePropertyFeature } from './staff';

type ServiceState = 'ready' | 'dirty' | 'cleaning' | 'inspection' | 'do_not_disturb' | 'out_of_service';
const TRANSITIONS: Record<ServiceState, readonly ServiceState[]> = {
  ready: ['dirty', 'do_not_disturb', 'out_of_service'],
  dirty: ['cleaning', 'do_not_disturb', 'out_of_service'],
  cleaning: ['inspection', 'out_of_service'],
  inspection: ['ready', 'cleaning', 'out_of_service'],
  do_not_disturb: ['dirty', 'ready', 'out_of_service'],
  out_of_service: ['dirty'],
};

async function replay<T>(ctx: MutationCtx, propertyId: Id<'properties'>, requestId: string, action: string): Promise<T | null> {
  const row = await ctx.db.query('operationRequests').withIndex('by_property_request', (q) => q.eq('propertyId', propertyId).eq('requestId', requestId)).unique();
  if (!row) return null;
  if (row.action !== action) throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
  return JSON.parse(row.resultJson) as T;
}

async function finish(ctx: MutationCtx, args: { propertyId: Id<'properties'>; requestId: string; action: string; userId: Id<'users'>; name: string; entityType: string; entityId: string; detail: string; result: unknown }) {
  const now = Date.now();
  await ctx.db.insert('operationRequests', { propertyId: args.propertyId, requestId: args.requestId, action: args.action, actorUserId: args.userId, resultJson: JSON.stringify(args.result), createdAt: now });
  await ctx.db.insert('auditLog', { actorUserId: args.userId, actorName: args.name, propertyId: args.propertyId, action: args.action, detail: args.detail, entityType: args.entityType, entityId: args.entityId, requestId: args.requestId, ts: now });
}

export async function buildHousekeepingBoard(ctx: QueryCtx, args: { propertyId: Id<'properties'>; serviceDate: string }) {
    const units = await ctx.db.query('units').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).take(200);
    const assignments = await ctx.db.query('housekeepingAssignments').withIndex('by_property_date', (q) => q.eq('propertyId', args.propertyId).eq('serviceDate', args.serviceDate)).collect();
    const checklistFeature = await ctx.db.query('propertyFeatures').withIndex('by_property_feature', (q) => q.eq('propertyId', args.propertyId).eq('feature', 'housekeeping_checklists')).unique();
    const result = [];
    for (const unit of units) {
      const state = await ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', unit._id)).unique();
      const assignment = assignments.find((row) => row.unitId === unit._id);
      const unitType = await ctx.db.get(unit.unitTypeId);
      const groupMembers = await ctx.db.query('unitGroupMembers').withIndex('by_unit', (q) => q.eq('unitId', unit._id)).collect();
      const unitGroups = [];
      for (const member of groupMembers) {
        if (member.propertyId !== args.propertyId) continue;
        const group = await ctx.db.get(member.unitGroupId);
        if (group?.propertyId === args.propertyId && group.active) unitGroups.push({ unitGroupId: group._id, name: group.name });
      }
      const checklistItems = checklistFeature?.enabled && assignment
        ? await ctx.db.query('housekeepingChecklistItems').withIndex('by_assignment_order', (q) => q.eq('assignmentId', assignment._id)).collect()
        : [];
      const completed = checklistItems.filter((item) => item.status === 'completed').length;
      const requiredRemaining = checklistItems.filter((item) => item.required && !['completed', 'not_applicable'].includes(item.status)).length;
      const unitAssignments = await ctx.db.query('housekeepingAssignments').withIndex('by_unit_date', (q) => q.eq('unitId', unit._id)).collect();
      const lastCleanedAt = unitAssignments.reduce<number | undefined>((latest, row) => {
        if (!row.verifiedAt) return latest;
        return latest === undefined || row.verifiedAt > latest ? row.verifiedAt : latest;
      }, undefined);
      result.push({
        unitId: unit._id, unitName: unit.name, sellableStatus: unit.status,
        unitTypeId: unit.unitTypeId, unitTypeName: unitType?.propertyId === args.propertyId ? unitType.name : 'Unknown type',
        unitGroups,
        state: state?.state ?? 'ready', stateVersion: state?.version ?? 0,
        assignmentId: assignment?._id, assignedStaffProfileId: assignment?.assignedStaffProfileId,
        assignmentStatus: assignment?.status, priority: assignment?.priority,
        cleaningType: assignment?.cleaningType,
        expectedMinutes: assignment?.expectedMinutes,
        assignmentVersion: assignment?.version,
        checklist: { completed, total: checklistItems.length, requiredRemaining },
        lastCleanedAt,
      });
    }
    return { serviceDate: args.serviceDate, units: result };
}

export const board = query({
  args: { propertyId: v.id('properties'), serviceDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'housekeeping.read');
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping');
    return await buildHousekeepingBoard(ctx, args);
  },
});

export const assign = mutation({
  args: {
    propertyId: v.id('properties'), unitId: v.id('units'), serviceDate: v.string(),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')), priority: v.number(),
    cleaningType: v.optional(v.union(v.literal('turnover'), v.literal('stayover'), v.literal('inspection'), v.literal('deep_clean'), v.literal('custom'))),
    customCleaningLabel: v.optional(v.string()), expectedMinutes: v.optional(v.number()),
    assignmentNote: v.optional(v.string()), expectedVersion: v.optional(v.number()),
    requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'housekeeping.assign', 'housekeeping.assign', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping');
    const previous = await replay<{ assignmentId: Id<'housekeepingAssignments'> }>(ctx, args.propertyId, args.requestId, 'housekeeping.assign');
    if (previous) return { ...previous, replayed: true };
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (args.assignedStaffProfileId) {
      const profile = await ctx.db.get(args.assignedStaffProfileId);
      if (!profile?.active) throw new ConvexError('ASSIGNEE_UNAVAILABLE');
    }
    const existing = await ctx.db.query('housekeepingAssignments').withIndex('by_unit_date', (q) => q.eq('unitId', args.unitId).eq('serviceDate', args.serviceDate)).unique();
    if (args.expectedMinutes !== undefined && (!Number.isInteger(args.expectedMinutes) || args.expectedMinutes < 5 || args.expectedMinutes > 480)) throw new ConvexError('INVALID_EXPECTED_MINUTES');
    const customCleaningLabel = args.customCleaningLabel?.trim() || undefined;
    if (args.cleaningType === 'custom' && !customCleaningLabel) throw new ConvexError('CUSTOM_CLEANING_LABEL_REQUIRED');
    const assignmentNote = args.assignmentNote?.trim() || undefined;
    const now = Date.now();
    let assignmentId: Id<'housekeepingAssignments'>;
    if (existing) {
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${existing.version}`);
      if (existing.status === 'verified' || existing.status === 'cancelled') throw new ConvexError('ASSIGNMENT_CLOSED');
      assignmentId = existing._id;
      await ctx.db.patch(existing._id, {
        assignedStaffProfileId: args.assignedStaffProfileId, priority: args.priority,
        cleaningType: args.cleaningType ?? existing.cleaningType,
        customCleaningLabel: args.cleaningType === 'custom' ? customCleaningLabel : args.cleaningType ? undefined : existing.customCleaningLabel,
        expectedMinutes: args.expectedMinutes ?? existing.expectedMinutes,
        assignmentNote: args.assignmentNote === undefined ? existing.assignmentNote : assignmentNote,
        version: existing.version + 1, updatedAt: now,
      });
    } else {
      if (args.expectedVersion !== undefined && args.expectedVersion !== 0) throw new ConvexError('VERSION_CONFLICT:0');
      assignmentId = await ctx.db.insert('housekeepingAssignments', {
        propertyId: args.propertyId, unitId: args.unitId, serviceDate: args.serviceDate,
        assignedStaffProfileId: args.assignedStaffProfileId, priority: args.priority, status: 'assigned',
        cleaningType: args.cleaningType ?? 'turnover', customCleaningLabel,
        expectedMinutes: args.expectedMinutes ?? 45, assignmentNote,
        version: 0, createdBy: access.userId, createdAt: now, updatedAt: now,
      });
    }
    const result = { assignmentId };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'housekeeping.assign', userId: access.userId, name: access.profile.name, entityType: 'housekeeping_assignment', entityId: assignmentId, detail: `assigned housekeeping for ${unit.name}`, result });
    return { ...result, replayed: false };
  },
});

export const transitionState = mutation({
  args: { propertyId: v.id('properties'), unitId: v.id('units'), state: v.union(v.literal('ready'), v.literal('dirty'), v.literal('cleaning'), v.literal('inspection'), v.literal('do_not_disturb'), v.literal('out_of_service')), expectedVersion: v.number(), note: v.optional(v.string()), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'housekeeping.update', 'housekeeping.state.transition', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping');
    const previous = await replay<{ state: ServiceState; version: number }>(ctx, args.propertyId, args.requestId, 'housekeeping.state.transition');
    if (previous) return { ...previous, replayed: true };
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const current = await ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', args.unitId)).unique();
    const currentState: ServiceState = current?.state ?? 'ready';
    const version = current?.version ?? 0;
    if (version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${version}`);
    if (!TRANSITIONS[currentState].includes(args.state)) throw new ConvexError(`INVALID_SERVICE_TRANSITION:${currentState}:${args.state}`);
    const nextVersion = version + 1;
    if (current) await ctx.db.patch(current._id, { state: args.state, note: args.note?.trim() || undefined, version: nextVersion, updatedBy: access.userId, updatedAt: Date.now() });
    else await ctx.db.insert('unitServiceStates', { propertyId: args.propertyId, unitId: args.unitId, state: args.state, note: args.note?.trim() || undefined, version: nextVersion, updatedBy: access.userId, updatedAt: Date.now() });
    const result = { state: args.state, version: nextVersion };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'housekeeping.state.transition', userId: access.userId, name: access.profile.name, entityType: 'unit_service_state', entityId: args.unitId, detail: `${unit.name}: ${currentState} to ${args.state}`, result });
    return { ...result, replayed: false };
  },
});

export const maintenanceBoard = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'maintenance.read');
    await requirePropertyFeature(ctx, args.propertyId, 'maintenance');
    const tasks = await ctx.db.query('maintenanceTasks').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect();
    return await Promise.all(tasks.map(async (task) => ({ ...task, unitName: (await ctx.db.get(task.unitId))?.name ?? 'Unknown unit' })));
  },
});

export const resolveMaintenance = mutation({
  args: { propertyId: v.id('properties'), maintenanceTaskId: v.id('maintenanceTasks'), expectedVersion: v.number(), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'maintenance.write', 'maintenance.resolve', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'maintenance');
    const previous = await replay<{ maintenanceTaskId: Id<'maintenanceTasks'>; version: number }>(ctx, args.propertyId, args.requestId, 'maintenance.resolve');
    if (previous) return { ...previous, replayed: true };
    const task = await ctx.db.get(args.maintenanceTaskId);
    if (!task || task.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (task.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${task.version}`);
    if (!['open', 'in_progress'].includes(task.status)) throw new ConvexError('MAINTENANCE_NOT_OPEN');
    const now = Date.now();
    const version = task.version + 1;
    await ctx.db.patch(task._id, { status: 'resolved', version, updatedAt: now, resolvedAt: now });
    if (task.linkedBlockBookingId) {
      const block = await ctx.db.get(task.linkedBlockBookingId);
      if (block?.status === 'blocked') {
        const nights = await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', block._id)).collect();
        for (const night of nights) await ctx.db.delete(night._id);
        await ctx.db.patch(block._id, { status: 'cancelled', statusHistory: [...block.statusHistory, { status: 'cancelled', ts: now }], updatedAt: now, version: (block.version ?? 0) + 1 });
        await markPropertyDirtyInline(ctx, args.propertyId);
      }
    }
    const result = { maintenanceTaskId: task._id, version };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'maintenance.resolve', userId: access.userId, name: access.profile.name, entityType: 'maintenance_task', entityId: task._id, detail: `resolved ${task.title}`, result });
    return { ...result, replayed: false };
  },
});
