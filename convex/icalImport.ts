import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { parseIcs } from '../shared/ical';
import { markPropertyDirtyInline } from './channel/ari';

/**
 * iCal calendar IMPORT (M1, builder E) — pulls external calendars (a direct
 * Airbnb listing, a legacy-PMS bridge) into unitNights so external bookings
 * block availability here. The export side already ships (convex/ical.ts).
 *
 * syncAll (15-min cron):
 *  1. runQuery internal.icalImport.listImportTargets — every active unit with
 *     icalImports[] entries (builder E adds that internal query here).
 *  2. For each (unit, import): fetch the .ics (10s timeout), parseIcs, then
 *     runMutation applyUnitImport with the parsed events.
 *  3. Per-import isolation: one failing feed must not stop the rest. Record
 *     lastSyncedAt/lastStatus on the unit's icalImports entry either way.
 *
 * applyUnitImport (one serializable mutation per unit+feed) — reconciles
 * external events for ONE feed label against bookings rows:
 *  - Upsert by (unitId, externalUid) via the by_unit_externalUid index:
 *    new UID → insert bookings row {status: 'external', source:
 *    'ical:<label>', externalUid, no guestId} + its unitNights (kind
 *    'external'); changed dates → delete+rewrite that booking's unitNights;
 *    UID gone from the feed → cancel the external booking + delete its
 *    nights.
 *  - CONFLICT RULE (binding): external events NEVER displace internal
 *    bookings. If an external event's nights overlap non-external unitNights,
 *    keep our booking authoritative, insert the external rows only for free
 *    nights, and set syncConflict=true on the external booking. Staff resolve
 *    on the tape. Never auto-cancel an internal booking.
 *  - Loop prevention: our own export never re-exports kind 'external' rows,
 *    so a feed cycle can't amplify.
 */

const FETCH_TIMEOUT_MS = 10_000;

export const syncAll = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const targets: Array<{ unitId: Id<'units'>; imports: Array<{ url: string; label: string }> }> =
      await ctx.runQuery(internal.icalImport.listImportTargets, {});

    for (const target of targets) {
      for (const imp of target.imports) {
        // Per-feed isolation: one bad feed must never stop the rest.
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          let icsText: string;
          try {
            const response = await fetch(imp.url, { signal: controller.signal });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            icsText = await response.text();
          } finally {
            clearTimeout(timeout);
          }

          const { events, warnings } = parseIcs(icsText);
          const result = await ctx.runMutation(internal.icalImport.applyUnitImport, {
            unitId: target.unitId,
            label: imp.label,
            events,
          });

          const warningSuffix = warnings.length > 0 ? `; ${warnings.length} warning(s)` : '';
          await ctx.runMutation(internal.icalImport.updateImportStatus, {
            unitId: target.unitId,
            url: imp.url,
            lastSyncedAt: Date.now(),
            lastStatus: `ok: ${events.length} events (inserted ${result.inserted}, updated ${result.updated}, removed ${result.removed}, conflicts ${result.conflicts})${warningSuffix}`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          await ctx.runMutation(internal.icalImport.updateImportStatus, {
            unitId: target.unitId,
            url: imp.url,
            lastSyncedAt: Date.now(),
            lastStatus: `error: ${message}`,
          });
        }
      }
    }
  },
});

/** Every active unit with at least one icalImports entry. (builder E) */
export const listImportTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const units = await ctx.db.query('units').collect();
    return units
      .filter((u) => u.status !== 'offline' && u.icalImports.length > 0)
      .map((u) => ({
        unitId: u._id,
        imports: u.icalImports.map((i) => ({ url: i.url, label: i.label })),
      }));
  },
});

/** Patch the matching icalImports[] entry (by url) with the latest sync outcome. (builder E) */
export const updateImportStatus = internalMutation({
  args: {
    unitId: v.id('units'),
    url: v.string(),
    lastSyncedAt: v.number(),
    lastStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit) return;
    const icalImports = unit.icalImports.map((imp) =>
      imp.url === args.url ? { ...imp, lastSyncedAt: args.lastSyncedAt, lastStatus: args.lastStatus } : imp,
    );
    await ctx.db.patch(args.unitId, { icalImports });
  },
});

