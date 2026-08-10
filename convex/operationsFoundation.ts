import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { unitAttributesSchema } from './schema';
import { requirePropertyCapability } from './staff';

async function replayResult<T>(
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

async function recordResult(
  ctx: MutationCtx,
  args: {
    propertyId: Id<'properties'>;
    requestId: string;
    action: string;
    actorUserId: Id<'users'>;
    result: unknown;
  },
) {
  await ctx.db.insert('operationRequests', {
    propertyId: args.propertyId,
    requestId: args.requestId,
    action: args.action,
    actorUserId: args.actorUserId,
    resultJson: JSON.stringify(args.result),
    createdAt: Date.now(),
  });
}

async function writeOperationalAudit(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<'users'>;
    actorName: string;
    propertyId: Id<'properties'>;
    action: string;
    detail: string;
    entityType: string;
    entityId: string;
    requestId: string;
    metadata?: unknown;
  },
) {
  await ctx.db.insert('auditLog', {
    actorUserId: args.actorUserId,
    actorName: args.actorName,
    propertyId: args.propertyId,
    action: args.action,
    detail: args.detail,
    entityType: args.entityType,
    entityId: args.entityId,
    requestId: args.requestId,
    metadataJson: args.metadata === undefined ? undefined : JSON.stringify(args.metadata),
    ts: Date.now(),
  });
}

