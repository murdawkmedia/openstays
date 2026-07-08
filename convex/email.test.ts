/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { renderCancellation } from './emailTemplates';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

async function seedBooking(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Pinewood Flats',
      slug: 'pinewood-flats',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      taxLabel: 'GST',
      email: 'stays@pinewood.example',
      phone: '780-555-0100',
      address: '1 Pinewood Rd',
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
      icalExportToken: 'test-token-cabin-1',
      icalImports: [],
      sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId,
      name: 'Jamie Guest',
      email: 'jamie@example.com',
      phone: '780-555-0199',
      normalizedEmail: 'jamie@example.com',
      normalizedPhone: '7805550199',
      marketingOptIn: false,
      notes: [],
    });
    const now = Date.now();
    const bookingId = await ctx.db.insert('bookings', {
      propertyId,
      unitId,
      unitTypeId,
      guestId,
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      nights: 3,
      adults: 2,
      children: 0,
      status: 'confirmed',
      source: 'online',
      confirmationCode: 'OS-7K3M2Q',
      priceBreakdown: {
        nightlySubtotalCents: 30_000,
        addOnSubtotalCents: 0,
        promoDiscountCents: 0,
        taxableSubtotalCents: 30_000,
        gstCents: 1_500,
        totalCents: 31_500,
        giftCertAppliedCents: 0,
        depositDueCents: 31_500,
        balanceDueCents: 0,
      },
      statusHistory: [{ status: 'confirmed', ts: now }],
      notes: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('payments', {
      propertyId,
      bookingId,
      provider: 'simulated',
      amountCents: 31_500,
      gstCents: 1_500,
      currency: 'CAD',
      status: 'paid',
      refunds: [],
      createdAt: now,
      paidAt: now,
    });
    return { propertyId, unitTypeId, unitId, guestId, bookingId };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getEmailContext', () => {
  it('assembles template data + guest email + paid/balance figures', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);
    const context = await t.query(internal.email.getEmailContext, { bookingId: fx.bookingId });
    expect(context).toMatchObject({
      guestName: 'Jamie Guest',
      guestEmail: 'jamie@example.com',
      propertyName: 'Pinewood Flats',
      unitTypeName: 'Cabin',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      nights: 3,
      confirmationCode: 'OS-7K3M2Q',
      currency: 'CAD',
      taxLabel: 'GST',
      totalCents: 31_500,
      paidCents: 31_500,
      balanceDueCents: 0,
    });
    expect(context?.manageUrl).toBe('/manage/OS-7K3M2Q');
  });

  it('subtracts refunds from paidCents for a partially_refunded row', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);
    // Turn the seeded 31,500¢ paid row into a partially_refunded row: 4,000¢
    // refunded → 27,500¢ still held. balanceDue = 31,500 − 27,500 = 4,000.
    await t.run(async (ctx) => {
      const payment = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .first();
      await ctx.db.patch(payment!._id, {
        status: 'partially_refunded',
        refunds: [{ amountCents: 4_000, reason: 'partial', ts: Date.now(), by: 'system' }],
      });
    });

    const context = await t.query(internal.email.getEmailContext, { bookingId: fx.bookingId });
    expect(context?.paidCents).toBe(27_500);
    expect(context?.balanceDueCents).toBe(4_000);
    expect(context?.refundCents).toBe(4_000);
  });

  it('counts a fully refunded row as 0 paid', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);
    await t.run(async (ctx) => {
      const payment = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .first();
      await ctx.db.patch(payment!._id, {
        status: 'refunded',
        refunds: [{ amountCents: 31_500, reason: 'guest_cancellation', ts: Date.now(), by: 'system' }],
      });
    });

    const context = await t.query(internal.email.getEmailContext, { bookingId: fx.bookingId });
    expect(context?.paidCents).toBe(0);
    expect(context?.balanceDueCents).toBe(31_500);
  });
});

describe('renderCancellation — refund copy', () => {
  const base = {
    guestName: 'Jamie',
    propertyName: 'Pinewood Flats',
    propertyEmail: 'stays@pinewood.example',
    propertyPhone: '780-555-0100',
    unitTypeName: 'Cabin',
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    nights: 3,
    confirmationCode: 'OS-7K3M2Q',
    currency: 'CAD',
    taxLabel: 'GST',
    totalCents: 31_500,
    paidCents: 0,
    balanceDueCents: 0,
    manageUrl: '/manage/OS-7K3M2Q',
  };

  it('shows the policy refund amount and "being processed" copy for a provider refund in flight', () => {
    const rendered = renderCancellation({ ...base, refundCents: 21_000, refundInFlight: true });
    expect(rendered.text).toContain('Refund: $210.00');
    expect(rendered.text).toMatch(/being processed/);
    expect(rendered.html).toMatch(/being processed/);
  });

  it('omits the processing note when there is no refund', () => {
    const rendered = renderCancellation({ ...base, refundCents: 0, refundInFlight: false });
    expect(rendered.text).toContain('Refund: $0.00');
    expect(rendered.text).not.toMatch(/being processed/);
  });
});

describe('sendBookingEmail — no provider configured', () => {
  it('writes a logged emailLog row with the rendered subject when RESEND_API_KEY is unset', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('logged');
    expect(logs[0].templateKey).toBe('confirmation');
    expect(logs[0].subject).toBe('Booking confirmed — OS-7K3M2Q');
    expect(logs[0].to).toBe('jamie@example.com');
  });
});

describe('sendBookingEmail — DEMO_MODE', () => {
  it('logs instead of sending even when RESEND_API_KEY is set', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('logged');
  });
});

describe('sendBookingEmail — idempotency', () => {
  it('a second call for the same (bookingId, kind) adds no new row once logged', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });
    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
  });

  it('a second call for a DIFFERENT kind is not suppressed', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });
    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'cancellation' });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.templateKey).sort()).toEqual(['cancellation', 'confirmation']);
  });
});

describe('sendBookingEmail — real provider (mocked fetch)', () => {
  it('2xx response updates the log to sent with providerMessageId', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM', 'Pinewood Flats <stays@pinewood.example>');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Pinewood Flats <stays@pinewood.example>');
    expect(body.to).toBe('jamie@example.com');
    expect(body.subject).toBe('Booking confirmed — OS-7K3M2Q');

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('sent');
    expect(logs[0].providerMessageId).toBe('resend-msg-123');
  });

  it('4xx response marks the log failed with no retry scheduled', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);

    const t = convexTest(schema, modules);
    const fx = await seedBooking(t);

    await t.action(internal.email.sendBookingEmail, { bookingId: fx.bookingId, kind: 'confirmation' });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', fx.bookingId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].error).toMatch(/422/);
  });
});
