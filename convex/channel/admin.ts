import { ConvexError, v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { requireStaff, writeAudit } from '../staff';
import { channelConfigured } from './index';
import { channexBaseUrl } from './channex';

// ---------------------------------------------------------------------------
// Admin-facing channel config (M6-prep) — powers the /admin/settings Channels
// section. Staff-gated (owner to change connection; any staff to view), with
// the usual DEMO_MODE carve-out. Builder implements the stubs; signatures FIXED
// (the settings UI codes against them). Secrets (CHANNEX_API_KEY) are NEVER set
// here — only the non-secret mapping (Channex UUIDs) + the enabled toggle.
// ---------------------------------------------------------------------------

async function gate(ctx: Parameters<typeof requireStaff>[0], ownerOnly: boolean) {
  if (process.env.DEMO_MODE === 'true') return;
  const { profile } = await requireStaff(ctx);
  if (ownerOnly && profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');
}

/**
 * Channel config + live status for the settings page: whether the channel
 * manager is configured (env), each property's channexPropertyId + enabled +
 * last push/poll/error, and per-unitType / per-ratePlan mapping ids. (builder)
 */
export const getChannelConfig = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    configured: boolean; // CHANNEX_API_KEY present
    baseUrl: string;
    properties: Array<{
      propertyId: Id<'properties'>;
      name: string;
      channexPropertyId?: string;
      enabled: boolean;
      dirtySince?: number;
      lastAriPushAt?: number;
      lastBookingPollAt?: number;
      lastError?: string;
      unitTypes: Array<{ unitTypeId: Id<'unitTypes'>; name: string; channexRoomTypeId?: string }>;
      ratePlans: Array<{ ratePlanId: Id<'ratePlans'>; name: string; channexRatePlanId?: string }>;
    }>;
  }> => {
    await gate(ctx, false);

    const properties = await ctx.db.query('properties').collect();
    const result = [];
    for (const property of properties) {
      const sync = await ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', property._id))
        .unique();

      const unitTypeDocs = await ctx.db
        .query('unitTypes')
        .withIndex('by_property', (q) => q.eq('propertyId', property._id))
        .collect();
      const ratePlanDocs = await ctx.db
        .query('ratePlans')
        .withIndex('by_property', (q) => q.eq('propertyId', property._id))
        .collect();

      result.push({
        propertyId: property._id,
        name: property.name,
        channexPropertyId: property.channexPropertyId,
        enabled: sync?.enabled ?? false,
        dirtySince: sync?.dirtySince,
        lastAriPushAt: sync?.lastAriPushAt,
        lastBookingPollAt: sync?.lastBookingPollAt,
        lastError: sync?.lastError,
        unitTypes: unitTypeDocs.map((ut) => ({
          unitTypeId: ut._id,
          name: ut.name,
          channexRoomTypeId: ut.channexRoomTypeId,
        })),
        ratePlans: ratePlanDocs.map((rp) => ({
          ratePlanId: rp._id,
          name: rp.name,
          channexRatePlanId: rp.channexRatePlanId,
        })),
      });
    }

    return {
      configured: channelConfigured(),
      baseUrl: channexBaseUrl(),
      properties: result,
    };
  },
});

/** Set/clear a property's Channex property UUID + enabled toggle (owner). Creates
 *  the channelSync row on first connect. (builder) */
export const setPropertyChannel = mutation({
  args: {
    propertyId: v.id('properties'),
    channexPropertyId: v.optional(v.string()), // undefined/'' disconnects
    enabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await gate(ctx, true);

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError('NOT_FOUND');

    const trimmed = args.channexPropertyId?.trim();
    const nextChannexPropertyId = trimmed && trimmed.length > 0 ? trimmed : undefined;
    const disconnecting = nextChannexPropertyId === undefined;
    const nextEnabled = disconnecting ? false : args.enabled;

    await ctx.db.patch(args.propertyId, { channexPropertyId: nextChannexPropertyId });

    const existing = await ctx.db
      .query('channelSync')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled: nextEnabled });
    } else {
      await ctx.db.insert('channelSync', {
        propertyId: args.propertyId,
        provider: 'channex',
        enabled: nextEnabled,
      });
    }

    await writeAudit(
      ctx,
      'channel.connect',
      disconnecting
        ? `disconnected channel for ${property.name}`
        : `connected channel for ${property.name} (sync ${nextEnabled ? 'on' : 'off'})`,
    );
    return { ok: true };
  },
});

/** Map a unitType → Channex room type UUID (owner). (builder) */
export const setUnitTypeChannel = mutation({
  args: { unitTypeId: v.id('unitTypes'), channexRoomTypeId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await gate(ctx, true);

    const unitType = await ctx.db.get(args.unitTypeId);
    if (!unitType) throw new ConvexError('NOT_FOUND');

    const trimmed = args.channexRoomTypeId?.trim();
    const nextValue = trimmed && trimmed.length > 0 ? trimmed : undefined;
    await ctx.db.patch(args.unitTypeId, { channexRoomTypeId: nextValue });

    await writeAudit(
      ctx,
      'channel.map',
      nextValue
        ? `mapped room type for ${unitType.name}`
        : `unmapped room type for ${unitType.name}`,
    );
    return { ok: true };
  },
});

/** Map a ratePlan → Channex rate plan UUID (owner). (builder) */
export const setRatePlanChannel = mutation({
  args: { ratePlanId: v.id('ratePlans'), channexRatePlanId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await gate(ctx, true);

    const ratePlan = await ctx.db.get(args.ratePlanId);
    if (!ratePlan) throw new ConvexError('NOT_FOUND');

    const trimmed = args.channexRatePlanId?.trim();
    const nextValue = trimmed && trimmed.length > 0 ? trimmed : undefined;
    await ctx.db.patch(args.ratePlanId, { channexRatePlanId: nextValue });

    await writeAudit(
      ctx,
      'channel.map',
      nextValue
        ? `mapped rate plan for ${ratePlan.name}`
        : `unmapped rate plan for ${ratePlan.name}`,
    );
    return { ok: true };
  },
});

/** Recent channelSyncLog rows for a property (newest first). (builder) */
export const recentSyncLog = query({
  args: { propertyId: v.id('properties'), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ kind: string; ok: boolean; detail: string; ts: number }>> => {
    await gate(ctx, false);

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query('channelSyncLog')
      .withIndex('by_property_ts', (q) => q.eq('propertyId', args.propertyId))
      .order('desc')
      .take(limit);

    return rows.map((row) => ({
      kind: row.kind,
      ok: row.ok,
      detail: row.detail,
      ts: row.ts,
    }));
  },
});

/** Force an immediate ARI push for a property (a "Sync now" button). Owner.
 *  Schedules internal.channel.ari.pushAriForProperty. (builder) */
export const syncNow = mutation({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args): Promise<{ scheduled: boolean }> => {
    await gate(ctx, true);

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError('NOT_FOUND');

    await ctx.scheduler.runAfter(0, internal.channel.ari.pushAriForProperty, {
      propertyId: args.propertyId,
    });

    await writeAudit(ctx, 'channel.sync_now', `triggered ARI sync for ${property.name}`);
    return { scheduled: true };
  },
});
