import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { channelConfigured, getChannelProvider } from './index';

// ---------------------------------------------------------------------------
// Booking ingest (M6-prep) — Channex → OpenStays inbound. The PULL feed is
// authoritative; webhooks are only nudges (unsigned, out-of-order).
//
// Flow (syncBookingRevisions, called by cron + webhook nudge):
//  1. provider.fetchBookingRevisions() → NormalizedRevision[].
//  2. For EACH revision, in feed order: runMutation ingestRevision.
//  3. ONLY after ingestRevision succeeds (durable write): provider
//     .ackBookingRevision(revisionId). Never ack before the local write, or a
//     booking is lost; un-acked revisions re-appear for ~30 min (safe).
//  4. After any ingest that changed occupancy, schedule
//     internal.channel.ari.pushAriForProperty so OTAs see the new count
//     immediately (oversell guard).
//
// OVERSELL RULE (binding): a channel booking is a CONFIRMED OTA sale — it must
// be honored. If NO free unit exists for the dates, still create the booking
// (never drop it), set syncConflict=true, log ok:false 'OVERSELL', and alert
// staff. NEVER silently drop it, and NEVER clobber an internal booking.
// ---------------------------------------------------------------------------

type IngestOutcome =
  | 'created'
  | 'modified'
  | 'cancelled'
  | 'duplicate'
  | 'unmapped'
  | 'oversell'
  | 'noop';

export const syncBookingRevisions = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!channelConfigured()) return;
    const provider = getChannelProvider();

    let revisions;
    try {
      revisions = await provider.fetchBookingRevisions();
    } catch {
      // Feed fetch failed — nothing to ingest this cycle. Un-acked revisions
      // (there are none we've acked) simply appear next poll. Bail quietly.
      return;
    }

    // Property ids whose occupancy changed → push updated ARI after the loop.
    const touchedProperties = new Set<Id<'properties'>>();

    for (const revision of revisions) {
      let result: { outcome: string; propertyId?: Id<'properties'> };
      try {
        result = await ctx.runMutation(internal.channel.ingest.ingestRevision, {
          revisionId: revision.revisionId,
          bookingId: revision.bookingId,
          status: revision.status,
          otaName: revision.otaName,
          otaReservationCode: revision.otaReservationCode,
          roomTypeId: revision.roomTypeId,
          ratePlanId: revision.ratePlanId,
          arrivalDate: revision.arrivalDate,
          departureDate: revision.departureDate,
          adults: revision.adults,
          children: revision.children,
          guestName: revision.guestName,
          guestEmail: revision.guestEmail,
          guestPhone: revision.guestPhone,
          amountCents: revision.amountCents,
          currency: revision.currency,
        });
      } catch {
        // Ingest THREW (unexpected) — do NOT ack. The revision re-appears next
        // poll; idempotent ingest makes a successful retry a no-op. Isolate:
        // one bad revision must not starve the rest.
        continue;
      }

      // Ack AFTER the durable write. A duplicate/unmapped/oversell still acks
      // (the write, or the decision that there's nothing to write, is durable).
      // Only a THROW above skips the ack.
      try {
        await provider.ackBookingRevision(revision.revisionId);
      } catch {
        // Ack failed — safe: the revision re-appears and re-ingests idempotently.
      }

      // Occupancy-changing outcomes → push ARI for the affected property.
      if (
        result.propertyId &&
        (result.outcome === 'created' ||
          result.outcome === 'modified' ||
          result.outcome === 'cancelled' ||
          result.outcome === 'oversell')
      ) {
        touchedProperties.add(result.propertyId);
      }
    }

    // Immediate ARI push per affected property (oversell guard). Isolated per
    // property via the scheduler.
    for (const propertyId of touchedProperties) {
      await ctx.scheduler.runAfter(0, internal.channel.ari.pushAriForProperty, { propertyId });
    }

    // Stamp lastBookingPollAt on every connected property we didn't already
    // touch, so the admin page shows the feed is being polled even on a quiet
    // cycle.
    await ctx.runMutation(internal.channel.ingest.stampBookingPoll, {});
  },
});