export const setFeatureFlag = mutation({
  args: {
    propertyId: v.id('properties'),
    feature: v.string(),
    enabled: v.boolean(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.configure');
    const replay = await replayResult<{ enabled: boolean }>(
      ctx,
      args.propertyId,
      args.requestId,
      'feature.set',
    );
    if (replay) return { ...replay, replayed: true };

    const existing = await ctx.db
      .query('propertyFeatures')
      .withIndex('by_property_feature', (q) =>
        q.eq('propertyId', args.propertyId).eq('feature', args.feature),
      )
      .unique();
    const version = (existing?.version ?? 0) + 1;
    const row = {
      propertyId: args.propertyId,
      feature: args.feature,
      enabled: args.enabled,
      version,
      updatedBy: access.userId,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert('propertyFeatures', row);
    const result = { enabled: args.enabled, version };
    await recordResult(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action: 'feature.set',
      actorUserId: access.userId,
      result,
    });
    await writeOperationalAudit(ctx, {
      actorUserId: access.userId,
      actorName: access.profile.name,
      propertyId: args.propertyId,
      action: 'feature.set',
      detail: `${args.enabled ? 'enabled' : 'disabled'} ${args.feature}`,
      entityType: 'property_feature',
      entityId: args.feature,
      requestId: args.requestId,
      metadata: { enabled: args.enabled, version },
    });
    return { ...result, replayed: false };
  },
});

export const createUnitGroup = mutation({
  args: {
    propertyId: v.id('properties'),
    name: v.string(),
    slug: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.configure');
    const replay = await replayResult<{ unitGroupId: Id<'unitGroups'> }>(
      ctx,
      args.propertyId,
      args.requestId,
      'unit_group.create',
    );
    if (replay) return { ...replay, replayed: true };
    if (!args.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) {
      throw new ConvexError('INVALID_UNIT_GROUP');
    }
    const duplicate = await ctx.db
      .query('unitGroups')
      .withIndex('by_property_slug', (q) =>
        q.eq('propertyId', args.propertyId).eq('slug', args.slug),
      )
      .unique();
    if (duplicate) throw new ConvexError('UNIT_GROUP_EXISTS');
    const now = Date.now();
    const unitGroupId = await ctx.db.insert('unitGroups', {
      propertyId: args.propertyId,
      name: args.name.trim(),
      slug: args.slug,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const result = { unitGroupId };
    await recordResult(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action: 'unit_group.create',
      actorUserId: access.userId,
      result,
    });
    await writeOperationalAudit(ctx, {
      actorUserId: access.userId,
      actorName: access.profile.name,
      propertyId: args.propertyId,
      action: 'unit_group.create',
      detail: `created unit group ${args.name.trim()}`,
      entityType: 'unit_group',
      entityId: unitGroupId,
      requestId: args.requestId,
    });
    return { ...result, replayed: false };
  },
});

export const addUnitGroupMember = mutation({
  args: {
    propertyId: v.id('properties'),
    unitGroupId: v.id('unitGroups'),
    unitId: v.id('units'),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.configure');
    const replay = await replayResult<{ memberId: Id<'unitGroupMembers'> }>(
      ctx,
      args.propertyId,
      args.requestId,
      'unit_group.member.add',
    );
    if (replay) return { ...replay, replayed: true };
    const [group, unit] = await Promise.all([
      ctx.db.get(args.unitGroupId),
      ctx.db.get(args.unitId),
    ]);
    if (
      !group ||
      !unit ||
      !group.active ||
      group.propertyId !== args.propertyId ||
      unit.propertyId !== args.propertyId
    ) {
      throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    const existing = await ctx.db
      .query('unitGroupMembers')
      .withIndex('by_group_unit', (q) =>
        q.eq('unitGroupId', args.unitGroupId).eq('unitId', args.unitId),
      )
      .unique();
    const memberId =
      existing?._id ??
      (await ctx.db.insert('unitGroupMembers', {
        propertyId: args.propertyId,
        unitGroupId: args.unitGroupId,
        unitId: args.unitId,
        addedBy: access.userId,
        addedAt: Date.now(),
      }));
    const result = { memberId };
    await recordResult(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action: 'unit_group.member.add',
      actorUserId: access.userId,
      result,
    });
    await writeOperationalAudit(ctx, {
      actorUserId: access.userId,
      actorName: access.profile.name,
      propertyId: args.propertyId,
      action: 'unit_group.member.add',
      detail: `added ${unit.name} to ${group.name}`,
      entityType: 'unit_group_member',
      entityId: memberId,
      requestId: args.requestId,
    });
    return { ...result, replayed: false };
  },
});

export const setUnitAttributes = mutation({
  args: {
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    expectedVersion: v.number(),
    requestId: v.string(),
    attributes: unitAttributesSchema,
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.configure');
    const replay = await replayResult<{ unitId: Id<'units'>; version: number }>(
      ctx,
      args.propertyId,
      args.requestId,
      'unit.attributes.set',
    );
    if (replay) return { ...replay, replayed: true };
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.propertyId !== args.propertyId) {
      throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    const currentVersion = unit.attributesVersion ?? 0;
    if (currentVersion !== args.expectedVersion) {
      throw new ConvexError(`VERSION_CONFLICT:${currentVersion}`);
    }
    const version = currentVersion + 1;
    await ctx.db.patch(args.unitId, { attributes: args.attributes, attributesVersion: version });
    const result = { unitId: args.unitId, version };
    await recordResult(ctx, {
      propertyId: args.propertyId,
      requestId: args.requestId,
      action: 'unit.attributes.set',
      actorUserId: access.userId,
      result,
    });
    await writeOperationalAudit(ctx, {
      actorUserId: access.userId,
      actorName: access.profile.name,
      propertyId: args.propertyId,
      action: 'unit.attributes.set',
      detail: `updated attributes for ${unit.name}`,
      entityType: 'unit',
      entityId: args.unitId,
      requestId: args.requestId,
      metadata: { version },
    });
    return { ...result, replayed: false };
  },
});

export const snapshot = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'property.read');
    const [features, groups, units, channel, openRefunds, openMaintenance, activeMaintenance] = await Promise.all([
      ctx.db
        .query('propertyFeatures')
        .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
        .collect(),
      ctx.db
        .query('unitGroups')
        .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
        .collect(),
      ctx.db
        .query('units')
        .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
        .collect(),
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
        .unique(),
      ctx.db
        .query('refundCases')
        .withIndex('by_property_status', (q) =>
          q.eq('propertyId', args.propertyId).eq('status', 'open'),
        )
        .take(100),
      ctx.db
        .query('maintenanceTasks')
        .withIndex('by_property_status', (q) =>
          q.eq('propertyId', args.propertyId).eq('status', 'open'),
        )
        .take(100),
      ctx.db
        .query('maintenanceTasks')
        .withIndex('by_property_status', (q) =>
          q.eq('propertyId', args.propertyId).eq('status', 'in_progress'),
        )
        .take(100),
    ]);
    const unitGroups = await Promise.all(
      groups.map(async (group) => ({
        unitGroupId: group._id,
        name: group.name,
        slug: group.slug,
        active: group.active,
        unitIds: (
          await ctx.db
            .query('unitGroupMembers')
            .withIndex('by_group', (q) => q.eq('unitGroupId', group._id))
            .collect()
        ).map((member) => member.unitId),
      })),
    );
    const urgentMaintenance = [...openMaintenance, ...activeMaintenance]
      .filter((task) => task.priority === 'urgent').length;
    const channelStatus = !channel
      ? { state: 'adapter_ready' as const, label: 'Channel adapter ready' }
      : !channel.enabled
        ? { state: 'paused' as const, label: 'Channel sync paused' }
        : channel.lastError
          ? { state: 'error' as const, label: 'Channel sync needs attention' }
          : channel.dirtySince
            ? { state: 'pending' as const, label: 'Channel sync pending' }
            : { state: 'synchronized' as const, label: 'Channels synchronized' };
    const alerts: Array<{ kind: 'refund' | 'maintenance' | 'channel'; label: string }> = [];
    if (openRefunds.length) {
      alerts.push({
        kind: 'refund',
        label: `${openRefunds.length} open manual refund${openRefunds.length === 1 ? '' : 's'}`,
      });
    }
    if (urgentMaintenance) {
      alerts.push({
        kind: 'maintenance',
        label: `${urgentMaintenance} urgent maintenance task${urgentMaintenance === 1 ? '' : 's'}`,
      });
    }
    if (channelStatus.state === 'pending' || channelStatus.state === 'error') {
      alerts.push({ kind: 'channel', label: channelStatus.label });
    }

    return {
      features: features.map(({ feature, enabled, version }) => ({ feature, enabled, version })),
      operationalStatus: {
        alertCount: openRefunds.length + urgentMaintenance + (
          channelStatus.state === 'pending' || channelStatus.state === 'error' ? 1 : 0
        ),
        alerts,
        channel: channelStatus,
      },
      unitGroups,
      units: units.map((unit) => ({
        unitId: unit._id,
        name: unit.name,
        attributes: unit.attributes ?? {},
        attributesVersion: unit.attributesVersion ?? 0,
      })),
    };
  },
});
