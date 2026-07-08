import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { enumerateNights, nightlyRateCents, todayInTimezone } from '../../shared/pricing';
import { centsToDecimalString, channexProvider } from './channex';
import { channelConfigured, CHANNEL_HORIZON_DAYS } from './index';

// ---------------------------------------------------------------------------
// ARI push (M6-prep) — OpenStays → Channex outbound sync. THE oversell guard.
// Availability is a COUNT per Channex room type per night:
//   freeCount(unitType, date) = (# active units of that type)
//                             − (# of those units with a unitNights row that date)
// Rates/restrictions come per mapped rate plan per night from the rate plan
// (findSeason/nightlyRateCents in shared/pricing.ts), rate as a decimal string
// in major units (centsToDecimalString).
//
// [UNCONFIRMED — cheatsheet §5, open item 4] Channex does NOT auto-decrement a
// shared counter for us; the PMS is the system of record and must push the new
// count immediately on every occupancy change. That is exactly what
// pushAriForProperty does (scheduled runAfter(0) from createHold and booking
// ingest). TODO(channex-cert): confirm whether Channex momentarily reserves
// availability at OTA-confirm time (which would narrow the oversell window) —
// our design assumes it does NOT and minimizes the window via immediate pushes.
// ---------------------------------------------------------------------------

type AvailabilityRowOut = { roomTypeId: string; date: string; availability: number };
type RestrictionRowOut = {
  ratePlanId: string;
  date: string;
  rate?: string;
  minStayArrival?: number;
  closedToArrival?: boolean;
  stopSell?: boolean;
};

/**
 * Compute the ARI payload for one property over [today, today+horizon):
 * availability rows (one per mapped unitType per night, free-unit count) and
 * restriction rows (one per mapped rate plan per night, rate + minStay).
 * Skips unmapped unitTypes/ratePlans and non-nightly types. Returns null when
 * the property has no channexPropertyId (internalQuery so the action gets a
 * consistent snapshot in one read).
 */
export const computeAriForProperty = internalQuery({
  args: { propertyId: v.id('properties'), horizonDays: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    channexPropertyId: string;
    availability: AvailabilityRowOut[];
    restrictions: RestrictionRowOut[];
  } | null> => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.channexPropertyId) return null;
    const channexPropertyId = property.channexPropertyId;

    const horizonDays = args.horizonDays ?? CHANNEL_HORIZON_DAYS;
    const startDate = todayInTimezone(property.timezone);
    // Horizon is [start, start+horizonDays) — half-open, so `dates` are the
    // nights we push. endDate is the exclusive upper bound for range reads.
    const dates = enumerateNights(startDate, addDaysLocal(startDate, horizonDays));
    const endDate = addDaysLocal(startDate, horizonDays);

    // Mapped, nightly unit types only.
    const unitTypes = await ctx.db
      .query('unitTypes')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .collect();
    const mappedTypes = unitTypes.filter(
      (t) => t.bookingMode === 'nightly' && t.channexRoomTypeId,
    );

    const availability: AvailabilityRowOut[] = [];
    for (const unitType of mappedTypes) {
      const roomTypeId = unitType.channexRoomTypeId!;
      // Active units of this type.
      const units = await ctx.db
        .query('units')
        .withIndex('by_type', (q) => q.eq('unitTypeId', unitType._id))
        .collect();
      const activeUnits = units.filter((u) => u.status === 'active');
      const activeCount = activeUnits.length;

      // Per-date occupied count. For each unit, ONE indexed range read over the
      // whole window (by_unit_date), then bump a per-date counter for every
      // night that has a unitNights row. This is O(units + occupiedRows), NOT
      // O(units × dates) — no n×m scan.
      const occupiedByDate = new Map<string, number>();
      for (const unit of activeUnits) {
        const nights = await ctx.db
          .query('unitNights')
          .withIndex('by_unit_date', (q) =>
            q.eq('unitId', unit._id).gte('date', startDate).lt('date', endDate),
          )
          .collect();
        // A unit can have at most one row per date (stay/prep/external/block all
        // mean "not sellable"); a Set per unit dedupes defensively in case the
        // derived table ever drifts to two rows on one date.
        const seen = new Set<string>();
        for (const night of nights) {
          if (seen.has(night.date)) continue;
          seen.add(night.date);
          occupiedByDate.set(night.date, (occupiedByDate.get(night.date) ?? 0) + 1);
        }
      }

      for (const date of dates) {
        const occupied = occupiedByDate.get(date) ?? 0;
        const free = Math.max(0, activeCount - occupied);
        availability.push({ roomTypeId, date, availability: free });
      }
    }

    // Mapped rate plans → per-night rate + minStay restriction rows.
    const ratePlans = await ctx.db
      .query('ratePlans')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .collect();
    const mappedPlans = ratePlans.filter((p) => p.active && p.channexRatePlanId);

    const restrictions: RestrictionRowOut[] = [];
    for (const plan of mappedPlans) {
      const ratePlanId = plan.channexRatePlanId!;
      for (const date of dates) {
        const rateCents = nightlyRateCents(plan, date);
        const row: RestrictionRowOut = {
          ratePlanId,
          date,
          rate: centsToDecimalString(rateCents),
        };
        // Only send minStayArrival when it constrains (> 1). Channex treats a
        // missing key as "no change"; sending min_stay_arrival:1 every night is
        // noise (and would override a channel-side default of 1 harmlessly, but
        // we keep the payload minimal).
        if (plan.minStayNights > 1) row.minStayArrival = plan.minStayNights;
        restrictions.push(row);
      }
    }

    return { channexPropertyId, availability, restrictions };
  },
});

