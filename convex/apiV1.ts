import { ConvexError, v } from 'convex/values';
import { httpAction, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { addDays, daysBetween } from '../shared/pricing';
import { sha256HexOf } from './apiKeys';
import { requireAutomationPropertyCapability } from './staff';
import type { OperationalCapability } from '../shared/operations';
import { buildFrontDeskQueues } from './frontDesk';
import { buildHousekeepingBoard } from './housekeeping';

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
// message}} with 400/401/403/404/409/429. Money stays integer cents; dates stay
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
//   GET  /api/v1/operations/<view>?property=<slug>             (read)
//   POST /api/v1/operations/<action> body={property,requestId,...} (write)
//
// A single dispatching httpAction keeps http.ts wiring to two lines (GET +
// POST pathPrefix '/api/v1/'). 404 for unknown paths.
// ---------------------------------------------------------------------------

const API_VERSION = 'v1';
const TOUCH_INTERVAL_MS = 60 * 60 * 1000; // touch lastUsedAt at most once/hour
const DEFAULT_AVAILABILITY_DAYS = 30;
const MAX_WINDOW_DAYS = 120; // forUnitType/tape clamp to this; keep the API honest
const DEFAULT_BOOKINGS_LIMIT = 50;
const MAX_BOOKINGS_LIMIT = 200;

// ── JSON helpers ───────────────────────────────────────────────────────────

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown): Response {
  return jsonResponse(200, { data });
}

function err(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

/**
 * Map a ConvexError thrown by a domain function to an HTTP status. e.data is
 * either {code, message} (our domain convention) or a bare string code. We
 * choose the status from the code so the same guarantees the UI sees (a taken
 * night is a conflict, a missing booking is a 404) reach API callers verbatim.
 */
const CONFLICT_CODES = new Set([
  'DATES_UNAVAILABLE',
  'NIGHTS_UNAVAILABLE',
  'TOO_MANY_HOLDS',
  'PROMO_EXHAUSTED',
  'PROMO_ALREADY_USED',
  'UNIT_UNAVAILABLE',
  'UNIT_NOT_YET_BOOKABLE',
  'VERSION_CONFLICT',
]);
const NOT_FOUND_CODES = new Set(['NOT_FOUND', 'BOOKING_NOT_FOUND']);
const FORBIDDEN_CODES = new Set(['OWNER_ONLY', 'NOT_STAFF', 'CAPABILITY_DENIED', 'PROPERTY_ACCESS_DENIED', 'AUTOMATION_ACTOR_INACTIVE', 'AUTOMATION_KEY_INVALID', 'AUTOMATION_ACTOR_REQUIRED']);
const UNAUTH_CODES = new Set(['UNAUTHENTICATED']);
const RATE_LIMIT_CODES = new Set(['AUTOMATION_CLAIM_LIMIT']);
// Stay-rule / validation codes surfaced by validateStayRules & guards → 400.

function mapConvexError(error: unknown): Response {
  if (error instanceof ConvexError) {
    let data = error.data as unknown;
    let code = 'INVALID_REQUEST';
    let message = 'The request could not be completed.';
    // When a ConvexError crosses a ctx.runMutation/runQuery boundary from this
    // httpAction, its `.data` can arrive as a JSON-STRINGIFIED object (that is
    // how convex-test serializes it, and Convex may too). Re-parse a string
    // that is actually a {code,message} object so both shapes map correctly.
    if (typeof data === 'string') {
      const trimmed = data.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'string' || (parsed && typeof parsed === 'object')) data = parsed;
        } catch {
          /* leave as a bare string code */
        }
      }
    }
    if (typeof data === 'string') {
      code = data;
      message = data;
    } else if (data && typeof data === 'object') {
      const d = data as { code?: string; message?: string };
      if (typeof d.code === 'string') code = d.code;
      if (typeof d.message === 'string') message = d.message;
      else if (typeof d.code === 'string') message = d.code;
    }
    if (UNAUTH_CODES.has(code)) return err(401, code, message);
    if (FORBIDDEN_CODES.has(code)) return err(403, code, message);
    if (RATE_LIMIT_CODES.has(code)) return err(429, code, message);
    if (NOT_FOUND_CODES.has(code)) return err(404, code, message);
    if (CONFLICT_CODES.has(code) || code.startsWith('VERSION_CONFLICT:')) return err(409, code, message);
    return err(400, code, message);
  }
  // Non-Convex errors: don't leak internals.
  return err(500, 'INTERNAL', 'Unexpected error.');
}

// ── Auth ────────────────────────────────────────────────────────────────────

type AuthResult =
  | { ok: true; scope: 'read' | 'write'; apiKeyId: Id<'apiKeys'>; createdBy: string; prefix: string }
  | { ok: false; response: Response };

/**
 * Parse 'Authorization: Bearer osk_...', hash it, resolve via
 * internal.apiKeys.verifyKey. Missing/malformed/unknown/revoked → 401.
 * When required scope is 'write' a 'read' key is rejected 403. lastUsedAt is
 * touched at most once/hour (compare the returned lastUsedAt).
 */
