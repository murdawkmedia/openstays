import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';

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
export const syncAll = internalAction({
  args: {},
  handler: async (): Promise<void> => {
    // builder E — until implemented, the cron is a no-op.
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
  handler: async (): Promise<{ inserted: number; updated: number; removed: number; conflicts: number }> => {
    // builder E
    return { inserted: 0, updated: 0, removed: 0, conflicts: 0 };
  },
});