export const ingestRevision = internalMutation({
  args: {
    revisionId: v.string(),
    bookingId: v.string(), // Channex booking unique id
    status: v.union(v.literal('new'), v.literal('modified'), v.literal('cancelled')),
    otaName: v.string(),
    otaReservationCode: v.optional(v.string()),
    roomTypeId: v.string(),
    ratePlanId: v.optional(v.string()),
    arrivalDate: v.string(),
    departureDate: v.string(),
    adults: v.number(),
    children: v.number(),
    guestName: v.string(),
    guestEmail: v.optional(v.string()),
    guestPhone: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ outcome: IngestOutcome; propertyId?: Id<'properties'> }> => {
    const now = Date.now();

    // (1) IDEMPOTENCY FIRST: check-and-insert on (provider 'channex',
    //     eventId = revisionId), in THIS serializable mutation. A duplicate
    //     delivery of the same revision writes nothing else and returns
    //     'duplicate'. This is the same pattern as confirmFromPayment.
    const prior = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_event', (q) =>
        q.eq('provider', 'channex').eq('eventId', args.revisionId),
      )
      .first();
    if (prior) {
      // Already processed this exact revision — no occupancy change, no push.
      return { outcome: 'duplicate' };
    }

    // (2) Map roomTypeId → unitType (by channexRoomTypeId). There is no
    //     dedicated index for channexRoomTypeId; unitTypes per deployment are
    //     few, so a full scan + filter is fine. Unmapped → log + 'unmapped',
    //     NO throw (a throw would re-loop the feed forever). We STILL record the
    //     webhookEvent so a retry of an unmapped revision is a cheap no-op, and
    //     STILL ack (staff must map the room in the Channex dashboard).
    const unitType = await findUnitTypeByChannexRoom(ctx, args.roomTypeId);
    if (!unitType) {
      await ctx.db.insert('webhookEvents', {
        provider: 'channex',
        eventId: args.revisionId,
        type: `booking_${args.status}`,
        processedAt: now,
      });
      // Best-effort: attribute the log to a property if we can find one via the
      // existing channel booking; otherwise we can't log against a property.
      const existingForLog = await findExistingChannelBooking(ctx, args.bookingId);
      if (existingForLog) {
        await ctx.db.insert('channelSyncLog', {
          propertyId: existingForLog.propertyId,
          provider: 'channex',
          kind: 'booking_ingest',
          ok: false,
          detail: `UNMAPPED room_type ${args.roomTypeId} (revision ${args.revisionId}, OTA ${args.otaName}) — map it in the Channex dashboard`,
          ts: now,
        });
      }
      return { outcome: 'unmapped' };
    }
    const propertyId = unitType.propertyId;

    // Record the idempotency ledger row now that we know we'll process this
    // revision. (For the mapped path we insert it here and never again.)
    const recordEvent = async (bookingId?: Id<'bookings'>) => {
      await ctx.db.insert('webhookEvents', {
        provider: 'channex',
        eventId: args.revisionId,
        type: `booking_${args.status}`,
        bookingId,
        processedAt: now,
      });
    };

    // (3) Find the existing channel booking (stable across revisions) by
    //     bookings.by_channelBooking (channelBookingId === args.bookingId).
    const existing = await findExistingChannelBooking(ctx, args.bookingId);

    // ── CANCELLED: cancel the existing booking + free its nights. If we've
    //    never seen this booking, there's nothing to cancel (record + noop).
    if (args.status === 'cancelled') {
      if (!existing) {
        await recordEvent();
        return { outcome: 'noop', propertyId };
      }
      await deleteNightsForBooking(ctx, existing._id);
      await ctx.db.patch(existing._id, {
        status: 'cancelled',
        syncConflict: undefined,
        statusHistory: [...existing.statusHistory, { status: 'cancelled', ts: now }],
        updatedAt: now,
      });
      await recordEvent(existing._id);
      return { outcome: 'cancelled', propertyId };
    }

    // ── NEW / MODIFIED. Compute the block range [arrival, departure). Channex
    //    departure_date is the checkout day (exclusive), matching our half-open
    //    [checkIn, checkOut) convention. Choose a FREE unit of the mapped type.
    const source = `channel:${args.otaName}`;
    const notes = buildNotes(args, now);

    // Existing booking being MODIFIED → rewrite in place (free its old nights
    // first, then re-assign). If none existed but status is 'modified', treat
    // it as a new arrival (we may have missed the 'new' revision).
    if (existing) {
      // Free the old nights so this booking's own occupancy doesn't block its
      // own re-assignment, then pick a free unit (may be the same one).
      await deleteNightsForBooking(ctx, existing._id);
      const assignment = await assignFreeUnit(
        ctx,
        propertyId,
        unitType._id,
        args.arrivalDate,
        args.departureDate,
        existing._id,
      );
      const nights = nightsInRange(args.arrivalDate, args.departureDate);
      if (!assignment) {
        // OVERSELL on a modification — keep the booking (honor the OTA sale),
        // flag it, alert. Keep its old unit for the record; write no nights.
        await ctx.db.patch(existing._id, {
          checkIn: args.arrivalDate,
          checkOut: args.departureDate,
          nights: nights.length,
          adults: args.adults,
          children: args.children,
          status: 'external',
          source,
          channelBookingId: args.bookingId,
          syncConflict: true,
          notes,
          statusHistory: [...existing.statusHistory, { status: 'external', ts: now }],
          updatedAt: now,
        });
        await recordEvent(existing._id);
        await logOversell(ctx, propertyId, args);
        await scheduleStaffAlert(ctx, propertyId, args, existing.confirmationCode);
        return { outcome: 'oversell', propertyId };
      }
      await ctx.db.patch(existing._id, {
        unitId: assignment,
        checkIn: args.arrivalDate,
        checkOut: args.departureDate,
        nights: nights.length,
        adults: args.adults,
        children: args.children,
        status: 'external',
        source,
        channelBookingId: args.bookingId,
        syncConflict: undefined,
        notes,
        statusHistory: [...existing.statusHistory, { status: 'external', ts: now }],
        updatedAt: now,
      });
      for (const date of nights) {
        await ctx.db.insert('unitNights', {
          unitId: assignment,
          date,
          bookingId: existing._id,
          kind: 'external',
        });
      }
      await recordEvent(existing._id);
      return { outcome: 'modified', propertyId };
    }

    // ── NEW booking, no existing. Assign a free unit.
    const assignment = await assignFreeUnit(
      ctx,
      propertyId,
      unitType._id,
      args.arrivalDate,
      args.departureDate,
      null,
    );
    const nights = nightsInRange(args.arrivalDate, args.departureDate);

    if (!assignment) {
      // OVERSELL: no free unit. STILL create the booking (never drop a
      // confirmed OTA sale). We must attach it to SOME unit id (schema requires
      // unitId), so use any active unit of the type as the nominal owner but
      // write NO unitNights (so it never clobbers the internal booking that
      // owns those nights). Flag syncConflict, log, alert.
      const nominalUnit = await anyActiveUnitOfType(ctx, unitType._id);
      const bookingId = await ctx.db.insert('bookings', {
        propertyId,
        unitId: nominalUnit,
        unitTypeId: unitType._id,
        guestId: undefined,
        ratePlanId: undefined,
        checkIn: args.arrivalDate,
        checkOut: args.departureDate,
        nights: nights.length,
        adults: args.adults,
        children: args.children,
        status: 'external',
        source,
        channelBookingId: args.bookingId,
        syncConflict: true,
        confirmationCode: `EXT-${channelCode(args.bookingId)}`,
        statusHistory: [{ status: 'external', ts: now }],
        notes,
        createdAt: now,
        updatedAt: now,
      });
      await recordEvent(bookingId);
      await logOversell(ctx, propertyId, args);
      await scheduleStaffAlert(ctx, propertyId, args, `EXT-${channelCode(args.bookingId)}`);
      return { outcome: 'oversell', propertyId };
    }

    const bookingId = await ctx.db.insert('bookings', {
      propertyId,
      unitId: assignment,
      unitTypeId: unitType._id,
      guestId: undefined,
      ratePlanId: undefined,
      checkIn: args.arrivalDate,
      checkOut: args.departureDate,
      nights: nights.length,
      adults: args.adults,
      children: args.children,
      status: 'external',
      source,
      channelBookingId: args.bookingId,
      syncConflict: undefined,
      confirmationCode: `EXT-${channelCode(args.bookingId)}`,
      statusHistory: [{ status: 'external', ts: now }],
      notes,
      createdAt: now,
      updatedAt: now,
    });
    for (const date of nights) {
      await ctx.db.insert('unitNights', {
        unitId: assignment,
        date,
        bookingId,
        kind: 'external',
      });
    }
    await recordEvent(bookingId);
    return { outcome: 'created', propertyId };
  },
});

