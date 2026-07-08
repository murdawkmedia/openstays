import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';

// ---------------------------------------------------------------------------
// Booking ingest (M6-prep) — Channex → OpenStays inbound. The PULL feed is
// authoritative; webhooks are only nudges. Builder implements the stubs.
//
// Flow (syncBookingRevisions, called by cron + webhook nudge):
//  1. provider.fetchBookingRevisions() → NormalizedRevision[].
//  2. For EACH revision, in feed order: runMutation ingestRevision.
//  3. ONLY after ingestRevision succeeds (durable write): provider
//     .ackBookingRevision(revisionId). Never ack before the local write, or a
//     booking is lost; un-acked revisions re-appear for ~30 min (safe).
//  4. After any ingest, schedule internal.channel.ari.pushAriForProperty so the
//     new occupancy is reflected on OTAs immediately (oversell guard).
//
// ingestRevision (one serializable mutation per revision):
//  - Idempotency: webhookEvents check-and-insert on (provider 'channex',
//    eventId = revisionId). Duplicate → return {outcome:'duplicate'}, ack still
//    happens (caller acks on success).
//  - Map revision.roomTypeId → the unitType with that channexRoomTypeId (that
//    property). Unmapped → {outcome:'unmapped'} + channelSyncLog error + still
//    ack (nothing we can do; staff must map). Do NOT throw (would re-loop).
//  - Find existing channel booking by bookings.by_channelBooking (channelBookingId
//    === revision.bookingId):
//      status 'cancelled' → cancel that booking + free its unitNights.
//      status 'new'|'modified' with no existing → assign a FREE unit of the
//        mapped type for [arrival, departure) (pick the unit with no unitNights
//        overlap; conflict rule below), insert booking status 'external',
//        source `channel:${otaName}`, channelBookingId, block nights kind
//        'external'.
//      status 'modified' with existing → rewrite dates/unit + nights.
//  - OVERSELL RULE (binding): a channel booking is a CONFIRMED OTA sale — it
//    must be honored. If NO free unit exists for the dates (all units of the
//    type occupied by internal or other-channel bookings), this is a real
//    oversell: still create the booking (so it isn't lost), set
//    syncConflict=true, channelSyncLog kind 'booking_ingest' ok:false with an
//    OVERSELL detail, and (builder) schedule a staff alert email via
//    internal.email.sendStaffAlert. NEVER silently drop it.
//  - Return {outcome:'created'|'modified'|'cancelled'|'duplicate'|'unmapped'|'oversell'}.
// ---------------------------------------------------------------------------

export const syncBookingRevisions = internalAction({
  args: {},
  handler: async (): Promise<void> => {
    // builder — no-op until implemented (cron/webhook safely do nothing).
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
  handler: async (): Promise<{ outcome: string }> => {
    // builder
    return { outcome: 'unimplemented' };
  },
});

/**
 * Thin webhook handler for POST /webhooks/channex. Channex webhooks are just
 * unreliable nudges (no HMAC; optional shared secret) — verify the optional
 * CHANNEX_WEBHOOK_SECRET header if set, then SCHEDULE syncBookingRevisions and
 * return 200 fast. Never trust the webhook body as booking data. (builder)
 */
export const handleWebhookNudge = internalAction({
  args: { headers: v.record(v.string(), v.string()) },
  handler: async (): Promise<{ status: number }> => {
    // builder — until implemented, acknowledge the nudge (feed poll is the
    // real path, so a 200 no-op is safe).
    return { status: 200 };
  },
});
