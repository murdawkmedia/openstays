import { ConvexError, v } from 'convex/values';

import { normalizeDailyOperationsText } from '../shared/dailyOperations';
import type { Id } from './_generated/dataModel';
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
const itemDefinition = v.object({
  key: v.string(),
  label: v.string(),
  required: v.boolean(),
  sortOrder: v.number(),
});

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

function text(value: string, maxLength: number, required = false) {
  try {
    const normalized = normalizeDailyOperationsText(value, maxLength);
    if (required && normalized.length === 0) throw new ConvexError('TEXT_REQUIRED');
    return normalized;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError('TEXT_TOO_LONG');
  }
}

function normalizeItems(items: Array<{
  key: string;
  label: string;
  required: boolean;
  sortOrder: number;
}>) {
  if (items.length === 0 || items.length > 100) throw new ConvexError('INVALID_CHECKLIST_SIZE');
  const normalized = items.map((item) => {
    const key = item.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) throw new ConvexError('INVALID_CHECKLIST_KEY');
    if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 10_000) {
      throw new ConvexError('INVALID_CHECKLIST_ORDER');
    }
    return {
      key,
      label: text(item.label, 120, true),
      required: item.required,
      sortOrder: item.sortOrder,
    };
  });
  if (new Set(normalized.map((item) => item.key)).size !== normalized.length) {
    throw new ConvexError('DUPLICATE_CHECKLIST_KEY');
  }
  return normalized.sort((left, right) =>
    left.sortOrder - right.sortOrder || left.key.localeCompare(right.key),
  );
}

async function finish(
  ctx: MutationCtx,
  args: {
    propertyId: Id<'properties'>;
    requestId: string;
    action: string;
    actorUserId: Id<'users'>;
    actorName: string;
    entityType: string;
    entityId: string;
    detail: string;
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
    entityType: args.entityType,
    entityId: args.entityId,
    requestId: args.requestId,
    ts: now,
  });
}

export const list = query({
  args: {
    propertyId: v.id('properties'),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'housekeeping.read');
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const rows = await ctx.db
      .query('housekeepingChecklistTemplates')
      .withIndex('by_property_active', (q) => q.eq('propertyId', args.propertyId))
      .collect();
    return (args.includeInactive ? rows : rows.filter((row) => row.active))
      .sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const save = mutation({
  args: {
    propertyId: v.id('properties'),
    templateId: v.optional(v.id('housekeepingChecklistTemplates')),
    name: v.string(),
    cleaningType,
    active: v.boolean(),
    items: v.array(itemDefinition),
    expectedVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.template.save';
    const access = await requireMutationPropertyCapability(
      ctx,
      args.propertyId,
      'housekeeping.template.manage',
      action,
      args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<{
      templateId: Id<'housekeepingChecklistTemplates'>;
      version: number;
    }>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const name = text(args.name, 100, true);
    const items = normalizeItems(args.items);
    const now = Date.now();
    let templateId: Id<'housekeepingChecklistTemplates'>;
    let version: number;
    if (args.templateId) {
      const template = await ctx.db.get(args.templateId);
      if (!template || template.propertyId !== args.propertyId) {
        throw new ConvexError('PROPERTY_RECORD_MISMATCH');
      }
      if (template.version !== args.expectedVersion) {
        throw new ConvexError({
          code: 'VERSION_CONFLICT',
          currentVersion: template.version,
          current: { name: template.name, active: template.active },
        });
      }
      templateId = template._id;
      version = template.version + 1;
      await ctx.db.patch(template._id, {
        name,
        cleaningType: args.cleaningType,
        active: args.active,
        itemDefinitions: items,
        version,
        updatedBy: access.userId,
        updatedAt: now,
      });
    } else {
      if (args.expectedVersion !== 0) throw new ConvexError('INVALID_CREATE_VERSION');
      version = 0;
      templateId = await ctx.db.insert('housekeepingChecklistTemplates', {
        propertyId: args.propertyId,
        name,
        cleaningType: args.cleaningType,
        active: args.active,
        version,
        itemDefinitions: items,
        createdBy: access.userId,
        updatedBy: access.userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const result = { templateId, version };
    await finish(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action,
      actorUserId: access.userId,
      actorName: access.profile.name,
      entityType: 'housekeeping_checklist_template',
      entityId: templateId,
      detail: `${args.templateId ? 'updated' : 'created'} checklist template ${name}`,
      result,
    });
    return { ...result, replayed: false };
  },
});

export const attachToAssignment = mutation({
  args: {
    propertyId: v.id('properties'),
    assignmentId: v.id('housekeepingAssignments'),
    templateId: v.id('housekeepingChecklistTemplates'),
    expectedAssignmentVersion: v.number(),
    requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = 'housekeeping.template.attach';
    const access = await requireMutationPropertyCapability(
      ctx,
      args.propertyId,
      'housekeeping.template.manage',
      action,
      args.automationToken,
    );
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const previous = await replay<{
      assignmentId: Id<'housekeepingAssignments'>;
      version: number;
      items: Array<{ itemId: Id<'housekeepingChecklistItems'>; itemKey: string }>;
    }>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const [assignment, template] = await Promise.all([
      ctx.db.get(args.assignmentId),
      ctx.db.get(args.templateId),
    ]);
    if (
      !assignment ||
      !template ||
      assignment.propertyId !== args.propertyId ||
      template.propertyId !== args.propertyId
    ) {
      throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    if (assignment.version !== args.expectedAssignmentVersion) {
      throw new ConvexError({
        code: 'VERSION_CONFLICT',
        currentVersion: assignment.version,
        current: { status: assignment.status },
      });
    }
    if (!template.active) throw new ConvexError('CHECKLIST_TEMPLATE_INACTIVE');
    if (assignment.status === 'verified' || assignment.status === 'cancelled') {
      throw new ConvexError('ASSIGNMENT_CLOSED');
    }
    const existing = await ctx.db
      .query('housekeepingChecklistItems')
      .withIndex('by_assignment_order', (q) => q.eq('assignmentId', assignment._id))
      .collect();
    if (existing.length > 0 || assignment.checklistTemplateId) {
      throw new ConvexError('CHECKLIST_ALREADY_ATTACHED');
    }
    const now = Date.now();
    const itemRows = [];
    for (const definition of [...template.itemDefinitions].sort((left, right) =>
      left.sortOrder - right.sortOrder || left.key.localeCompare(right.key),
    )) {
      const itemId = await ctx.db.insert('housekeepingChecklistItems', {
        propertyId: args.propertyId,
        assignmentId: assignment._id,
        itemKey: definition.key,
        label: definition.label,
        required: definition.required,
        sortOrder: definition.sortOrder,
        status: 'pending',
        version: 0,
        updatedBy: access.userId,
        updatedAt: now,
      });
      itemRows.push({ itemId, itemKey: definition.key });
    }
    const version = assignment.version + 1;
    await ctx.db.patch(assignment._id, {
      checklistTemplateId: template._id,
      checklistTemplateVersion: template.version,
      cleaningType: assignment.cleaningType ?? template.cleaningType,
      version,
      updatedAt: now,
    });
    const result = { assignmentId: assignment._id, version, items: itemRows };
    await finish(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action,
      actorUserId: access.userId,
      actorName: access.profile.name,
      entityType: 'housekeeping_assignment',
      entityId: assignment._id,
      detail: `attached checklist template ${template.name}`,
      result,
    });
    return { ...result, replayed: false };
  },
});
