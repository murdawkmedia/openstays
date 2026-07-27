import { v } from 'convex/values';

import { internalMutation, query } from './_generated/server';
import { requireStaff } from './staff';

const SERVICE_FRESHNESS_MS = 60_000;
const PUBLIC_REWARD_SATS = 1_000;
const DEFAULT_MAX_FEE_SATS = 210;

const service = v.union(
  v.literal('wavelength'),
  v.literal('ots'),
  v.literal('mail'),
  v.literal('backup'),
);
const status = v.union(
  v.literal('starting'),
  v.literal('ready'),
  v.literal('degraded'),
  v.literal('failed'),
);
const failureCategory = v.union(
  v.literal('configuration'),
  v.literal('dependency_unavailable'),
  v.literal('network'),
  v.literal('authentication'),
  v.literal('processing'),
  v.literal('backup_stale'),
  v.literal('unknown'),
);

export const recordHeartbeat = internalMutation({
  args: {
    service,
    status,
    release: v.string(),
    observedAt: v.number(),
    spendableSats: v.optional(v.number()),
    failureCategory: v.optional(failureCategory),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query('bridgeHealth')
      .withIndex('by_service', (q) => q.eq('service', args.service))
      .unique();
    const values = {
      status: args.status,
      release: args.release,
      lastHeartbeatAt: now,
      spendableSats: args.spendableSats,
      failureCategory: args.failureCategory,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return await ctx.db.insert('bridgeHealth', {
      service: args.service,
      ...values,
      createdAt: now,
    });
  },
});

export const publicAvailability = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('bridgeHealth')
      .withIndex('by_service', (q) => q.eq('service', 'wavelength'))
      .unique();
    const updatedAt = row?.lastHeartbeatAt ?? null;
    const fresh = Boolean(row && Date.now() - row.lastHeartbeatAt <= SERVICE_FRESHNESS_MS);
    const wavelengthAvailable = Boolean(fresh && row?.status === 'ready');
    const configuredFee = Number(process.env.WAVELENGTH_REWARD_MAX_FEE_SATS ?? DEFAULT_MAX_FEE_SATS);
    const maxFee = Number.isSafeInteger(configuredFee) && configuredFee >= 0
      ? configuredFee
      : DEFAULT_MAX_FEE_SATS;
    const rewardAvailable = Boolean(
      wavelengthAvailable &&
      row?.spendableSats !== undefined &&
      row.spendableSats >= PUBLIC_REWARD_SATS + maxFee,
    );
    return { wavelengthAvailable, rewardAvailable, updatedAt };
  },
});

export const listForStaff = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    return await ctx.db.query('bridgeHealth').collect();
  },
});