export const applyUnitImport = internalMutation({
  args: {
    unitId: v.id('units'),
    label: v.string(),
    events: v.array(
      v.object({
        uid: v.string(),
        startDate: v.string(),
        endDate: v.string(), // exclusive
        summary: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ inserted: number; updated: number; removed: number; conflicts: number }> => {
    // Defense in depth: listImportTargets only lists live units, but a unit
    // could vanish between the query and this mutation running. Nothing sane
    // to reconcile against without propertyId/unitTypeId — no-op, don't throw.
    const unit = await ctx.db.get(args.unitId);
    if (!unit) {
      return { inserted: 0, updated: 0, removed: 0, conflicts: 0 };
    }

    const source = `ical:${args.label}`;
    let inserted = 0;
    let updated = 0;
    let removed = 0;
    let conflicts = 0;

    // Existing external bookings for this unit+label. There's no dedicated
    // index for (unitId, source) — cardinality of bookings per unit is low
    // (hundreds at most) and by_unit_checkIn already scopes to the unit, so a
    // single indexed range read + in-memory filter is fine here.
    const unitBookings = await ctx.db
      .query('bookings')
      .withIndex('by_unit_checkIn', (q) => q.eq('unitId', args.unitId))
      .collect();
    const existingByUid = new Map<string, Doc<'bookings'>>();
    for (const booking of unitBookings) {
      if (booking.status === 'external' && booking.source === source && booking.externalUid) {
        existingByUid.set(booking.externalUid, booking);
      }
    }

    const seenUids = new Set<string>();
    const now = Date.now();
    // Track whether ANY unitNights row was inserted/deleted this invocation.
    // Note: the syncConflict re-evaluation branch below rewrites nights without
    // bumping `updated`, so we can't rely on the counters alone to decide
    // whether to mark the property dirty.
    let nightsChanged = false;

    for (const event of args.events) {
      seenUids.add(event.uid);
      const existing = existingByUid.get(event.uid);

      if (!existing) {
        const conflict = await insertExternalBooking(ctx, unit, source, event, now);
        inserted += 1;
        nightsChanged = true;
        if (conflict) conflicts += 1;
        continue;
      }

      // Date change → rewrite this booking's unitNights under the same
      // conflict rule; otherwise leave it untouched (no-op re-sync).
      if (existing.checkIn !== event.startDate || existing.checkOut !== event.endDate) {
        const conflict = await rewriteExternalNights(ctx, existing, event, now);
        updated += 1;
        nightsChanged = true;
        if (conflict) conflicts += 1;
      } else if (existing.syncConflict) {
        // Dates unchanged but still flagged — re-evaluate in case the
        // internal booking that caused the conflict has since freed up.
        const conflict = await rewriteExternalNights(ctx, existing, event, now);
        nightsChanged = true;
        if (conflict) conflicts += 1;
      }
    }

    // UIDs that vanished from the feed → cancel + free nights.
    for (const [uid, booking] of existingByUid) {
      if (seenUids.has(uid)) continue;
      await deleteNightsForBooking(ctx, booking._id);
      await ctx.db.patch(booking._id, {
        status: 'cancelled',
        statusHistory: [...booking.statusHistory, { status: 'cancelled', ts: now }],
        updatedAt: now,
      });
      removed += 1;
      nightsChanged = true;
    }

    // If this feed changed occupancy for the unit (a new external booking, a
    // date rewrite, a conflict re-evaluation, or a cancellation freed/blocked
    // nights), mark the unit's property dirty so the 1-min 'channex ari flush'
    // cron pushes the corrected count to OTAs. Without this, an iCal-imported
    // Airbnb booking (occupancy UP) leaves Channex advertising the pre-import
    // HIGHER count until the nightly full resync (~24h) — a cross-channel
    // oversell window. No-op unless the property has an enabled channelSync row
    // (unconnected deployments and tests stay clean). Once per property per
    // invocation (idempotent anyway).
    if (nightsChanged) {
      await markPropertyDirtyInline(ctx, unit.propertyId);
    }

    return { inserted, updated, removed, conflicts };
  },
});

/** Nights on this unit currently blocked by a NON-external booking (authoritative). */
async function internalBlockedNights(ctx: MutationCtx, unitId: Id<'units'>): Promise<Set<string>> {
  const nights = await ctx.db
    .query('unitNights')
    .withIndex('by_unit_date', (q) => q.eq('unitId', unitId))
    .collect();
  const blocked = new Set<string>();
  for (const night of nights) {
    if (night.kind !== 'external') blocked.add(night.date);
  }
  return blocked;
}

/** All ISO dates in [startDate, endDate). */
function nightsInRange(startDate: string, endDate: string): string[] {
  const nights: string[] = [];
  for (let d = startDate; d < endDate; d = addOneDay(d)) nights.push(d);
  return nights;
}

function addOneDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function deleteNightsForBooking(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const rows = await ctx.db
    .query('unitNights')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

/**
 * Insert a new external booking + its unitNights, honoring the conflict rule:
 * only free (non-internal-blocked) nights get an external unitNights row;
 * any overlap sets syncConflict=true but the booking row still covers the
 * full imported range (so date-change detection above stays correct).
 */
async function insertExternalBooking(
  ctx: MutationCtx,
  unit: Doc<'units'>,
  source: string,
  event: { uid: string; startDate: string; endDate: string; summary?: string },
  now: number,
): Promise<boolean> {
  const unitId = unit._id;
  const blockedByInternal = await internalBlockedNights(ctx, unitId);

  const allNights = nightsInRange(event.startDate, event.endDate);
  const freeNights = allNights.filter((n) => !blockedByInternal.has(n));
  const conflict = freeNights.length < allNights.length;

  const bookingId = await ctx.db.insert('bookings', {
    propertyId: unit.propertyId,
    unitId,
    unitTypeId: unit.unitTypeId,
    guestId: undefined,
    ratePlanId: undefined,
    checkIn: event.startDate,
    checkOut: event.endDate,
    nights: allNights.length,
    adults: 0,
    children: 0,
    status: 'external',
    source,
    externalUid: event.uid,
    syncConflict: conflict,
    confirmationCode: `EXT-${externalCode(event.uid)}`,
    statusHistory: [{ status: 'external', ts: now }],
    notes: [],
    createdAt: now,
    updatedAt: now,
  });

  for (const date of freeNights) {
    await ctx.db.insert('unitNights', { unitId, date, bookingId, kind: 'external' });
  }

  return conflict;
}

/** Rewrite an existing external booking's dates + unitNights under the same conflict rule. */
async function rewriteExternalNights(
  ctx: MutationCtx,
  booking: Doc<'bookings'>,
  event: { uid: string; startDate: string; endDate: string; summary?: string },
  now: number,
): Promise<boolean> {
  await deleteNightsForBooking(ctx, booking._id);

  // Exclude this booking's own (about-to-be-rewritten) nights from the
  // "internal blocked" set — they were already deleted above, so a fresh
  // read is correct without extra bookkeeping.
  const blockedByInternal = await internalBlockedNights(ctx, booking.unitId);

  const allNights = nightsInRange(event.startDate, event.endDate);
  const freeNights = allNights.filter((n) => !blockedByInternal.has(n));
  const conflict = freeNights.length < allNights.length;

  for (const date of freeNights) {
    await ctx.db.insert('unitNights', { unitId: booking.unitId, date, bookingId: booking._id, kind: 'external' });
  }

  await ctx.db.patch(booking._id, {
    checkIn: event.startDate,
    checkOut: event.endDate,
    nights: allNights.length,
    syncConflict: conflict,
    updatedAt: now,
  });

  return conflict;
}

/** Short, stable, human-glanceable suffix for an external confirmation code. */
function externalCode(uid: string): string {
  const cleaned = uid.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (cleaned.slice(0, 8) || 'UNKNOWN').padEnd(6, '0');
}