/**
 * Thin webhook handler for POST /webhooks/channex. Channex webhooks are just
 * unreliable nudges (no HMAC; optional shared secret) — verify the optional
 * CHANNEX_WEBHOOK_SECRET header if set, then SCHEDULE syncBookingRevisions and
 * return 200 fast. Never trust the webhook body as booking data.
 *
 * [UNCONFIRMED — cheatsheet §4] Channex has NO cryptographic signature. The
 * mitigation is a shared static secret the operator configures and Channex
 * echoes in a custom header. We accept the documented 'x-channex-webhook-secret'
 * header. If the secret is set but the header doesn't match, we still return 200
 * (the poll cron is authoritative — dropping the nudge just adds ≤2 min latency)
 * but log the rejected nudge for observability. If no secret is configured, any
 * nudge is accepted (staging default). TODO(channex-cert): confirm the exact
 * header name Channex uses and whether IP allowlisting is available.
 */
export const handleWebhookNudge = internalAction({
  args: { headers: v.record(v.string(), v.string()) },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = process.env.CHANNEX_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        args.headers['x-channex-webhook-secret'] ?? args.headers['x-channex-webhook-secret'.toLowerCase()];
      if (provided !== secret) {
        // Rejected nudge — do NOT schedule a poll off an unauthenticated nudge,
        // but still 200 (the 2-min poll cron catches everything anyway). Log it.
        await ctx.runMutation(internal.channel.ingest.logRejectedNudge, {});
        return { status: 200 };
      }
    }
    // Authenticated (or no secret configured) → schedule a feed pull and return.
    await ctx.scheduler.runAfter(0, internal.channel.ingest.syncBookingRevisions, {});
    return { status: 200 };
  },
});