async function authenticate(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
  requiredScope: 'read' | 'write',
): Promise<AuthResult> {
  const header = request.headers.get('Authorization') ?? request.headers.get('authorization');
  // RFC 7235: the auth-scheme is case-insensitive, so accept 'bearer'/'BEARER'
  // etc. The token itself is kept verbatim (only the scheme is normalized).
  const SCHEME = 'bearer ';
  if (!header || header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) {
    return { ok: false, response: err(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header.') };
  }
  const token = header.slice(SCHEME.length).trim();
  if (!token.startsWith('osk_')) {
    return { ok: false, response: err(401, 'UNAUTHORIZED', 'Invalid API token.') };
  }
  const keyHash = await sha256HexOf(token);
  const key = await ctx.runQuery(internal.apiKeys.verifyKey, { keyHash });
  if (!key) {
    return { ok: false, response: err(401, 'UNAUTHORIZED', 'Invalid or revoked API token.') };
  }
  // Scope: a 'write' key may hit read routes; a 'read' key may not write.
  if (requiredScope === 'write' && key.scope !== 'write') {
    return {
      ok: false,
      response: err(403, 'FORBIDDEN_SCOPE', 'This API key is read-only; a write-scoped key is required.'),
    };
  }
  // Touch lastUsedAt at most once/hour to avoid a write per request.
  const now = Date.now();
  if (key.lastUsedAt === undefined || now - key.lastUsedAt > TOUCH_INTERVAL_MS) {
    await ctx.runMutation(internal.apiKeys.touchLastUsed, { apiKeyId: key.apiKeyId });
  }
  return { ok: true, scope: key.scope, apiKeyId: key.apiKeyId, createdBy: key.createdBy, prefix: key.prefix };
}

async function issueAutomationClaim(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  auth: Extract<AuthResult, { ok: true }>,
  propertyId: Id<'properties'>,
  action: string,
): Promise<string> {
  if (auth.createdBy === 'demo') throw new ConvexError('AUTOMATION_ACTOR_REQUIRED');
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await ctx.runMutation(internal.automation.issueClaim, {
    apiKeyId: auth.apiKeyId,
    actorUserId: auth.createdBy as Id<'users'>,
    propertyId,
    action,
    token,
  });
  return token;
}

// ── Small param helpers ──────────────────────────────────────────────────────

/** Turn from/to (inclusive ISO dates) into a clamped day-count window. */
function windowDays(from: string | null, to: string | null, fallback: number): number {
  if (from && to) {
    // to is treated as inclusive end; forUnitType/tape are half-open, so +1.
    const span = daysBetween(from, to) + 1;
    if (Number.isFinite(span) && span > 0) return Math.min(MAX_WINDOW_DAYS, span);
  }
  return Math.min(MAX_WINDOW_DAYS, fallback);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the POST /bookings/hold body shape and return clean, typed args for
 * createHold — or a 400 Response naming the first problem. This mirrors
 * createHold's arg validator so malformed requests get a helpful 400 at the
 * API boundary instead of an opaque 500 from a Convex ArgumentValidationError.
 * (Ids are only checked to be non-empty strings here; whether they RESOLVE is
 * createHold's job, and a missing row yields a mapped ConvexError.)
 */
type HoldArgs = {
  unitId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guest: { name: string; email: string; phone: string; marketingOptIn: boolean };
  addOns: Array<{ addOnId: string; quantity: number }>;
  promoCode?: string;
};

function validateHoldBody(raw: unknown): { value: HoldArgs } | { error: Response } {
  const fail = (msg: string) => ({ error: err(400, 'INVALID_BODY', msg) });
  if (!raw || typeof raw !== 'object') return fail('Request body must be a JSON object.');
  const b = raw as Record<string, unknown>;

  const str = (k: string) => (typeof b[k] === 'string' && (b[k] as string).length > 0 ? (b[k] as string) : null);
  const unitId = str('unitId');
  const ratePlanId = str('ratePlanId');
  const checkIn = str('checkIn');
  const checkOut = str('checkOut');
  if (!unitId) return fail('unitId (string) is required.');
  if (!ratePlanId) return fail('ratePlanId (string) is required.');
  if (!checkIn || !ISO_DATE.test(checkIn)) return fail('checkIn must be a YYYY-MM-DD date.');
  if (!checkOut || !ISO_DATE.test(checkOut)) return fail('checkOut must be a YYYY-MM-DD date.');
  if (typeof b.adults !== 'number' || !Number.isInteger(b.adults) || b.adults < 1) {
    return fail('adults must be a positive integer.');
  }
  const children = b.children === undefined ? 0 : b.children;
  if (typeof children !== 'number' || !Number.isInteger(children) || children < 0) {
    return fail('children must be a non-negative integer.');
  }

  const g = b.guest;
  if (!g || typeof g !== 'object') return fail('guest object is required.');
  const gg = g as Record<string, unknown>;
  if (typeof gg.name !== 'string' || gg.name.trim() === '') return fail('guest.name is required.');
  if (typeof gg.email !== 'string' || gg.email.trim() === '') return fail('guest.email is required.');
  const phone = typeof gg.phone === 'string' ? gg.phone : '';
  const marketingOptIn = gg.marketingOptIn === true;

  // addOns is REQUIRED by createHold; default an omitted value to [] so callers
  // that book without extras don't have to send an empty array.
  const rawAddOns = b.addOns === undefined ? [] : b.addOns;
  if (!Array.isArray(rawAddOns)) return fail('addOns must be an array.');
  const addOns: Array<{ addOnId: string; quantity: number }> = [];
  for (const item of rawAddOns) {
    if (!item || typeof item !== 'object') return fail('each addOns entry must be an object.');
    const it = item as Record<string, unknown>;
    if (typeof it.addOnId !== 'string' || it.addOnId.length === 0) return fail('addOns[].addOnId is required.');
    if (typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity < 1) {
      return fail('addOns[].quantity must be a positive integer.');
    }
    addOns.push({ addOnId: it.addOnId, quantity: it.quantity });
  }

  if (b.promoCode !== undefined && typeof b.promoCode !== 'string') return fail('promoCode must be a string.');

  return {
    value: {
      unitId,
      ratePlanId,
      checkIn,
      checkOut,
      adults: b.adults,
      children,
      guest: { name: gg.name, email: gg.email, phone, marketingOptIn },
      addOns,
      ...(typeof b.promoCode === 'string' ? { promoCode: b.promoCode } : {}),
    },
  };
}

// ===========================================================================
// Internal read helpers. These live in apiV1.ts (builder H territory) so no
// existing module is touched. Each is authorized by the API-key check in the
// HTTP handler BEFORE it is called — the key IS the authorization, which is why
// the tape helper is allowed to bypass requireStaff (a valid key already
// proved the caller is a trusted automation, the same trust a staff login
// grants). None of these expose more than the corresponding staff/public UI
// query already does.
// ===========================================================================

/** Resolve a property slug → id + a small public snapshot (or null). */
export const propertyBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!property || !property.active) return null;
    return {
      propertyId: property._id,
      name: property.name,
      slug: property.slug,
      currency: property.currency,
      taxLabel: property.taxLabel,
      timezone: property.timezone,
    };
  },
});

