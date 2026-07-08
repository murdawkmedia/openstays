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
// FIXED. Builder implements the method bodies.
//
// Env (orchestrator-set per deployment via `npx convex env set`, never in repo):
//   CHANNEX_API_KEY        the 'user-api-key' header value
//   CHANNEX_BASE_URL       default 'https://staging.channex.io' (prod once certified)
//   CHANNEX_WEBHOOK_SECRET optional shared secret echoed in the webhook header
//                          (Channex has NO HMAC — this is the only nudge check)
//
// Implementation notes for the builder:
//   - Auth header name is literally 'user-api-key' (NOT Authorization/Bearer).
//   - pushAvailability → POST {base}/api/v1/availability, body { values: rows
//     mapped to {property_id, room_type_id, date, availability} }. Inspect
//     meta.warnings in the 200 response — a 200 does NOT mean every row applied.
//   - pushRestrictions → POST {base}/api/v1/restrictions, body { values: rows
//     mapped to {property_id, rate_plan_id, date, rate, min_stay_arrival,
//     max_stay, closed_to_arrival, closed_to_departure, stop_sell} } (omit
//     undefined keys). rate is a decimal string in MAJOR units.
//   - Respect the rate limit (10/min/property each) — the callers batch a whole
//     horizon into ONE availability + ONE restrictions call, so this is mostly
//     the ceiling; still surface 429 (code http_too_many_requests) as a
//     retryable AriPushResult{ok:false} rather than throwing.
//   - fetchBookingRevisions → GET {base}/api/v1/booking_revisions/feed, then
//     normalize each into NormalizedRevision (rooms[0] gives room_type_id /
//     rate_plan_id / occupancy; amount → cents). Paginate if needed.
//   - ackBookingRevision → POST {base}/api/v1/booking_revisions/:id/ack.
//   - Errors: {"errors":{"code","title"}}; 401 bad key, 422 validation, 429 rate.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://staging.channex.io';

export function channexBaseUrl(): string {
  return process.env.CHANNEX_BASE_URL || DEFAULT_BASE_URL;
}

export const channexProvider: ChannelManagerProvider = {
  name: 'channex',
  isConfigured: () => Boolean(process.env.CHANNEX_API_KEY),

  pushAvailability: async (): Promise<AriPushResult> => {
    throw new Error('NOT_IMPLEMENTED: channex.pushAvailability (builder)');
  },
  pushRestrictions: async (): Promise<AriPushResult> => {
    throw new Error('NOT_IMPLEMENTED: channex.pushRestrictions (builder)');
  },
  fetchBookingRevisions: async (): Promise<NormalizedRevision[]> => {
    throw new Error('NOT_IMPLEMENTED: channex.fetchBookingRevisions (builder)');
  },
  ackBookingRevision: async (): Promise<void> => {
    throw new Error('NOT_IMPLEMENTED: channex.ackBookingRevision (builder)');
  },
};

// Keep the unused-import types referenced for the stub's type surface.
export type { AvailabilityRow, RestrictionRow };