// ── Internal helper mutations (this module's territory) ─────────────────────

/** Stamp lastBookingPollAt on every connected channelSync row. */
export const stampBookingPoll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('channelSync').collect();
    const now = Date.now();
    for (const row of rows) {
      await ctx.db.patch(row._id, { lastBookingPollAt: now });
    }
  },
});

/** Append a channelSyncLog note that an unauthenticated webhook nudge arrived. */
export const logRejectedNudge = internalMutation({
  args: {},
  handler: async (ctx) => {
    // No property context on a rejected nudge; log against every connected
    // property so it's visible on the admin page (there are few properties).
    const rows = await ctx.db.query('channelSync').collect();
    const now = Date.now();
    for (const row of rows) {
      await ctx.db.insert('channelSyncLog', {
        propertyId: row.propertyId,
        provider: 'channex',
        kind: 'error',
        ok: false,
        detail: 'Rejected webhook nudge: x-channex-webhook-secret mismatch (poll cron still authoritative)',
        ts: now,
      });
    }
  },
});

// ── Pure/db helpers (module-local) ──────────────────────────────────────────

/** Find a unitType by its Channex room type UUID. Full scan (few unitTypes). */
async function findUnitTypeByChannexRoom(
  ctx: MutationCtx,
  channexRoomTypeId: string,
): Promise<Doc<'unitTypes'> | null> {
  const all = await ctx.db.query('unitTypes').collect();
  return all.find((t) => t.channexRoomTypeId === channexRoomTypeId) ?? null;
}

/** Find the existing channel booking for a Channex booking id (still active). */
async function findExistingChannelBooking(
  ctx: MutationCtx,
  channelBookingId: string,
): Promise<Doc<'bookings'> | null> {
  const rows = await ctx.db
    .query('bookings')
    .withIndex('by_channelBooking', (q) => q.eq('channelBookingId', channelBookingId))
    .collect();
  // Prefer a non-cancelled row; there should be at most one live row per
  // channel booking id, but a re-created (previously cancelled then re-booked)
  // id is theoretically possible — prefer the live one, else the latest.
  const live = rows.find((b) => b.status !== 'cancelled');
  if (live) return live;
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
}

/**
 * Assign a FREE unit of the type for [arrival, departure) using the SAME
 * conflict logic as icalImport/createHold: a unit is free iff it has NO
 * unitNights row (of ANY kind — internal-blocked nights are never clobbered) in
 * the range. `excludeBookingId` lets a modification ignore its own (already-
 * deleted) nights defensively. Returns the first free active unit's id, or null
 * (real oversell) when every active unit of the type is occupied.
 */