/** Unit types (nightly) for a property slug. */
export const unitTypesForProperty = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!property || !property.active) return null;
    const unitTypes = await ctx.db
      .query('unitTypes')
      .withIndex('by_property', (q) => q.eq('propertyId', property._id))
      .collect();
    return unitTypes
      .filter((t) => t.bookingMode === 'nightly')
      .map((t) => ({
        unitTypeId: t._id,
        name: t.name,
        slug: t.slug,
        kind: t.kind,
        maxOccupancy: t.maxOccupancy,
        comingSoon: t.comingSoon,
        sortOrder: t.sortOrder,
      }));
  },
});

/** Units for a property slug (no PII; the same fields the tape header shows). */
export const unitsForProperty = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!property || !property.active) return null;
    const units = await ctx.db
      .query('units')
      .withIndex('by_property', (q) => q.eq('propertyId', property._id))
      .collect();
    return units.map((u) => ({
      unitId: u._id,
      unitTypeId: u.unitTypeId,
      name: u.name,
      slug: u.slug,
      status: u.status,
      bookableFrom: u.bookableFrom,
      sortOrder: u.sortOrder,
    }));
  },
});

/** Active rate plans for a (property slug, unit-type slug). */
export const ratePlansForUnitType = internalQuery({
  args: { propertySlug: v.string(), unitTypeSlug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .first();
    if (!property || !property.active) return null;
    const unitType = await ctx.db
      .query('unitTypes')
      .withIndex('by_property_slug', (q) =>
        q.eq('propertyId', property._id).eq('slug', args.unitTypeSlug),
      )
      .first();
    if (!unitType) return null;
    const ratePlans = await ctx.db
      .query('ratePlans')
      .withIndex('by_unitType', (q) => q.eq('unitTypeId', unitType._id).eq('active', true))
      .collect();
    return {
      unitTypeId: unitType._id,
      ratePlans: ratePlans.map((r) => ({
        ratePlanId: r._id,
        name: r.name,
        currency: r.currency,
        baseNightlyCents: r.baseNightlyCents,
        weeklyRateCents: r.weeklyRateCents,
        seasons: r.seasons,
        minStayNights: r.minStayNights,
        maxStayNights: r.maxStayNights,
        minLeadTimeHours: r.minLeadTimeHours,
        maxAdvanceDays: r.maxAdvanceDays,
        prepBufferNights: r.prepBufferNights,
        depositPolicy: r.depositPolicy,
        cancellationPolicy: r.cancellationPolicy,
      })),
    };
  },
});

