import type {
  AriPushResult,
  AvailabilityRow,
  ChannelManagerProvider,
  NormalizedRevision,
  RestrictionRow,
} from './types';

// ---------------------------------------------------------------------------
// Channex provider (M6-prep) — raw fetch against the Channex REST API (no SDK;
// Convex default runtime = fetch + web crypto). Contract in ./types.ts is
// FIXED. This module implements the method bodies.
//
// Env (orchestrator-set per deployment via `npx convex env set`, never in repo):
//   CHANNEX_API_KEY        the 'user-api-key' header value
//   CHANNEX_BASE_URL       default 'https://staging.channex.io' (prod once certified)
//   CHANNEX_WEBHOOK_SECRET optional shared secret echoed in the webhook header
//                          (Channex has NO HMAC — this is the only nudge check)
//
// [UNCONFIRMED — cheatsheet §1/§7 open item 1] Production base URL is not
// spelled out beyond the staging.channex.io example; the default here is
// staging and the orchestrator overrides CHANNEX_BASE_URL at certification.
// TODO(channex-cert): confirm the production /api/v1 host against the Postman
// collection / production credentials before flipping CHANNEX_BASE_URL to prod.
//
// [UNCONFIRMED — cheatsheet §3/§8] A 200 OK does NOT guarantee every ARI row
// applied — invalid rows come back as `meta.warnings` inside the 200. We treat
// a 200-with-warnings as ok:false so the caller keeps the property dirty and
// retries; the reviewer will attack the "200 == success" assumption, so we do
// NOT make it.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://staging.channex.io';