/** Local addDays over ISO dates (avoids importing addDays alias collisions). */
function addDaysLocal(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Small snapshot of a property's channelSync row for the push action to decide
 * whether to push (actions have no db access). Returns null when there's no
 * channelSync row (property not connected).
 */
export const getSyncState = internalQuery({
  args: { propertyId: v.id('properties') },
  handler: async (
    ctx,
    args,
  ): Promise<{ enabled: boolean } | null> => {
    const row = await ctx.db
      .query('channelSync')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
    if (!row) return null;
    return { enabled: row.enabled };
  },
});

/**
 * Push the current ARI snapshot for one property to Channex. No-op unless the
 * channel manager is configured (CHANNEX_API_KEY) AND the property is mapped
 * (channexPropertyId) AND channelSync.enabled. Steps:
 *  1. Guard configured + enabled.
 *  2. runQuery computeAriForProperty → null? return (unmapped).
 *  3. provider.pushAvailability + pushRestrictions (each batched — one call each
 *     per flush, respecting the 10/min/property limit).
 *  4. Log via writeSyncLog (kind 'ari_push'); ok = both pushes clean.
 *  5. On success (no warnings, both ok) → markPushed (clears dirtySince). On a
 *     429/failure DON'T clear dirty — the next cron retries — and log ok:false.
 * Called by: the ari-flush cron (dirty properties), an immediate schedule after
 * createHold / booking ingest, and the nightly full resync.
 */
export const pushAriForProperty = internalAction({
  args: { propertyId: v.id('properties'), fullResync: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    if (!channelConfigured()) return;

    const sync = await ctx.runQuery(internal.channel.ari.getSyncState, {
      propertyId: args.propertyId,
    });
    if (!sync || !sync.enabled) return;

    const ari = await ctx.runQuery(internal.channel.ari.computeAriForProperty, {
      propertyId: args.propertyId,
    });
    if (!ari) {
      // Property lost its channexPropertyId (disconnected) between the enabled
      // check and now — nothing to push.
      return;
    }

    const provider = channexProvider;
    const availResult = await provider.pushAvailability(ari.channexPropertyId, ari.availability);
    const restrResult = await provider.pushRestrictions(ari.channexPropertyId, ari.restrictions);

    const ok = availResult.ok && restrResult.ok;
    const warnings = [...availResult.warnings, ...restrResult.warnings];
    const detail =
      `availability ${ari.availability.length} rows (${availResult.ok ? 'ok' : 'FAIL'}), ` +
      `restrictions ${ari.restrictions.length} rows (${restrResult.ok ? 'ok' : 'FAIL'})` +
      (warnings.length > 0 ? ` — ${warnings.slice(0, 10).join('; ')}` : '');

    await ctx.runMutation(internal.channel.ari.writeSyncLog, {
      propertyId: args.propertyId,
      kind: 'ari_push',
      ok,
      detail,
    });

    if (ok) {
      // Clear dirty + stamp lastAriPushAt (and lastFullSyncAt on a full resync).
      await ctx.runMutation(internal.channel.ari.markPushed, {
        propertyId: args.propertyId,
        fullResync: args.fullResync,
      });
    } else {
      // Failure (incl. 429) — leave dirtySince set so the flush cron retries.
      // Record lastError for the admin Channels page without clearing dirty.
      await ctx.runMutation(internal.channel.ari.recordPushError, {
        propertyId: args.propertyId,
        error: warnings.slice(0, 3).join('; ') || 'ARI push failed',
      });
    }
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
 * List the channelSync rows the flush cron should push: enabled, and either a
 * full resync (all enabled) or dirty (dirtySince set). Returns property ids so
 * the action can fan out per-property.
 */
export const listSyncTargets = internalQuery({
  args: { fullResync: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Array<Id<'properties'>>> => {
    const rows = await ctx.db.query('channelSync').collect();
    return rows
      .filter((r) => r.enabled && (args.fullResync ? true : r.dirtySince !== undefined))
      .map((r) => r.propertyId);
  },
});

/**
 * ari-flush cron entrypoint: push every enabled, dirty, mapped property. Also
 * the nightly full-resync entrypoint (fullResync:true ignores the dirty flag
 * and pushes all enabled properties). Fans out to pushAriForProperty per
 * property via the scheduler so one property's failure is isolated.
 */
export const flushDirty = internalAction({
  args: { fullResync: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    if (!channelConfigured()) return;
    const targets = await ctx.runQuery(internal.channel.ari.listSyncTargets, {
      fullResync: args.fullResync,
    });
    for (const propertyId of targets) {
      // Per-property isolation: schedule each push independently so one
      // property's failure (or rate-limit) can't stop the others.
      await ctx.scheduler.runAfter(0, internal.channel.ari.pushAriForProperty, {
        propertyId,
        fullResync: args.fullResync,
      });
    }
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

/**
 * Record a push failure WITHOUT clearing dirtySince: the property stays dirty
 * so the flush cron retries next cycle. Only updates lastError + lastAriPushAt
 * (we did attempt a push). (helper)
 */
export const recordPushError = internalMutation({
  args: { propertyId: v.id('properties'), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('channelSync')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      lastAriPushAt: Date.now(),
      lastError: args.error,
      // dirtySince intentionally left as-is so the retry happens.
    });
  },
});

// Referenced by the ingest layer for unit-assignment; kept here so the free-unit
// computation lives beside the availability math.
export type UnitId = Id<'units'>;