/** Resolve (property slug, unit-type slug) → unitTypeId (for availability). */
export const unitTypeIdBySlug = internalQuery({
  args: { propertySlug: v.string(), unitTypeSlug: v.string() },
  handler: async (ctx, args): Promise<{ unitTypeId: Id<'unitTypes'> } | null> => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .first();
    if (!property || !property.active) return null;
    const unitType = await ctx.db
      .query('unitTypes')
      .withIndex('by_property_slug', (q) =>
        q.eq('propertyId', property._id).eq('slug', args.unitTypeSlug),
      )
      .first();
    if (!unitType) return null;
    return { unitTypeId: unitType._id };
  },
});

/**
 * Staff-bypassing tape read for the API path. Same shape and same active-set
 * filter as availability.tapeForProperty, but WITHOUT requireStaff — the caller
 * already presented a valid API key (the HTTP handler enforced that before
 * calling this), and the API key IS the authorization, exactly as a staff login
 * would be. No guest PII beyond the confirmation code + occupancy the staff
 * tape already exposes. Returns null for an unknown/inactive property slug.
 */
export const tapeForApiKey = internalQuery({
  args: { slug: v.string(), startDate: v.string(), days: v.number() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!property || !property.active) return null;

    const days = Math.max(1, Math.min(MAX_WINDOW_DAYS, Math.floor(args.days)));
    const endDate = addDays(args.startDate, days);

    const units = await ctx.db
      .query('units')
      .withIndex('by_property', (q) => q.eq('propertyId', property._id))
      .collect();

    const candidates = await ctx.db
      .query('bookings')
      .withIndex('by_property_checkIn', (q) =>
        q.eq('propertyId', property._id).lt('checkIn', endDate),
      )
      .collect();
    const active = new Set(['hold', 'confirmed', 'checked_in', 'external', 'blocked']);
    const bookings = candidates.filter((b) => active.has(b.status) && b.checkOut > args.startDate);

    return {
      propertySlug: property.slug,
      startDate: args.startDate,
      endDate,
      units: units.map((u) => ({ unitId: u._id, name: u.name, status: u.status })),
      bookings: bookings.map((b) => ({
        bookingId: b._id,
        unitId: b.unitId,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        confirmationCode: b.confirmationCode,
        source: b.source,
      })),
    };
  },
});

/**
 * Bookings list for the API: optional status + date window, hard-capped limit.
 * When a status is given it's an indexed read (by_status_holdExpires); an
 * unrecognized status simply matches nothing. Date filtering + sort run in JS.
 * No guest PII — guestId is deliberately NOT projected; the automation reads
 * occupancy/status/pricing, not personal data. Ordered by checkIn, capped at
 * MAX_BOOKINGS_LIMIT (200).
 */
