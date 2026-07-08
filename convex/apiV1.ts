import { httpAction } from './_generated/server';

// ---------------------------------------------------------------------------
// HTTP API v1 (M1.5) — the automation surface consumed by the openstays CLI,
// the MCP server, and any script. Mounted in http.ts under /api/v1/.
//
// AUTH: 'Authorization: Bearer osk_...' — SHA-256 the token, look it up via
// internal.apiKeys.verifyKey. Missing/unknown/revoked → 401. A route whose
// scope requirement is 'write' rejects 'read' keys with 403. Touch
// lastUsedAt at most once/hour. DEMO_MODE grants NOTHING here — API keys are
// required even on the demo (automations must behave identically everywhere).
//
// SHAPE: JSON only. Success = 200 {data: ...}. Errors = {error: {code,
// message}} with 400/401/403/404/409. Money stays integer cents; dates stay
// 'YYYY-MM-DD' strings. Handlers NEVER reimplement domain logic — they call
// the same public/internal queries + mutations the UI uses (createHold,
// cancelByGuest, availability.forUnitType, tapeForProperty via an internal
// staff-bypassing variant, etc.), so every money/availability guarantee
// applies to API callers identically.
//
// ROUTES (v1; builder H implements in this file):
//   GET  /api/v1/health                → {ok: true, version}  (no auth)
//   GET  /api/v1/properties            → active properties (read)
//   GET  /api/v1/unit-types?property=<slug>                    (read)
//   GET  /api/v1/units?property=<slug>                         (read)
//   GET  /api/v1/rate-plans?property=<slug>&unitType=<slug>    (read)
//   GET  /api/v1/availability?property=<slug>&unitType=<slug>&from&to (read)
//   GET  /api/v1/tape?property=<slug>&from&to                  (read)
//   GET  /api/v1/bookings?status&from&to&limit                 (read)
//   GET  /api/v1/bookings/<confirmationCode>                   (read)
//   POST /api/v1/bookings/hold   body = createHold args        (write)
//   POST /api/v1/bookings/<confirmationCode>/cancel body={email} (write)
//   POST /api/v1/promo-codes/preview body={code, ...}          (read)
//
// A single dispatching httpAction keeps http.ts wiring to two lines (GET +
// POST pathPrefix '/api/v1/'). 404 for unknown paths.
// ---------------------------------------------------------------------------

export const handle = httpAction(async (_ctx, _request) => {
  // builder H — full router + auth + handlers.
  return new Response(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'API v1 lands in M1.5' } }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
});
