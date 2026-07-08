/// <reference types="vite/client" />
// createCheckoutSession ownership check: the confirmation code must match the
// booking, else BOOKING_NOT_FOUND (no enumeration oracle). A correct code mints
// a session (provider mocked via env + fetch).
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { addDays } from '../shared/pricing';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

const today = new Date().toISOString().slice(0, 10);
const D = (offset: number) => addDays(today, offset);

async function seedHold(t: ReturnType<typeof convexTest>) {
  const fx = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      taxLabel: 'GST',
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
      icalExportToken: 'tok-cabin-1-xxxxxxxxxxxx',
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
      cancellationPolicy: [{ daysBefore: 0, refundPercent: 0 }],
    });
    return { propertyId, unitTypeId, unitId, ratePlanId };
  });
  const hold = await t.mutation(api.bookings.createHold, {
    unitId: fx.unitId,
    ratePlanId: fx.ratePlanId,
    checkIn: D(20),
    checkOut: D(22),
    adults: 2,
    children: 0,
    guest: { name: 'Test Guest', email: 'guest@example.com', phone: '780-555-0100', marketingOptIn: false },
    addOns: [],
  });
  return hold;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createCheckoutSession ownership check', () => {
  it('rejects a wrong confirmation code with BOOKING_NOT_FOUND', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    vi.stubEnv('SITE_URL', 'https://x.example');
    // Fetch should never be reached (we fail before createCheckout); guard it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const t = convexTest(schema, modules);
    const hold = await seedHold(t);

    await expect(
      t.action(api.payments.checkout.createCheckoutSession, {
        bookingId: hold.bookingId,
        provider: 'stripe',
        code: 'OS-WRONG9',
      }),
    ).rejects.toThrow(/BOOKING_NOT_FOUND/);
  });

  it('mints a session when the code matches', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    vi.stubEnv('SITE_URL', 'https://x.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/checkout/sessions')) {
          return new Response(JSON.stringify({ id: 'cs_new', url: 'https://pay.stripe/cs_new' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    const t = convexTest(schema, modules);
    const hold = await seedHold(t);

    const result = await t.action(api.payments.checkout.createCheckoutSession, {
      bookingId: hold.bookingId,
      provider: 'stripe',
      code: hold.confirmationCode,
    });
    expect(result.checkoutUrl).toBe('https://pay.stripe/cs_new');
    const rows = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].providerCheckoutId).toBe('cs_new');
  });
});