export const bookingsList = internalQuery({
  args: {
    status: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(MAX_BOOKINGS_LIMIT, Math.floor(args.limit)));

    let rows;
    if (args.status !== undefined) {
      // Index by status; date filtering applied in JS (status index has no date).
      rows = await ctx.db
        .query('bookings')
        .withIndex('by_status_holdExpires', (q) => q.eq('status', args.status as never))
        .collect();
    } else {
      rows = await ctx.db.query('bookings').collect();
    }

    let filtered = rows;
    if (args.from !== undefined) filtered = filtered.filter((b) => b.checkOut > args.from!);
    if (args.to !== undefined) filtered = filtered.filter((b) => b.checkIn <= args.to!);

    filtered.sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
    const capped = filtered.slice(0, limit);

    return capped.map((b) => ({
      bookingId: b._id,
      confirmationCode: b.confirmationCode,
      propertyId: b.propertyId,
      unitId: b.unitId,
      unitTypeId: b.unitTypeId,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      status: b.status,
      source: b.source,
      holdExpiresAt: b.holdExpiresAt,
      priceBreakdown: b.priceBreakdown,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
  },
});

/** Resolve (property slug, unit-type slug) → both ids for promo preview. */
export const promoPreviewIds = internalQuery({
  args: { propertySlug: v.string(), unitTypeSlug: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ propertyId: Id<'properties'>; unitTypeId: Id<'unitTypes'> } | null> => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .first();
    if (!property || !property.active) return null;
    const unitType = await ctx.db
      .query('unitTypes')
      .withIndex('by_property_slug', (q) =>
        q.eq('propertyId', property._id).eq('slug', args.unitTypeSlug),
      )
      .first();
    if (!unitType) return null;
    return { propertyId: property._id, unitTypeId: unitType._id };
  },
});

/**
 * API-key read projection for accepted PMS workspaces. The HTTP dispatcher
 * authenticates the key before invoking this internal query. Results are
 * property-bounded and capped; no surface is callable from the public client.
 */
export const operationalView = internalQuery({
  args: {
    slug: v.string(),
    view: v.string(),
    businessDate: v.optional(v.string()),
    search: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', args.slug)).first();
    if (!property?.active) return null;
    const propertyId = property._id;
    const viewCapabilities: Record<string, OperationalCapability> = {
      search: 'booking.read', 'front-desk': 'booking.read', housekeeping: 'housekeeping.read',
      maintenance: 'maintenance.read', folios: 'folio.read', quotes: 'booking.read',
      contracts: 'booking.read', 'night-audit': 'reports.read', reports: 'reports.read',
    };
    const capability = viewCapabilities[args.view];
    if (!capability) throw new ConvexError('OPERATIONS_VIEW_UNKNOWN');
    await requireAutomationPropertyCapability(ctx, args.actorUserId, propertyId, capability);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 200);
    const enabledFeatures = (await ctx.db.query('propertyFeatures').withIndex('by_property', (q) => q.eq('propertyId', propertyId)).collect())
      .filter((feature) => feature.enabled)
      .map((feature) => feature.feature);
    const requiredFeature: Record<string, string> = {
      search: 'command_center',
      'front-desk': 'front_desk',
      housekeeping: 'housekeeping',
      maintenance: 'maintenance',
      folios: 'commerce',
      quotes: 'command_center',
      'night-audit': 'night_audit',
      reports: 'night_audit',
    };
    const required = requiredFeature[args.view];
    if (required && !enabledFeatures.includes(required)) throw new ConvexError(`FEATURE_DISABLED:${required}`);
    if (args.view === 'contracts' && !enabledFeatures.some((feature) => feature === 'groups' || feature === 'long_term')) {
      throw new ConvexError('FEATURE_DISABLED:groups');
    }

    if (args.view === 'search') {
      const terms = (args.search ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
      const rows = await ctx.db.query('operationalSearchDocuments').withIndex('by_property_updatedAt', (q) => q.eq('propertyId', propertyId)).order('desc').take(500);
      return { view: args.view, enabledFeatures, records: rows.filter((row) => terms.length === 0 || terms.every((term) => row.normalizedText.includes(term))).slice(0, limit).map(({ normalizedText, propertyId: _propertyId, ...row }) => row) };
    }
    if (args.view === 'front-desk') {
      const businessDate = args.businessDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: property.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const queues = await buildFrontDeskQueues(ctx, { propertyId, businessDate });
      return { view: args.view, enabledFeatures, businessDate, ...queues };
    }
    if (args.view === 'housekeeping') {
      const serviceDate = args.businessDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: property.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const board = await buildHousekeepingBoard(ctx, { propertyId, serviceDate });
      return { view: args.view, enabledFeatures, businessDate: serviceDate, records: board.units };
    }
    if (args.view === 'maintenance') {
      return { view: args.view, enabledFeatures, records: await ctx.db.query('maintenanceTasks').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit) };
    }
    if (args.view === 'folios') {
      return { view: args.view, enabledFeatures, records: await ctx.db.query('folios').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit) };
    }
    if (args.view === 'quotes') {
      const [quotes, waitlist] = await Promise.all([ctx.db.query('quotes').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit), ctx.db.query('waitlistEntries').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit)]);
      return { view: args.view, enabledFeatures, records: { quotes, waitlist } };
    }
    if (args.view === 'contracts') {
      const [groups, contracts, reminders] = await Promise.all([ctx.db.query('groupReservations').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit), ctx.db.query('seasonalContracts').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).take(limit), ctx.db.query('staffTasks').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId).eq('status', 'open')).take(limit)]);
      return { view: args.view, enabledFeatures, records: { groups, contracts, reminders: reminders.filter((row) => row.kind === 'reminder') } };
    }
    if (args.view === 'night-audit' || args.view === 'reports') {
      const startDate = args.startDate ?? '0000-01-01';
      const endDate = args.endDate ?? '9999-12-31';
      const records = await ctx.db.query('nightAuditSnapshots').withIndex('by_property_date', (q) => q.eq('propertyId', propertyId).gte('businessDate', startDate).lte('businessDate', endDate)).take(limit);
      return { view: args.view, enabledFeatures, records: records.map((row) => ({ ...row, summary: JSON.parse(row.summaryJson), summaryJson: undefined })) };
    }
    throw new ConvexError('OPERATIONS_VIEW_UNKNOWN');
  },
});

// ===========================================================================
// The dispatcher.
// ===========================================================================