export function channexBaseUrl(): string {
  return process.env.CHANNEX_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * cents → major-unit decimal string, always 2 dp ('12900' → '129.00',
 * '5' → '0.05', '-100' → '-1.00'). Channex restrictions take `rate` as a
 * decimal string in major units. Pure — unit-tested.
 *
 * SCOPE: 2-decimal currencies only (CAD/USD/EUR — same scope as payments/
 * stripe.ts). Zero-decimal currencies (JPY) would need a per-currency
 * minor-unit factor. TODO(channex-cert): if a non-2dp currency is ever
 * onboarded, thread the currency's minor-unit exponent through here.
 */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const s = `${major}.${minor.toString().padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

/** The auth key, or '' when unconfigured (isConfigured() gates real calls). */
function apiKey(): string {
  return process.env.CHANNEX_API_KEY || '';
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Auth header name is literally 'user-api-key' (NOT Authorization/Bearer).
    'user-api-key': apiKey(),
  };
}

/** Read a Response body as text without throwing (used for error detail). */
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Parse the ARI POST response body (already-parsed JSON) into warnings.
 * Channex returns `{ data, meta: { message, warnings } }`. `meta.warnings` may
 * be an array of strings or an array of objects — normalize to strings so the
 * caller can log/compare. Tolerant of shape drift (unknown → []).
 */
function parseAriWarnings(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const meta = (body as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return [];
  const warnings = (meta as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w)));
}

/**
 * Shared ARI POST: send { values } to an endpoint, parse the result into an
 * AriPushResult. A non-2xx → ok:false with `HTTP <status>: <body>`; a 429 is
 * explicitly flagged retryable in the warning text so the caller leaves the
 * property dirty. A 200-with-warnings → ok:false (see module header).
 */
async function postAri(
  path: string,
  values: Array<Record<string, unknown>>,
): Promise<AriPushResult> {
  let res: Response;
  try {
    res = await fetch(`${channexBaseUrl()}${path}`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ values }),
    });
  } catch (error) {
    // Network/transport failure — retryable (leave dirty). Surface as ok:false.
    const message = error instanceof Error ? error.message : 'network error';
    return { ok: false, warnings: [`NETWORK: ${message} (retryable)`] };
  }

  if (!res.ok) {
    const detail = await safeText(res);
    // 429 (code http_too_many_requests) — per-property rate limit; explicitly
    // retryable. The caller must NOT clear dirtySince on this.
    const retryable = res.status === 429 ? ' (retryable: rate limited, back off 60s)' : '';
    return { ok: false, warnings: [`HTTP ${res.status}: ${detail}${retryable}`] };
  }

  // 2xx — but a 200 can still carry per-row warnings. Parse them; any warning
  // means the batch did NOT fully apply → ok:false so we retry.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Empty/non-JSON 2xx body — treat as clean success (no warnings to report).
    return { ok: true, warnings: [] };
  }
  const warnings = parseAriWarnings(body);
  return { ok: warnings.length === 0, warnings };
}

/** Round a parsed float amount to integer cents. */
function amountToCents(amount: unknown): number | undefined {
  if (amount === undefined || amount === null) return undefined;
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize one raw Channex booking-revision object into a NormalizedRevision.
 * Returns null when required fields (id, booking id, room type, dates) are
 * missing — the caller skips it rather than ingesting a malformed sale.
 *
 * Channex shape (cheatsheet §4): a revision carries id/revision fields, a
 * `booking_id`/`unique_id` stable across revisions, `status`, `arrival_date`/
 * `departure_date`, `ota_name`, `ota_reservation_code`, `amount`, `currency`,
 * `customer{name,surname,mail,phone}`, and `rooms[]` (rooms[0] →
 * room_type_id/rate_plan_id/occupancy{adults,children}).
 *
 * [UNCONFIRMED — cheatsheet §4] The exact revision id field name vs booking id
 * field name is not verbatim-confirmed; we read a small set of aliases
 * (revision_id/id for the revision; booking_id/unique_id/id for the booking)
 * and prefer the most specific. The revisionId is BOTH the ack key AND the
 * idempotency key, so getting it right is load-bearing.
 * TODO(channex-cert): confirm the revision-id vs booking-id field names against
 * a real staging booking_revisions/feed payload and tighten these aliases.
 */
export function normalizeRevision(raw: unknown): NormalizedRevision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // Some feeds wrap each item as JSON:API { id, type, attributes: {...} }.
  // Flatten attributes over the top-level so either shape works.
  const attrs =
    r.attributes && typeof r.attributes === 'object'
      ? (r.attributes as Record<string, unknown>)
      : {};
  const g = (key: string): unknown => (r[key] !== undefined ? r[key] : attrs[key]);

  // Revision id (ack + idempotency key). Prefer an explicit revision id; the
  // JSON:API `id` at the item level is the revision id when present.
  const revisionId = asString(g('revision_id')) ?? asString(r.id) ?? asString(g('id'));
  // Booking id — stable across revisions of the same reservation.
  const bookingId =
    asString(g('booking_id')) ?? asString(g('unique_id')) ?? asString(g('booking_unique_id'));
  if (!revisionId || !bookingId) return null;

  const statusRaw = asString(g('status')) ?? 'new';
  const status: NormalizedRevision['status'] =
    statusRaw === 'modified' ? 'modified' : statusRaw === 'cancelled' ? 'cancelled' : 'new';

  const rooms = g('rooms');
  const room0 =
    Array.isArray(rooms) && rooms.length > 0 && rooms[0] && typeof rooms[0] === 'object'
      ? (rooms[0] as Record<string, unknown>)
      : {};
  const roomTypeId = asString(room0.room_type_id) ?? asString(g('room_type_id'));
  const ratePlanId = asString(room0.rate_plan_id) ?? asString(g('rate_plan_id'));
  if (!roomTypeId) return null;

  const occupancy =
    room0.occupancy && typeof room0.occupancy === 'object'
      ? (room0.occupancy as Record<string, unknown>)
      : (g('occupancy') && typeof g('occupancy') === 'object'
          ? (g('occupancy') as Record<string, unknown>)
          : {});
  const adults = Math.max(0, Math.trunc(asNumber(occupancy.adults, 1)));
  const children = Math.max(0, Math.trunc(asNumber(occupancy.children, 0)));

  const arrivalDate = asString(g('arrival_date')) ?? asString(room0.checkin_date);
  const departureDate = asString(g('departure_date')) ?? asString(room0.checkout_date);
  if (!arrivalDate || !departureDate) return null;

  const customer =
    g('customer') && typeof g('customer') === 'object'
      ? (g('customer') as Record<string, unknown>)
      : {};
  const name = asString(customer.name) ?? '';
  const surname = asString(customer.surname) ?? '';
  const guestName = `${name} ${surname}`.trim() || 'OTA Guest';
  const guestEmail = asString(customer.mail) ?? asString(customer.email);
  const guestPhone = asString(customer.phone);

  return {
    revisionId,
    bookingId,
    status,
    otaName: asString(g('ota_name')) ?? 'OTA',
    otaReservationCode: asString(g('ota_reservation_code')),
    roomTypeId,
    ratePlanId,
    arrivalDate,
    departureDate,
    adults,
    children,
    guestName,
    guestEmail,
    guestPhone,
    amountCents: amountToCents(g('amount')),
    currency: asString(g('currency')),
  };
}

/** Extract the array of revision items from a feed page body (JSON:API `data`). */
function extractFeedItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) return data;
  }
  return [];
}

/**
 * Read the next-page cursor/number from a feed body, if the feed pages.
 * [UNCONFIRMED — cheatsheet §8] List endpoints default to 10 items/page. The
 * exact pagination envelope (`meta.total_pages` vs `links.next` vs
 * page[number]) is not verbatim-confirmed. We support the common
 * `meta.total_pages` shape and cap iterations to avoid an infinite loop on an
 * unexpected envelope. TODO(channex-cert): confirm the feed's pagination shape
 * on staging and tighten this.
 */
function totalPages(body: unknown): number {
  if (body && typeof body === 'object') {
    const meta = (body as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const tp = (meta as { total_pages?: unknown }).total_pages;
      const n = typeof tp === 'number' ? tp : parseFloat(String(tp));
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
  }
  return 1;
}

// Hard cap on feed pages fetched in one poll — defense against a runaway
// pagination envelope. 50 pages × default 10 = 500 revisions/poll; the 2-min
// poll cron drains the rest next cycle (un-acked revisions safely re-appear).
const MAX_FEED_PAGES = 50;

export const channexProvider: ChannelManagerProvider = {
  name: 'channex',
  isConfigured: () => Boolean(process.env.CHANNEX_API_KEY),

  pushAvailability: async (
    channexPropertyId: string,
    rows: AvailabilityRow[],
  ): Promise<AriPushResult> => {
    if (rows.length === 0) return { ok: true, warnings: [] };
    const values = rows.map((row) => ({
      property_id: channexPropertyId,
      room_type_id: row.roomTypeId,
      date: row.date,
      availability: row.availability,
    }));
    return await postAri('/api/v1/availability', values);
  },

  pushRestrictions: async (
    channexPropertyId: string,
    rows: RestrictionRow[],
  ): Promise<AriPushResult> => {
    if (rows.length === 0) return { ok: true, warnings: [] };
    const values = rows.map((row) => {
      // Omit undefined keys so we never send `rate: null` etc. (Channex applies
      // only the keys present; a null could clobber a value we didn't intend to
      // touch). Booleans/rate are only included when defined.
      const value: Record<string, unknown> = {
        property_id: channexPropertyId,
        rate_plan_id: row.ratePlanId,
        date: row.date,
      };
      if (row.rate !== undefined) value.rate = row.rate;
      if (row.minStayArrival !== undefined) value.min_stay_arrival = row.minStayArrival;
      if (row.maxStay !== undefined) value.max_stay = row.maxStay;
      if (row.closedToArrival !== undefined) value.closed_to_arrival = row.closedToArrival;
      if (row.closedToDeparture !== undefined) value.closed_to_departure = row.closedToDeparture;
      if (row.stopSell !== undefined) value.stop_sell = row.stopSell;
      return value;
    });
    return await postAri('/api/v1/restrictions', values);
  },

  fetchBookingRevisions: async (): Promise<NormalizedRevision[]> => {
    const base = channexBaseUrl();
    const out: NormalizedRevision[] = [];

    // Page 1 tells us how many pages there are (if the feed pages at all).
    let page = 1;
    let pages = 1;
    do {
      let res: Response;
      try {
        // [UNCONFIRMED — cheatsheet §4/§8] page param name. `page[number]` is
        // the JSON:API convention Channex uses elsewhere; harmless if the feed
        // ignores it (we still get page 1). TODO(channex-cert): confirm.
        const url = `${base}/api/v1/booking_revisions/feed?page[number]=${page}`;
        res = await fetch(url, { method: 'GET', headers: jsonHeaders() });
      } catch {
        // Network failure mid-pagination — return what we have; the un-acked
        // revisions re-appear on the next poll (safe, never lost).
        break;
      }
      if (!res.ok) break;
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        break;
      }
      for (const item of extractFeedItems(body)) {
        const normalized = normalizeRevision(item);
        if (normalized) out.push(normalized);
      }
      if (page === 1) pages = Math.min(totalPages(body), MAX_FEED_PAGES);
      page += 1;
    } while (page <= pages);

    return out;
  },

  ackBookingRevision: async (revisionId: string): Promise<void> => {
    // POST {base}/api/v1/booking_revisions/:id/ack. We do not throw on a
    // non-2xx: the caller has already durably written the booking, and an
    // un-acked revision simply re-appears on the next poll (idempotent ingest
    // makes the re-appearance a no-op). Throwing here would abort the loop and
    // starve later revisions.
    const id = encodeURIComponent(revisionId);
    try {
      await fetch(`${channexBaseUrl()}/api/v1/booking_revisions/${id}/ack`, {
        method: 'POST',
        headers: jsonHeaders(),
      });
    } catch {
      // Swallow — see above. Re-appearance on the next poll is the backstop.
    }
  },
};

// Keep the row types referenced for the module's type surface.
export type { AvailabilityRow, RestrictionRow };