async function assignFreeUnit(
  ctx: MutationCtx,
  _propertyId: Id<'properties'>,
  unitTypeId: Id<'unitTypes'>,
  arrivalDate: string,
  departureDate: string,
  _excludeBookingId: Id<'bookings'> | null,
): Promise<Id<'units'> | null> {
  const units = await ctx.db
    .query('units')
    .withIndex('by_type', (q) => q.eq('unitTypeId', unitTypeId))
    .collect();
  const activeUnits = units.filter((u) => u.status === 'active');
  for (const unit of activeUnits) {
    // One indexed range read per unit: any row in [arrival, departure) means
    // occupied. (The modifying booking's own nights were deleted by the caller
    // before this call, so they don't count as a false conflict.)
    const conflict = await ctx.db
      .query('unitNights')
      .withIndex('by_unit_date', (q) =>
        q.eq('unitId', unit._id).gte('date', arrivalDate).lt('date', departureDate),
      )
      .first();
    if (!conflict) return unit._id;
  }
  return null;
}

/** Any active unit of the type (nominal owner for an oversell booking). */
async function anyActiveUnitOfType(
  ctx: MutationCtx,
  unitTypeId: Id<'unitTypes'>,
): Promise<Id<'units'>> {
  const units = await ctx.db
    .query('units')
    .withIndex('by_type', (q) => q.eq('unitTypeId', unitTypeId))
    .collect();
  const active = units.find((u) => u.status === 'active') ?? units[0];
  // A mapped unit type always has ≥1 unit in practice; if somehow none exist,
  // this throws (caught by syncBookingRevisions → no ack → retry). But a mapped
  // type with zero units is an operator misconfiguration, not a lost-booking
  // path we can silently create against.
  if (!active) {
    throw new Error(`No units exist for unit type ${unitTypeId} — cannot record oversell booking`);
  }
  return active._id;
}

async function deleteNightsForBooking(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const rows = await ctx.db
    .query('unitNights')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
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

/**
 * Build the booking notes array carrying the OTA guest identity + reservation
 * details. Channel bookings have no guestId (no OpenStays account), so the tape
 * / emails render the guest from notes. Keeps ingest simple (no guest upsert)
 * while preserving who the OTA guest is.
 */
function buildNotes(
  args: {
    guestName: string;
    guestEmail?: string;
    guestPhone?: string;
    otaName: string;
    otaReservationCode?: string;
    amountCents?: number;
    currency?: string;
  },
  ts: number,
): Array<{ ts: number; text: string; by: string }> {
  const parts: string[] = [`${args.otaName} booking for ${args.guestName.trim() || 'OTA Guest'}`];
  if (args.otaReservationCode) parts.push(`conf ${args.otaReservationCode}`);
  if (args.guestEmail) parts.push(args.guestEmail);
  if (args.guestPhone) parts.push(args.guestPhone);
  if (args.amountCents !== undefined) {
    parts.push(`${(args.amountCents / 100).toFixed(2)} ${args.currency ?? ''}`.trim());
  }
  return [{ ts, text: parts.join(' · '), by: 'channel' }];
}

/** Short, stable confirmation-code suffix from a Channex booking id. */
function channelCode(channelBookingId: string): string {
  const cleaned = channelBookingId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (cleaned.slice(0, 8) || 'UNKNOWN').padEnd(6, '0');
}

async function logOversell(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  args: { bookingId: string; otaName: string; arrivalDate: string; departureDate: string; roomTypeId: string },
): Promise<void> {
  await ctx.db.insert('channelSyncLog', {
    propertyId,
    provider: 'channex',
    kind: 'booking_ingest',
    ok: false,
    detail:
      `OVERSELL: ${args.otaName} booking ${args.bookingId} for ${args.arrivalDate}..${args.departureDate} ` +
      `(room_type ${args.roomTypeId}) has NO free unit — booking created + flagged, staff must resolve`,
    ts: Date.now(),
  });
}

async function scheduleStaffAlert(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  args: { otaName: string; arrivalDate: string; departureDate: string; guestName: string },
  confirmationCode: string,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.email.sendStaffAlert, {
    propertyId,
    subject: `OVERSELL: ${args.otaName} booking with no available unit (${confirmationCode})`,
    body:
      `An OTA (${args.otaName}) confirmed a booking for ${args.guestName} arriving ${args.arrivalDate} ` +
      `and departing ${args.departureDate}, but every unit of that type is already occupied for those ` +
      `nights. The booking was recorded (confirmation ${confirmationCode}) and flagged as a sync ` +
      `conflict so it isn't lost — but it CANNOT currently be honored. Please resolve the overlap ` +
      `immediately (move a guest, open another unit, or contact the OTA to relocate the reservation).`,
  });
}
