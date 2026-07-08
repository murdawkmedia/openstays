// ---------------------------------------------------------------------------
// ChannelManagerProvider contract (M6-prep) — the abstraction OpenStays talks
// to for OTA distribution (Booking.com / Airbnb / Expedia / VRBO via Channex).
// Mirrors the PaymentProvider pattern: one interface, an env-gated
// implementation, dormant until configured.
//
// Channex model (researched 2026-07-08, see openstays-ops notes):
//   Group → Property → Room Type → Rate Plan. Availability is a COUNT of
//   sellable rooms per Room Type per date (NOT per physical unit). OpenStays
//   maps unitType → Channex room type and pushes (active units − occupied
//   units) as the count. Rate plans carry rates + restrictions.
//
//   Auth: 'user-api-key' header. Base URL from CHANNEX_BASE_URL env (default
//   https://staging.channex.io). Two ARI endpoints: POST /api/v1/availability
//   (counts) and POST /api/v1/restrictions (rates + min-stay + CTA/CTD/
//   stop-sell). Bookings come via a PULL feed (GET /api/v1/booking_revisions/
//   feed → process → POST /api/v1/booking_revisions/:id/ack); webhooks are
//   only unreliable "go pull" nudges (no HMAC — optional shared-secret header).
//   Oversell prevention is the PMS's job: push updated counts immediately on
//   every occupancy change. 200 OK can still carry per-row meta.warnings.
//   Rate limit: 10 availability + 10 restriction requests / minute / property.
// ---------------------------------------------------------------------------

export type ChannelProviderName = 'channex';

/** One availability count for a Channex room type on one date. */
export type AvailabilityRow = {
  roomTypeId: string; // Channex room_type_id (UUID)
  date: string; // 'YYYY-MM-DD'
  availability: number; // non-negative count of sellable rooms
};

/** Rate + restrictions for a Channex rate plan on one date. */
export type RestrictionRow = {
  ratePlanId: string; // Channex rate_plan_id (UUID)
  date: string; // 'YYYY-MM-DD'
  /** Nightly rate in MAJOR currency units as a decimal string ('129.00').
   *  Converted from OpenStays integer cents at the client boundary. */
  rate?: string;
  minStayArrival?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
};

/** Result of an ARI push — warnings are per-row problems returned inside a 200. */
export type AriPushResult = { ok: boolean; warnings: string[] };

/** A normalized OTA booking revision, provider-shape flattened for ingest. */
export type NormalizedRevision = {
  revisionId: string; // Channex revision UUID — the idempotency + ack key
  bookingId: string; // Channex booking unique id (stable across revisions)
  status: 'new' | 'modified' | 'cancelled';
  otaName: string; // 'Booking.com' | 'Airbnb' | ...
  otaReservationCode?: string;
  roomTypeId: string; // Channex room_type_id → maps to a unitType
  ratePlanId?: string;
  arrivalDate: string; // 'YYYY-MM-DD'
  departureDate: string; // exclusive
  adults: number;
  children: number;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  amountCents?: number;
  currency?: string;
};

export interface ChannelManagerProvider {
  readonly name: ChannelProviderName;
  /** True when this deployment has the env vars to talk to the channel manager. */
  isConfigured(): boolean;

  /** Push availability counts (POST /api/v1/availability). Batches many rows. */
  pushAvailability(channexPropertyId: string, rows: AvailabilityRow[]): Promise<AriPushResult>;

  /** Push rates + restrictions (POST /api/v1/restrictions). Batches many rows. */
  pushRestrictions(channexPropertyId: string, rows: RestrictionRow[]): Promise<AriPushResult>;

  /** Fetch unacknowledged booking revisions (GET /booking_revisions/feed). */
  fetchBookingRevisions(): Promise<NormalizedRevision[]>;

  /** Acknowledge a revision (POST /booking_revisions/:id/ack) AFTER durable save. */
  ackBookingRevision(revisionId: string): Promise<void>;
}
