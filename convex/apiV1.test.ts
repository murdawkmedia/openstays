/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { addDays } from '../shared/pricing';
import { sha256HexOf } from './apiKeys';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

// createHold / cancelByGuest fire-and-forget schedule transactional emails via
// ctx.scheduler.runAfter(0, …). Drain them deterministically (same pattern as
// bookings.test.ts) so a disposed fake DB doesn't surface an unhandled error.
const created: Array<ReturnType<typeof convexTest>> = [];
function makeT() {
  const t = convexTest(schema, modules);
  created.push(t);
  return t;
}
async function drainAll() {
  for (const t of created) {
    for (let i = 0; i < 50; i += 1) {
      const pending = await t.run(async (ctx) => {
        const jobs = await ctx.db.system.query('_scheduled_functions').collect();
        return jobs.filter((j) => j.state.kind === 'pending' || j.state.kind === 'inProgress').length;
      });
      if (pending === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }
  }
  created.length = 0;
}

const today = new Date().toISOString().slice(0, 10);
const D = (offset: number) => addDays(today, offset);

async function seedFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      email: 't@example.com',
      phone: '555',
      address: '1 Test Rd',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'Cabin',
      slug: 'cabin',
      kind: 'cabin',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 4,
      amenities: [],
      comingSoon: false,
      sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'Cabin 1',
      slug: 'cabin-1',
      status: 'active',
      icalExportToken: 'test-token-cabin-1-xxxxxxxxxxxx',
      icalImports: [],
      sortOrder: 1,
    });
    const ratePlanId = await ctx.db.insert('ratePlans', {
      propertyId,
      unitTypeId,
      name: 'Standard',
      active: true,
      currency: 'CAD',
      baseNightlyCents: 10_000,
      seasons: [],
      minStayNights: 1,
      maxStayNights: 28,
      minLeadTimeHours: 0,
      maxAdvanceDays: 365,
      prepBufferNights: 0,
      depositPolicy: { type: 'full', value: 0 },
      cancellationPolicy: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    });
    return { propertyId, unitTypeId, unitId, ratePlanId };
  });
}