export const handle = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Everything is under '/api/v1/'; strip the prefix to get the route.
  const PREFIX = '/api/v1/';
  const idx = url.pathname.indexOf(PREFIX);
  if (idx === -1) return err(404, 'NOT_FOUND', 'Unknown API path.');
  const route = url.pathname.slice(idx + PREFIX.length).replace(/\/+$/, '');
  const segments = route.split('/').filter((s) => s.length > 0);
  const q = url.searchParams;

  try {
    // ── GET /api/v1/health — NO auth ───────────────────────────────────────
    if (method === 'GET' && route === 'health') {
      return ok({ ok: true, version: API_VERSION });
    }

    // Everything else requires a key. Read routes need 'read'; write need 'write'.
    // ─────────────────────────────────────────────────────────────────────────
    // GET routes
    // ─────────────────────────────────────────────────────────────────────────
    if (method === 'GET') {
      // GET /api/v1/properties
      if (route === 'properties') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const data = await ctx.runQuery(api.properties.listActive, {});
        return ok(data);
      }

      // GET /api/v1/unit-types?property=<slug>
      if (route === 'unit-types') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const slug = q.get('property');
        if (!slug) return err(400, 'MISSING_PARAM', 'property query param is required.');
        const data = await ctx.runQuery(internal.apiV1.unitTypesForProperty, { slug });
        if (data === null) return err(404, 'NOT_FOUND', 'Property not found.');
        return ok(data);
      }

      // GET /api/v1/units?property=<slug>
      if (route === 'units') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const slug = q.get('property');
        if (!slug) return err(400, 'MISSING_PARAM', 'property query param is required.');
        const data = await ctx.runQuery(internal.apiV1.unitsForProperty, { slug });
        if (data === null) return err(404, 'NOT_FOUND', 'Property not found.');
        return ok(data);
      }

      // GET /api/v1/rate-plans?property=<slug>&unitType=<slug>
      if (route === 'rate-plans') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const propertySlug = q.get('property');
        const unitTypeSlug = q.get('unitType');
        if (!propertySlug || !unitTypeSlug) {
          return err(400, 'MISSING_PARAM', 'property and unitType query params are required.');
        }
        const data = await ctx.runQuery(internal.apiV1.ratePlansForUnitType, {
          propertySlug,
          unitTypeSlug,
        });
        if (data === null) return err(404, 'NOT_FOUND', 'Property or unit type not found.');
        return ok(data);
      }

      // GET /api/v1/availability?property=<slug>&unitType=<slug>&from&to
      if (route === 'availability') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const propertySlug = q.get('property');
        const unitTypeSlug = q.get('unitType');
        const from = q.get('from');
        const to = q.get('to');
        if (!propertySlug || !unitTypeSlug) {
          return err(400, 'MISSING_PARAM', 'property and unitType query params are required.');
        }
        if (!from || !ISO_DATE.test(from)) {
          return err(400, 'INVALID_DATE', 'from must be a YYYY-MM-DD date.');
        }
        if (to !== null && !ISO_DATE.test(to)) {
          return err(400, 'INVALID_DATE', 'to must be a YYYY-MM-DD date.');
        }
        const resolved = await ctx.runQuery(internal.apiV1.unitTypeIdBySlug, {
          propertySlug,
          unitTypeSlug,
        });
        if (resolved === null) return err(404, 'NOT_FOUND', 'Property or unit type not found.');
        const days = windowDays(from, to, DEFAULT_AVAILABILITY_DAYS);
        // Reuse the SAME public query the date picker uses — one source of truth.
        const data = await ctx.runQuery(api.availability.forUnitType, {
          unitTypeId: resolved.unitTypeId,
          startDate: from,
          days,
        });
        return ok(data);
      }

      // GET /api/v1/tape?property=<slug>&from&to
      if (route === 'tape') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const slug = q.get('property');
        const from = q.get('from');
        const to = q.get('to');
        if (!slug) return err(400, 'MISSING_PARAM', 'property query param is required.');
        if (!from || !ISO_DATE.test(from)) {
          return err(400, 'INVALID_DATE', 'from must be a YYYY-MM-DD date.');
        }
        if (to !== null && !ISO_DATE.test(to)) {
          return err(400, 'INVALID_DATE', 'to must be a YYYY-MM-DD date.');
        }
        const days = windowDays(from, to, DEFAULT_AVAILABILITY_DAYS);
        const data = await ctx.runQuery(internal.apiV1.tapeForApiKey, {
          slug,
          startDate: from,
          days,
        });
        if (data === null) return err(404, 'NOT_FOUND', 'Property not found.');
        return ok(data);
      }

      // GET /api/v1/bookings/<confirmationCode>  (single, before the list route)
      if (segments[0] === 'bookings' && segments.length === 2) {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const code = decodeURIComponent(segments[1]);
        const data = await ctx.runQuery(api.bookings.byConfirmationCode, { code });
        if (data === null) return err(404, 'NOT_FOUND', 'Booking not found.');
        return ok(data);
      }

      // GET /api/v1/bookings?status&from&to&limit
      if (route === 'bookings') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const status = q.get('status') ?? undefined;
        const from = q.get('from') ?? undefined;
        const to = q.get('to') ?? undefined;
        if (from !== undefined && !ISO_DATE.test(from)) {
          return err(400, 'INVALID_DATE', 'from must be a YYYY-MM-DD date.');
        }
        if (to !== undefined && !ISO_DATE.test(to)) {
          return err(400, 'INVALID_DATE', 'to must be a YYYY-MM-DD date.');
        }
        const limitRaw = q.get('limit');
        const limit = limitRaw ? Number.parseInt(limitRaw, 10) : DEFAULT_BOOKINGS_LIMIT;
        if (Number.isNaN(limit) || limit < 1) {
          return err(400, 'INVALID_LIMIT', 'limit must be a positive integer.');
        }
        const data = await ctx.runQuery(internal.apiV1.bookingsList, {
          status,
          from,
          to,
          limit,
        });
        return ok(data);
      }

      if (segments[0] === 'operations' && segments.length === 2) {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        if (auth.createdBy === 'demo') return err(403, 'AUTOMATION_ACTOR_REQUIRED', 'Operational API keys must belong to an active staff owner.');
        const slug = q.get('property');
        if (!slug) return err(400, 'MISSING_PARAM', 'property query param is required.');
        const limitRaw = q.get('limit');
        const limit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
          return err(400, 'INVALID_LIMIT', 'limit must be a positive integer.');
        }
        const data = await ctx.runQuery(internal.apiV1.operationalView, {
          slug,
          view: decodeURIComponent(segments[1]),
          businessDate: q.get('date') ?? undefined,
          search: q.get('q') ?? undefined,
          startDate: q.get('from') ?? undefined,
          endDate: q.get('to') ?? undefined,
          limit,
          actorUserId: auth.createdBy as Id<'users'>,
        });
        if (data === null) return err(404, 'NOT_FOUND', 'Property not found.');
        return ok(data);
      }

      return err(404, 'NOT_FOUND', 'Unknown API path.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST routes
    // ─────────────────────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (segments[0] === 'operations' && segments.length >= 2) {
        const auth = await authenticate(ctx, request, 'write');
        if (!auth.ok) return auth.response;
        const body = await parseJsonBody(request);
        if ('error' in body) return body.error;
        const input = body.value as Record<string, unknown>;
        if (typeof input.property !== 'string' || !input.property) {
          return err(400, 'MISSING_PARAM', 'property is required.');
        }
        if (typeof input.requestId !== 'string' || !input.requestId.trim()) {
          return err(400, 'MISSING_PARAM', 'requestId is required.');
        }
        const property = await ctx.runQuery(internal.apiV1.propertyBySlug, { slug: input.property });
        if (!property) return err(404, 'NOT_FOUND', 'Property not found.');
        const operation = segments.slice(1).join('/');
        const definitions: Record<string, { action: string; mutation: any }> = {
          block: { action: 'booking.block', mutation: api.operations.createBlock },
          move: { action: 'booking.move', mutation: api.operations.moveBooking },
          quote: { action: 'quote.create', mutation: api.operations.createQuote },
          'quote/accept': { action: 'quote.accept', mutation: api.operations.acceptQuote },
          waitlist: { action: 'waitlist.create', mutation: api.operations.createWaitlistEntry },
          maintenance: { action: 'maintenance.create', mutation: api.operations.createMaintenanceTask },
          call: { action: 'task.call.create', mutation: api.operations.createCallTask },
          'call/complete': { action: 'task.call.complete', mutation: api.operations.completeCallTask },
          complimentary: { action: 'complimentary.approve', mutation: api.operations.authorizeComplimentary },
          'rate-adjustment': { action: 'rate.adjust', mutation: api.operations.adjustBookingRate },
          'front-desk/transition': { action: 'front_desk.dynamic', mutation: api.frontDesk.transition },
          'front-desk/flag/create': { action: 'front_desk.flag.create', mutation: (api as any).operationalFlags.create },
          'front-desk/flag/assign': { action: 'front_desk.flag.assign', mutation: (api as any).operationalFlags.assign },
          'front-desk/flag/resolve': { action: 'front_desk.flag.resolve', mutation: (api as any).operationalFlags.resolve },
          'housekeeping/assign': { action: 'housekeeping.assign', mutation: api.housekeeping.assign },
          'housekeeping/state': { action: 'housekeeping.state.transition', mutation: api.housekeeping.transitionState },
          'housekeeping/assignment/update': { action: 'housekeeping.assignment.update', mutation: (api as any).housekeepingWork.updateAssignment },
          'housekeeping/assignment/start': { action: 'housekeeping.assignment.start', mutation: (api as any).housekeepingWork.start },
          'housekeeping/checklist/item': { action: 'housekeeping.checklist.item', mutation: (api as any).housekeepingWork.updateChecklistItem },
          'housekeeping/inspection/submit': { action: 'housekeeping.inspection.submit', mutation: (api as any).housekeepingWork.submitForInspection },
          'housekeeping/inspection/review': { action: 'housekeeping.inspection.review', mutation: (api as any).housekeepingWork.reviewInspection },
          'housekeeping/assignment/cancel': { action: 'housekeeping.assignment.cancel', mutation: (api as any).housekeepingWork.cancel },
          'maintenance/resolve': { action: 'maintenance.resolve', mutation: api.housekeeping.resolveMaintenance },
          'folios/retail': { action: 'folio.retail.create', mutation: api.commerce.createRetailFolio },
          'folios/entry': { action: 'folio.entry.post', mutation: api.commerce.postEntry },
          'folios/reverse': { action: 'folio.entry.reverse', mutation: api.commerce.reverseEntry },
          'folios/payment': { action: 'folio.payment.record', mutation: api.commerce.recordManualPayment },
          'night-audit/close': { action: 'night_audit.close', mutation: api.closeout.closeNight },
          group: { action: 'group.create', mutation: api.groups.createGroup },
          'seasonal-contract': { action: 'seasonal_contract.create', mutation: api.groups.createSeasonalContract },
          reminder: { action: 'reminder.create', mutation: api.groups.createReminder },
          'gift-certificate': { action: 'gift_certificate.issue', mutation: api.groups.issueGiftCertificate },
        };
        const definition = definitions[operation];
        if (!definition) return err(404, 'NOT_FOUND', 'Unknown operations action.');
        const action = operation === 'front-desk/transition'
          ? `front_desk.${String(input.transition ?? '')}`
          : definition.action;
        const automationToken = await issueAutomationClaim(ctx, auth, property.propertyId, action);
        const { property: _property, ...args } = input;
        try {
          const data = await ctx.runMutation(definition.mutation, {
            ...args,
            propertyId: property.propertyId,
            automationToken,
          });
          return ok(data);
        } catch (mutationError) {
          if (mutationError instanceof ConvexError) throw mutationError;
          return err(400, 'INVALID_FIELD', 'One or more operations fields are invalid.');
        }
      }
      // POST /api/v1/bookings/hold — write
      if (segments[0] === 'bookings' && segments[1] === 'hold' && segments.length === 2) {
        const auth = await authenticate(ctx, request, 'write');
        if (!auth.ok) return auth.response;
        const body = await parseJsonBody(request);
        if ('error' in body) return body.error;
        // Validate the request shape at the boundary: without this, a missing
        // required field (e.g. addOns) or wrong type reaches createHold as a
        // Convex ArgumentValidationError — NOT a ConvexError — and the outer
        // catch reports an opaque 500. A public API must answer 400 with a
        // reason instead.
        const holdArgs = validateHoldBody(body.value);
        if ('error' in holdArgs) return holdArgs.error;
        // Pass through to the SAME mutation the UI uses; all money/availability
        // guarantees (conflict check, pricing, promo caps) apply identically.
        // A residual arg-validation failure here can only be a malformed id
        // string (shape already checked) — a client error, so map it to 400.
        try {
          const data = await ctx.runMutation(api.bookings.createHold, holdArgs.value as never);
          return ok(data);
        } catch (mutationError) {
          if (mutationError instanceof ConvexError) throw mutationError; // domain error → mapped by outer catch
          return err(400, 'INVALID_FIELD', 'One or more field values are invalid (check id fields).');
        }
      }

      // POST /api/v1/bookings/<confirmationCode>/cancel — write
      if (
        segments[0] === 'bookings' &&
        segments.length === 3 &&
        segments[2] === 'cancel'
      ) {
        const auth = await authenticate(ctx, request, 'write');
        if (!auth.ok) return auth.response;
        const code = decodeURIComponent(segments[1]);
        const body = await parseJsonBody(request);
        if ('error' in body) return body.error;
        const email = (body.value as { email?: unknown }).email;
        if (typeof email !== 'string' || email.trim() === '') {
          return err(400, 'MISSING_PARAM', 'email is required in the request body.');
        }
        const data = await ctx.runMutation(api.bookings.cancelByGuest, {
          confirmationCode: code,
          email,
        });
        return ok(data);
      }

      // POST /api/v1/promo-codes/preview — read scope (a preview reads pricing)
      if (route === 'promo-codes/preview') {
        const auth = await authenticate(ctx, request, 'read');
        if (!auth.ok) return auth.response;
        const body = await parseJsonBody(request);
        if ('error' in body) return body.error;
        const b = body.value as {
          property?: unknown;
          unitType?: unknown;
          code?: unknown;
        };
        if (typeof b.property !== 'string' || typeof b.unitType !== 'string' || typeof b.code !== 'string') {
          return err(400, 'MISSING_PARAM', 'property, unitType, and code are required.');
        }
        const ids = await ctx.runQuery(internal.apiV1.promoPreviewIds, {
          propertySlug: b.property,
          unitTypeSlug: b.unitType,
        });
        if (ids === null) return err(404, 'NOT_FOUND', 'Property or unit type not found.');
        const data = await ctx.runQuery(api.promoCodes.preview, {
          propertyId: ids.propertyId,
          unitTypeId: ids.unitTypeId,
          code: b.code,
        });
        return ok(data);
      }

      return err(404, 'NOT_FOUND', 'Unknown API path.');
    }

    // Method not GET/POST for the prefix.
    return err(404, 'NOT_FOUND', 'Unknown API path.');
  } catch (error) {
    return mapConvexError(error);
  }
});

/** Parse a JSON request body; return {value} or {error: Response}. */
async function parseJsonBody(
  request: Request,
): Promise<{ value: unknown } | { error: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { error: err(400, 'INVALID_BODY', 'Could not read the request body.') };
  }
  if (raw.trim() === '') return { value: {} };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: err(400, 'INVALID_JSON', 'Request body must be valid JSON.') };
  }
}
