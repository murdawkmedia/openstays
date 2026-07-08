import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

// ---------------------------------------------------------------------------
// ARI push (M6-prep) — OpenStays → Channex outbound sync. THE oversell guard.
// Builder implements the stubs; signatures FIXED (crons + bookings.ts schedule
// these). Availability is a COUNT per Channex room type per night:
//   freeCount(unitType, date) = (# active units of that type)
//                             − (# of those units with a unitNights row that date)
// Rates/restrictions come per mapped rate plan per night from the rate plan
// (findSeason/nightlyRateCents in shared/pricing.ts), rate as a decimal string
// in major units (cents/100).
// ---------------------------------------------------------------------------

/**
 * Compute the ARI payload for one property over [today, today+horizon):
 * availability rows (one per mapped unitType per night, free-unit count) and
 * restriction rows (one per mapped rate plan per night, rate + minStay).
 * Skips unmapped unitTypes/ratePlans and non-nightly types. Returns null when
 * the property has no channexPropertyId. (builder — internalQuery so the action
 * gets a consistent snapshot in one read.)
 */
export const computeAriForProperty = internalQuery({
  args: { propertyId: v.id('properties'), horizonDays: v.optional(v.number()) },
  handler: async (): Promise<{
    channexPropertyId: string;
    availability: Array<{ roomTypeId: string; date: string; availability: number }>;
    restrictions: Array<{
      ratePlanId: string;
      date: string;
      rate?: string;
      minStayArrival?: number;
      closedToArrival?: boolean;
      stopSell?: boolean;
    }>;
  } | null> => {
    // builder
    return null;
  },
});

/**
 * Push the current ARI snapshot for one property to Channex. No-op unless the
 * channel manager is configured (CHANNEX_API_KEY) AND the property is mapped
 * (channexPropertyId) AND channelSync.enabled. Steps:
 *  1. runQuery computeAriForProperty → null? log+return.
 *  2. provider.pushAvailability + pushRestrictions (each batched — respect the
 *     10/min/property limit: one call each per flush).
 *  3. On warnings/errors → channelSyncLog kind 'ari_push' ok:false with detail;
 *     on success → clear channelSync.dirtySince, set lastAriPushAt.
 *  4. A 429 → log and leave dirtySince set so the next cron retries.
 * Called by: the ari-flush cron (dirty properties), an immediate schedule after
 * createHold / booking ingest, and the nightly full resync.
 */
export const pushAriForProperty = internalAction({
  args: { propertyId: v.id('properties') },
  handler: async (): Promise<void> => {
    // builder — until implemented, a no-op so booking flows never block.
  },
});

/**
 * Mark a property's channel availability dirty (occupancy changed). Cheap: sets
 * channelSync.dirtySince if unset. Scheduled (runAfter 0) from booking-status
 * mutations. No-op if the property has no channelSync row (not connected).
 */
export const markDirty = internalMutation({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('channelSync')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
    if (!row || !row.enabled) return;
    if (row.dirtySince === undefined) {
      await ctx.db.patch(row._id, { dirtySince: Date.now() });
    }
  },
});

/**
 * ari-flush cron entrypoint: push every enabled, dirty, mapped property. Also
 * the nightly full-resync entrypoint (fullResync:true ignores the dirty flag
 * and pushes all enabled properties). (builder — fan out to pushAriForProperty
 * per property via the scheduler so one property's failure is isolated.)
 */
export const flushDirty = internalAction({
  args: { fullResync: v.optional(v.boolean()) },
  handler: async (): Promise<void> => {
    // builder
  },
});

/** Append a channelSyncLog row. (helper the action layer uses) */
export const writeSyncLog = internalMutation({
  args: {
    propertyId: v.id('properties'),
    kind: v.string(),
    ok: v.boolean(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('channelSyncLog', {
      propertyId: args.propertyId,
      provider: 'channex',
      kind: args.kind,
      ok: args.ok,
      detail: args.detail,
      ts: Date.now(),
    });
  },
});

/** Clear dirty + stamp lastAriPushAt after a successful push. (helper) */
export const markPushed = internalMutation({
  args: { propertyId: v.id('properties'), fullResync: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('channelSync')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
    if (!row) return;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      dirtySince: undefined,
      lastAriPushAt: now,
      ...(args.fullResync ? { lastFullSyncAt: now } : {}),
      lastError: undefined,
    });
  },
});

// Referenced by the ingest layer for unit-assignment; kept here so the free-unit
// computation lives beside the availability math. (builder may move if cleaner.)
export type UnitId = Id<'units'>;