/** Insert an API key row directly and return its raw token. */
async function seedKey(t: ReturnType<typeof convexTest>, scope: 'read' | 'write') {
  // A real osk_ token so the request path (sha256 → verifyKey) is exercised.
  const token = `osk_${'a'.repeat(scope === 'read' ? 48 : 47)}${scope === 'read' ? '' : 'b'}`;
  const keyHash = await sha256HexOf(token);
  await t.run(async (ctx) =>
    ctx.db.insert('apiKeys', {
      name: `${scope} key`,
      keyHash,
      prefix: token.slice(0, 12),
      scope,
      active: true,
      createdBy: 'test',
      createdAt: Date.now(),
    }),
  );
  return token;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

afterEach(async () => {
  await drainAll();
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('needs no auth and returns ok + version', async () => {
    const t = makeT();
    const res = await t.fetch('/api/v1/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ ok: true, version: 'v1' });
  });
});

describe('auth', () => {
  it('401 when the Authorization header is missing', async () => {
    const t = makeT();
    const res = await t.fetch('/api/v1/properties', { method: 'GET' });
    expect(res.status).toBe(401);
    const body = await jsonOf(res);
    expect((body.error as { code: string }).code).toBe('UNAUTHORIZED');
  });

  it('401 for an unknown / non-osk token', async () => {
    const t = makeT();
    const res = await t.fetch('/api/v1/properties', {
      method: 'GET',
      headers: bearer('osk_' + 'f'.repeat(48)), // well-formed but never stored
    });
    expect(res.status).toBe(401);
  });

  it('401 for a revoked token', async () => {
    const t = makeT();
    const token = await seedKey(t, 'read');
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('apiKeys').collect())[0];
      await ctx.db.patch(row._id, { active: false });
    });
    const res = await t.fetch('/api/v1/properties', { method: 'GET', headers: bearer(token) });
    expect(res.status).toBe(401);
  });

  it('DEMO_MODE does NOT waive the key requirement', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    await seedFixture(t);
    const res = await t.fetch('/api/v1/properties', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('accepts a lowercase "bearer " scheme (RFC 7235 case-insensitive)', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/properties', {
      method: 'GET',
      headers: { Authorization: `bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('touches lastUsedAt on first use, not on an immediate second use', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    await t.fetch('/api/v1/properties', { method: 'GET', headers: bearer(token) });
    const firstUse = await t.run(
      async (ctx) => (await ctx.db.query('apiKeys').collect())[0].lastUsedAt,
    );
    expect(firstUse).toBeGreaterThan(0);
    await t.fetch('/api/v1/properties', { method: 'GET', headers: bearer(token) });
    const secondUse = await t.run(
      async (ctx) => (await ctx.db.query('apiKeys').collect())[0].lastUsedAt,
    );
    // < 1h elapsed → not re-touched.
    expect(secondUse).toBe(firstUse);
  });
});

describe('scope enforcement', () => {
  it('403 when a read key hits the write hold route', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const readToken = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(readToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    expect(res.status).toBe(403);
    const body = await jsonOf(res);
    expect((body.error as { code: string }).code).toBe('FORBIDDEN_SCOPE');
  });

  it('a write key may hit read routes', async () => {
    const t = makeT();
    await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const res = await t.fetch('/api/v1/properties', { method: 'GET', headers: bearer(writeToken) });
    expect(res.status).toBe(200);
  });
});

describe('GET read routes', () => {
  it('properties lists the active property', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/properties', { method: 'GET', headers: bearer(token) });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as Array<{ slug: string }>)[0].slug).toBe('test-grounds');
  });

  it('unit-types requires the property param and resolves by slug', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const missing = await t.fetch('/api/v1/unit-types', { method: 'GET', headers: bearer(token) });
    expect(missing.status).toBe(400);
    const res = await t.fetch('/api/v1/unit-types?property=test-grounds', {
      method: 'GET',
      headers: bearer(token),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect((body.data as Array<{ slug: string }>)[0].slug).toBe('cabin');
  });

  it('units lists the property units', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/units?property=test-grounds', {
      method: 'GET',
      headers: bearer(token),
    });
    const body = await jsonOf(res);
    expect((body.data as Array<{ slug: string }>)[0].slug).toBe('cabin-1');
  });

  it('rate-plans lists the active plan', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/rate-plans?property=test-grounds&unitType=cabin', {
      method: 'GET',
      headers: bearer(token),
    });
    const body = await jsonOf(res);
    const data = body.data as { ratePlans: Array<{ name: string }> };
    expect(data.ratePlans[0].name).toBe('Standard');
  });

  it('availability returns the blocked dates of an existing hold', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    // Seed a hold directly through the write route so unitNights exist.
    const writeToken = await seedKey(t, 'write');
    await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const readToken = await seedKey(t, 'read');
    const res = await t.fetch(
      `/api/v1/availability?property=test-grounds&unitType=cabin&from=${D(1)}&to=${D(20)}`,
      { method: 'GET', headers: bearer(readToken) },
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { units: Array<{ blockedDates: string[] }> };
    expect(data.units[0].blockedDates.sort()).toEqual([D(10), D(11)]);
  });

  it('availability rejects a bad from date with 400', async () => {
    const t = makeT();
    await seedFixture(t);
    const token = await seedKey(t, 'read');
    const res = await t.fetch(
      '/api/v1/availability?property=test-grounds&unitType=cabin&from=not-a-date',
      { method: 'GET', headers: bearer(token) },
    );
    expect(res.status).toBe(400);
  });

  it('tape returns bookings for the window (key bypasses staff auth)', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const holdRes = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const held = (await jsonOf(holdRes)).data as { confirmationCode: string };

    const readToken = await seedKey(t, 'read');
    const res = await t.fetch(`/api/v1/tape?property=test-grounds&from=${D(1)}&to=${D(20)}`, {
      method: 'GET',
      headers: bearer(readToken),
    });
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as {
      bookings: Array<{ confirmationCode: string }>;
    };
    expect(data.bookings.map((b) => b.confirmationCode)).toContain(held.confirmationCode);
  });

  it('bookings list returns the seeded booking, capped', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const readToken = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/bookings?status=hold&limit=10', {
      method: 'GET',
      headers: bearer(readToken),
    });
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as Array<{ status: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe('hold');
  });

  it('bookings/<code> returns the booking, 404 for unknown', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const holdRes = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const held = (await jsonOf(holdRes)).data as { confirmationCode: string };

    const readToken = await seedKey(t, 'read');
    const found = await t.fetch(`/api/v1/bookings/${held.confirmationCode}`, {
      method: 'GET',
      headers: bearer(readToken),
    });
    expect(found.status).toBe(200);
    const view = (await jsonOf(found)).data as { confirmationCode: string; status: string };
    expect(view.confirmationCode).toBe(held.confirmationCode);
    expect(view.status).toBe('hold');

    const missing = await t.fetch('/api/v1/bookings/OS-NOPE00', {
      method: 'GET',
      headers: bearer(readToken),
    });
    expect(missing.status).toBe(404);
  });

  it('unknown path is 404', async () => {
    const t = makeT();
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/does-not-exist', {
      method: 'GET',
      headers: bearer(token),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST write routes', () => {
  it('hold with a malformed body returns a clean 400, not a 500', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    // addOns omitted entirely is FINE (defaults to []). The real failures:
    // missing required ids / bad date / missing guest → 400 INVALID_BODY,
    // never an opaque 500 ArgumentValidationError leak.
    const missingUnit = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
      }),
    });
    expect(missingUnit.status).toBe(400);
    expect(((await jsonOf(missingUnit)).error as { code: string }).code).toBe('INVALID_BODY');

    const badDate = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: 'Sept 10',
        checkOut: D(12),
        adults: 2,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    expect(badDate.status).toBe(400);

    // addOns omitted → still a valid booking (defaulted to []).
    const noAddOns = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(40),
        checkOut: D(42),
        adults: 2,
        guest: { name: 'G', email: 'noaddons@example.com', phone: '780', marketingOptIn: false },
      }),
    });
    expect(noAddOns.status).toBe(200);
  });

  it('hold with a write key creates a booking + unitNights', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const res = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as {
      bookingId: Id<'bookings'>;
      confirmationCode: string;
      price: { totalCents: number };
    };
    expect(data.confirmationCode).toMatch(/^OS-/);
    // 2 nights × $100 + 5% GST = $210.00.
    expect(data.price.totalCents).toBe(21_000);

    // A bookings row and its unitNights exist.
    const rows = await t.run(async (ctx) => {
      const booking = await ctx.db.get(data.bookingId);
      const nights = await ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', data.bookingId))
        .collect();
      return { booking, nights };
    });
    expect(rows.booking?.status).toBe('hold');
    expect(rows.nights.map((n) => n.date).sort()).toEqual([D(10), D(11)]);
  });

  it('a hold that exceeds maxOccupancy returns 400 (server-authoritative)', async () => {
    const t = makeT();
    const fx = await seedFixture(t); // maxOccupancy: 4
    const writeToken = await seedKey(t, 'write');
    const res = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 9999,
        children: 9999,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect((body.error as { code: string }).code).toBe('OVER_OCCUPANCY');
  });

  it('a conflicting hold returns 409', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const holdBody = (checkIn: string, checkOut: string, email: string) =>
      JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn,
        checkOut,
        adults: 2,
        children: 0,
        guest: { name: 'G', email, phone: '780', marketingOptIn: false },
        addOns: [],
      });
    const first = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: holdBody(D(10), D(13), 'a@example.com'),
    });
    expect(first.status).toBe(200);
    const conflict = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: holdBody(D(12), D(15), 'b@example.com'),
    });
    expect(conflict.status).toBe(409);
    const body = await jsonOf(conflict);
    expect((body.error as { code: string }).code).toBe('DATES_UNAVAILABLE');
  });

  it('cancel with matching email cancels the booking', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const holdRes = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(30),
        checkOut: D(32),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const held = (await jsonOf(holdRes)).data as { confirmationCode: string };

    const res = await t.fetch(`/api/v1/bookings/${held.confirmationCode}/cancel`, {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'g@example.com' }),
    });
    expect(res.status).toBe(200);

    const view = await t.fetch(`/api/v1/bookings/${held.confirmationCode}`, {
      method: 'GET',
      headers: bearer(writeToken),
    });
    const data = (await jsonOf(view)).data as { status: string };
    expect(data.status).toBe('cancelled');
  });

  it('cancel with a read key is 403; missing email is 400', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const writeToken = await seedKey(t, 'write');
    const holdRes = await t.fetch('/api/v1/bookings/hold', {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: fx.unitId,
        ratePlanId: fx.ratePlanId,
        checkIn: D(10),
        checkOut: D(12),
        adults: 2,
        children: 0,
        guest: { name: 'G', email: 'g@example.com', phone: '780', marketingOptIn: false },
        addOns: [],
      }),
    });
    const held = (await jsonOf(holdRes)).data as { confirmationCode: string };

    const readToken = await seedKey(t, 'read');
    const forbidden = await t.fetch(`/api/v1/bookings/${held.confirmationCode}/cancel`, {
      method: 'POST',
      headers: { ...bearer(readToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'g@example.com' }),
    });
    expect(forbidden.status).toBe(403);

    const noEmail = await t.fetch(`/api/v1/bookings/${held.confirmationCode}/cancel`, {
      method: 'POST',
      headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(noEmail.status).toBe(400);
  });

  it('promo-codes/preview resolves slugs and returns validity', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await t.run(async (ctx) =>
      ctx.db.insert('promoCodes', {
        propertyId: fx.propertyId,
        code: 'WELCOME10',
        normalizedCode: 'WELCOME10',
        kind: 'percent',
        valueBps: 1_000,
        oncePerGuest: false,
        appliesToUnitTypes: [],
        active: true,
        redemptionCount: 0,
        createdAt: Date.now(),
      }),
    );
    const token = await seedKey(t, 'read');
    const res = await t.fetch('/api/v1/promo-codes/preview', {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ property: 'test-grounds', unitType: 'cabin', code: 'welcome10' }),
    });
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as { valid: boolean; code?: string };
    expect(data.valid).toBe(true);
    expect(data.code).toBe('WELCOME10');
  });
});
