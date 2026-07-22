/// <reference types="vite/client" />
// Full webhook-confirm flow (convex-test). Seeds property/unit/ratePlan/hold via
// the same patterns as bookings.test.ts, then drives the M1 payment bridge
// internal functions directly: recordPendingPayment → confirmFromPayment (and
// markCheckoutFailed / cancelByGuest refund scheduling). The adversarial
// reviewer attacks money integrity, so the assertions pin GST extraction,
// idempotency, re-acquire, and payment_conflict refund scheduling.
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { addDays } from '../shared/pricing';
import { gstForPayment } from './bookings';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

const today = new Date().toISOString().slice(0, 10);
const D = (offset: number) => addDays(today, offset);

async function seedFixture(
  t: ReturnType<typeof convexTest>,
  opts: {
    prepBufferNights?: number;
    depositPolicy?: { type: 'full' | 'percent' | 'flat' | 'first_night'; value: number };
    baseNightlyCents?: number;
  } = {},
) {
  return await t.run(async (ctx) => {
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
      baseNightlyCents: opts.baseNightlyCents ?? 10_000,
      seasons: [],
      minStayNights: 1,
      maxStayNights: 28,
      minLeadTimeHours: 0,
      maxAdvanceDays: 365,
      prepBufferNights: opts.prepBufferNights ?? 0,
      depositPolicy: opts.depositPolicy ?? { type: 'full', value: 0 },
      cancellationPolicy: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    });
    return { propertyId, unitTypeId, unitId, ratePlanId };
  });
}

const guest = (email = 'guest@example.com') => ({
  name: 'Test Guest',
  email,
  phone: '780-555-0100',
  marketingOptIn: false,
});

function holdArgs(
  fx: { unitId: Id<'units'>; ratePlanId: Id<'ratePlans'> },
  checkIn: string,
  checkOut: string,
  email?: string,
) {
  return {
    unitId: fx.unitId,
    ratePlanId: fx.ratePlanId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guest: guest(email),
    addOns: [],
  };
}

async function seedPromo(
  t: ReturnType<typeof convexTest>,
  fx: { propertyId: Id<'properties'> },
  overrides: Partial<{ maxRedemptions: number; oncePerGuest: boolean }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert('promoCodes', {
      propertyId: fx.propertyId,
      code: 'WELCOME10',
      normalizedCode: 'WELCOME10',
      kind: 'percent',
      valueBps: 1_000,
      oncePerGuest: overrides.oncePerGuest ?? false,
      maxRedemptions: overrides.maxRedemptions,
      appliesToUnitTypes: [],
      active: true,
      redemptionCount: 0,
      createdAt: Date.now(),
    }),
  );
}

/** Insert a pending stripe payment row for `bookingId` with checkout id `co`. */
async function recordPending(
  t: ReturnType<typeof convexTest>,
  bookingId: Id<'bookings'>,
  co: string,
  amountCents: number,
) {
  return await t.mutation(internal.bookings.recordPendingPayment, {
    bookingId,
    provider: 'stripe' as const,
    providerCheckoutId: co,
    amountCents,
    currency: 'CAD',
  });
}

/** Insert a pending payment row for `bookingId` on a specific provider. */
async function recordPendingProvider(
  t: ReturnType<typeof convexTest>,
  bookingId: Id<'bookings'>,
  provider: 'stripe' | 'square',
  co: string,
  amountCents: number,
) {
  return await t.mutation(internal.bookings.recordPendingPayment, {
    bookingId,
    provider,
    providerCheckoutId: co,
    amountCents,
    currency: 'CAD',
  });
}

/** Read the scheduled _scheduled_functions rows (inspect before they execute). */
async function scheduledNames(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query('_scheduled_functions').collect();
    return jobs.map((j) => ({ name: j.name, args: j.args, state: j.state.kind }));
  });
}

/**
 * Configure stripe env + a stubbed fetch that answers the refund endpoint, so a
 * scheduled refundPayment action can run to completion INSIDE the test
 * transaction lifecycle instead of leaking a write past teardown.
 */
function stubStripeRefundFetch() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_synthetic');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/v1/refunds')) {
        return new Response(JSON.stringify({ id: 're_test_1' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

/**
 * Drain every scheduled function (confirmation/cancellation emails — no-ops in
 * test — and any provider refund) so no runAfter(0) setTimeout leaks a DB write
 * past the test's transaction lifecycle. Booking flows fire-and-forget schedule
 * emails, so EVERY test that confirms/cancels must drain.
 *
 * finishAllScheduledFunctions only awaits jobs already flipped to 'inProgress';
 * a just-scheduled runAfter(0) job is still 'pending' until its setTimeout fires
 * on the next real tick. So under real timers we tick the event loop until the
 * _scheduled_functions table is empty of pending/in-progress rows; under fake
 * timers we advance the fake clock instead.
 */
async function drain(t: ReturnType<typeof convexTest>) {
  const fake = vi.isFakeTimers();
  for (let i = 0; i < 50; i += 1) {
    const pending = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.filter((j) => j.state.kind === 'pending' || j.state.kind === 'inProgress').length;
    });
    if (pending === 0) return;
    if (fake) {
      await vi.runAllTimersAsync();
    } else {
      // Let the pending setTimeout(0) callbacks run and their async bodies settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await t.finishInProgressScheduledFunctions();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Happy path: confirm a hold, GST extracted per-payment on a 25% deposit.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: hold → confirmed', () => {
  it('confirms the hold, flips payment to paid, extracts GST from the deposit only', async () => {
    const t = convexTest(schema, modules);
    // 25% deposit. 2 nights × $100 = $200 base + $10 GST = $210 invoice.
    // depositDueCents = 25% of $210 = $52.50 = 5250¢.
    const fx = await seedFixture(t, { depositPolicy: { type: 'percent', value: 25 } });
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const deposit = hold.price.depositDueCents;
    expect(deposit).toBe(5_250);

    await recordPending(t, hold.bookingId, 'cs_1', deposit);
    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_1',
      providerPaymentId: 'pi_1',
      amountCents: deposit,
      currency: 'CAD',
    });
    expect(res.outcome).toBe('confirmed');

    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(payment!.status).toBe('paid');
    expect(payment!.providerPaymentId).toBe('pi_1');
    expect(payment!.amountCents).toBe(5_250);
    // GST INSIDE the deposit: round(5250 × 500 / 10500) = 250¢ — NOT the full
    // invoice GST of 1000¢. This is the adversarial-review invariant.
    expect(payment!.gstCents).toBe(250);

    const view = await t.query(api.bookings.byConfirmationCode, { code: hold.confirmationCode });
    expect(view?.status).toBe('confirmed');
    await drain(t); // flush the scheduled confirmation email (no-op)
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate eventId → 'duplicate', no double statusHistory / promo.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: idempotency', () => {
  it('a duplicate eventId is a no-op (no second promo redemption, no extra history)', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 5 });
    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      promoCode: 'WELCOME10',
    });
    await recordPending(t, hold.bookingId, 'cs_2', hold.price.totalCents);

    const first = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_dup',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_2',
      providerPaymentId: 'pi_2',
      amountCents: hold.price.totalCents,
      currency: 'CAD',
    });
    expect(first.outcome).toBe('confirmed');

    const second = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_dup', // SAME event id
      eventType: 'payment_succeeded',
      checkoutId: 'cs_2',
      providerPaymentId: 'pi_2',
      amountCents: hold.price.totalCents,
      currency: 'CAD',
    });
    expect(second.outcome).toBe('duplicate');

    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    const confirmedEntries = booking!.statusHistory.filter((h) => h.status === 'confirmed');
    expect(confirmedEntries).toHaveLength(1);
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(1); // reserved+applied once, not twice
    const redemptions = await t.run(async (ctx) =>
      ctx.db.query('promoRedemptions').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].status).toBe('applied');
    // Also: a second AUTHENTIC event with a NEW id on an already-confirmed
    // booking is a 'duplicate' too (Stripe often sends redundant events).
    const third = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_dup_2',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_2',
      providerPaymentId: 'pi_2',
      amountCents: hold.price.totalCents,
      currency: 'CAD',
    });
    expect(third.outcome).toBe('duplicate');
    await drain(t); // flush the single scheduled confirmation email (no-op)
  });
});

// ---------------------------------------------------------------------------
// 3. Expired hold + free nights → re-acquire confirms + unitNights restored.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: re-acquire after expiry (nights free)', () => {
  it('re-takes the stay + prep nights and confirms', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t, { prepBufferNights: 1 });
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    await recordPending(t, hold.bookingId, 'cs_3', hold.price.totalCents);

    // Expire the hold: nights + reserved redemption released.
    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    await t.mutation(internal.bookings.expireHolds, {});
    const gone = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(gone).toHaveLength(0);

    // Late payment lands; nights still free → re-acquire.
    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_3',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_3',
      providerPaymentId: 'pi_3',
      amountCents: hold.price.totalCents,
      currency: 'CAD',
    });
    expect(res.outcome).toBe('confirmed');

    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    expect(booking!.status).toBe('confirmed');
    const rows = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    // 3 stay (D10,D11,D12) + 1 prep (D13).
    expect(rows.map((r) => r.date).sort()).toEqual([D(10), D(11), D(12), D(13)]);
    expect(rows.filter((r) => r.kind === 'stay')).toHaveLength(3);
    expect(rows.filter((r) => r.kind === 'prep')).toHaveLength(1);
    await drain(t); // flush the scheduled confirmation email (no-op)
  });
});

// ---------------------------------------------------------------------------
// 4. Expired hold + nights taken → 'payment_conflict' + refund + email scheduled.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: payment_conflict (nights re-taken)', () => {
  it('captures money it cannot honour → payment_conflict, schedules full refund + apology, writes no unitNights', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEMO_MODE', 'true');
    stubStripeRefundFetch();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const first = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    await recordPending(t, first.bookingId, 'cs_4', first.price.totalCents);

    // Expire the first hold, then a second guest books + confirms those nights.
    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    await t.mutation(internal.bookings.expireHolds, {});
    const second = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13), 'other@example.com'));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: second.bookingId });

    // First guest's late payment lands — nights are gone.
    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_4',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_4',
      providerPaymentId: 'pi_4',
      amountCents: first.price.totalCents,
      currency: 'CAD',
    });
    expect(res.outcome).toBe('payment_conflict');

    const booking = await t.run(async (ctx) => ctx.db.get(first.bookingId));
    expect(booking!.status).toBe('payment_conflict');
    // No unitNights written for the conflicted booking (second guest owns them).
    const rows = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', first.bookingId)).collect(),
    );
    expect(rows).toHaveLength(0);
    // Second guest still owns exactly their 3 nights.
    const secondRows = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', second.bookingId)).collect(),
    );
    expect(secondRows).toHaveLength(3);

    // Payment was captured (paid), and a full refund + apology email scheduled.
    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', first.bookingId)).first(),
    );
    expect(payment!.status).toBe('paid');
    const scheduled = await scheduledNames(t);
    const refundJob = scheduled.find((s) => s.name.includes('refundPayment'));
    const emailJob = scheduled.find(
      (s) => s.name.includes('sendBookingEmail') && JSON.stringify(s.args).includes('payment_conflict'),
    );
    expect(refundJob).toBeTruthy();
    expect(JSON.stringify(refundJob!.args)).toContain(String(first.price.totalCents));
    expect(JSON.stringify(refundJob!.args)).toContain('payment_after_expiry');
    expect(emailJob).toBeTruthy();

    // Drain the scheduled refund action to completion (stubbed fetch) so it
    // records the refund inside the test lifecycle rather than leaking a write.
    await drain(t);
    const payment2 = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', first.bookingId)).first(),
    );
    expect(payment2!.status).toBe('refunded');
    expect(payment2!.refunds[0].providerRefundId).toBe('re_test_1');
  });
});

describe('confirmFromPayment: manual-refund conflict', () => {
  it('opens one Zaprite refund case instead of scheduling an automatic refund', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const first = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const paymentId = await t.mutation(internal.bookings.recordPendingPayment, {
      bookingId: first.bookingId,
      provider: 'zaprite' as never,
      providerCheckoutId: 'zap_conflict',
      amountCents: first.price.totalCents,
      currency: 'CAD',
    });

    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    await t.mutation(internal.bookings.expireHolds, {});
    const second = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13), 'other@example.com'));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: second.bookingId });

    const result = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'zaprite' as never,
      eventId: 'zaprite:zap_conflict:PAID',
      eventType: 'authoritative_reconciliation',
      checkoutId: 'zap_conflict',
      providerPaymentId: 'zap_conflict',
      amountCents: first.price.totalCents,
      currency: 'CAD',
    });
    expect(result.outcome).toBe('payment_conflict');

    const cases = await t.run(async (ctx) =>
      ctx.db.query('refundCases').withIndex('by_payment_status', (q) =>
        q.eq('paymentId', paymentId).eq('status', 'open'),
      ).collect(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0].reason).toBe('payment_after_expiry');
    const scheduled = await scheduledNames(t);
    expect(scheduled.some((job) => job.name.includes('refundPayment'))).toBe(false);
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 5. markCheckoutFailed flips pending → failed; booking stays hold.
// ---------------------------------------------------------------------------
describe('markCheckoutFailed', () => {
  it('flips the pending payment to failed and leaves the booking on hold', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    await recordPending(t, hold.bookingId, 'cs_5', hold.price.totalCents);

    const res = await t.mutation(internal.bookings.markCheckoutFailed, {
      provider: 'stripe',
      eventId: 'evt_5',
      eventType: 'checkout_expired',
      checkoutId: 'cs_5',
    });
    expect(res.outcome).toBe('failed');

    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(payment!.status).toBe('failed');
    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    expect(booking!.status).toBe('hold'); // the 2-min cron owns hold expiry
    expect(booking!.holdExpiresAt).toBeTruthy();

    // Duplicate delivery is a no-op.
    const dup = await t.mutation(internal.bookings.markCheckoutFailed, {
      provider: 'stripe',
      eventId: 'evt_5',
      eventType: 'checkout_expired',
      checkoutId: 'cs_5',
    });
    expect(dup.outcome).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------
// 6. Orphan checkoutId → 'orphan', idempotent on re-delivery.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: orphan checkout id', () => {
  it('returns orphan when no pending row matches, and stays orphan on retry', async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const first = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_orphan',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_nonexistent',
      providerPaymentId: 'pi_x',
      amountCents: 5000,
      currency: 'CAD',
    });
    expect(first.outcome).toBe('orphan');
    // The event was still recorded, so a retry is a no-op 'duplicate'.
    const retry = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_orphan',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_nonexistent',
      providerPaymentId: 'pi_x',
      amountCents: 5000,
      currency: 'CAD',
    });
    expect(retry.outcome).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------
// 7. Promo re-acquire: applied even at cap, redemptionCount incremented.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: promo on re-acquire (cap exceeded is OK)', () => {
  it('inserts a fresh applied redemption and bumps the count past the cap', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 1 });

    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      promoCode: 'WELCOME10',
    });
    await recordPending(t, hold.bookingId, 'cs_7', hold.price.totalCents);

    // Expire → reserved redemption released, count back to 0.
    vi.setSystemTime(Date.now() + 36 * 60 * 1000);
    await t.mutation(internal.bookings.expireHolds, {});
    let promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(0);

    // Another guest consumes the single slot in the meantime.
    const other = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(50), D(52), 'other@example.com'),
      promoCode: 'WELCOME10',
    });
    expect(other.price.promoDiscountCents).toBeGreaterThan(0);
    promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(1); // cap now hit

    // First guest's late payment lands, nights free → re-acquire. The guest
    // already paid the discounted price, so we apply the promo even though the
    // cap is exceeded (money integrity wins over the marketing cap).
    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_7',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_7',
      providerPaymentId: 'pi_7',
      amountCents: hold.price.totalCents,
      currency: 'CAD',
    });
    expect(res.outcome).toBe('confirmed');

    const redemptions = await t.run(async (ctx) =>
      ctx.db.query('promoRedemptions').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    // Original reserved was released; a fresh 'applied' row now exists.
    expect(redemptions.some((r) => r.status === 'applied')).toBe(true);
    promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(2); // 1 (other) + 1 (re-acquire past cap)

    // Drain the scheduled confirmation email (no-op action) so nothing leaks.
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 8. cancelByGuest on a stripe-paid booking schedules refundPayment.
// ---------------------------------------------------------------------------
describe('cancelByGuest: provider-paid booking schedules a provider refund', () => {
  it('schedules refundPayment with the policy-computed amount instead of recording inline', async () => {
    vi.useFakeTimers();
    stubStripeRefundFetch();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    // Book 30 days out (policy → 100% refund) and confirm via a stripe webhook.
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(30), D(32)));
    const total = hold.price.totalCents;
    await recordPending(t, hold.bookingId, 'cs_8', total);
    await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_8',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_8',
      providerPaymentId: 'pi_8',
      amountCents: total,
      currency: 'CAD',
    });

    const res = await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    // 30 days out → 100% refund of the paid amount.
    expect(res.paidCents).toBe(total);
    expect(res.refundCents).toBe(total);

    // The refund was NOT recorded inline (provider refund runs in a scheduled
    // action); the payment row is still 'paid' until the action confirms.
    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(payment!.status).toBe('paid');
    expect(payment!.refunds).toHaveLength(0);

    const scheduled = await scheduledNames(t);
    const refundJob = scheduled.find((s) => s.name.includes('refundPayment'));
    expect(refundJob).toBeTruthy();
    expect(JSON.stringify(refundJob!.args)).toContain(String(total));
    expect(JSON.stringify(refundJob!.args)).toContain('guest_cancellation');
    // A cancellation email was scheduled too.
    const emailJob = scheduled.find(
      (s) => s.name.includes('sendBookingEmail') && JSON.stringify(s.args).includes('cancellation'),
    );
    expect(emailJob).toBeTruthy();

    // Drain: the scheduled provider refund now runs (stubbed fetch) and records.
    await drain(t);
    const settled = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(settled!.status).toBe('refunded');
    expect(settled!.refunds).toHaveLength(1);
    expect(settled!.refunds[0].amountCents).toBe(total);
    expect(settled!.refunds[0].providerRefundId).toBe('re_test_1');
  });
});

describe('cancelByGuest: manual-refund providers open a staff case', () => {
  it('keeps a Zaprite payment paid until staff records the external refund', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(30), D(32)));

    const paymentId = await t.run(async (ctx) =>
      ctx.db.insert('payments', {
        propertyId: fx.propertyId,
        bookingId: hold.bookingId,
        provider: 'zaprite' as never,
        providerCheckoutId: 'zap_order_manual_refund',
        providerPaymentId: 'zap_payment_manual_refund',
        amountCents: hold.price.totalCents,
        gstCents: hold.price.gstCents,
        currency: 'CAD',
        status: 'paid',
        refunds: [],
        createdAt: Date.now(),
        paidAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.patch(hold.bookingId, {
        status: 'confirmed',
        holdExpiresAt: undefined,
      }),
    );

    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });

    const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment!.status).toBe('paid');
    expect(payment!.refunds).toHaveLength(0);

    const cases = await t.run(async (ctx) =>
      ctx.db.query('refundCases').withIndex('by_payment_status', (q) =>
        q.eq('paymentId', paymentId).eq('status', 'open'),
      ).collect(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      bookingId: hold.bookingId,
      amountCents: hold.price.totalCents,
      currency: 'CAD',
      reason: 'guest_cancellation',
      status: 'open',
    });

    const scheduled = await scheduledNames(t);
    expect(scheduled.some((job) => job.name.includes('refundPayment'))).toBe(false);
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 9. recordRefund status transitions (unit-level).
// ---------------------------------------------------------------------------
describe('recordRefund', () => {
  it('marks partially_refunded then refunded as the cumulative amount reaches the total', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const paymentId = await recordPending(t, hold.bookingId, 'cs_9', hold.price.totalCents);
    // Mark it paid so refunds make sense.
    await t.run(async (ctx) => ctx.db.patch(paymentId, { status: 'paid', paidAt: Date.now() }));

    await t.mutation(internal.bookings.recordRefund, {
      paymentId,
      amountCents: 5_000,
      providerRefundId: 're_1',
      reason: 'partial',
    });
    let payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment!.status).toBe('partially_refunded');
    expect(payment!.refunds).toHaveLength(1);

    await t.mutation(internal.bookings.recordRefund, {
      paymentId,
      amountCents: hold.price.totalCents - 5_000,
      providerRefundId: 're_2',
      reason: 'remainder',
    });
    payment = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(payment!.status).toBe('refunded');
    expect(payment!.refunds).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 10. recordPendingPayment idempotency (guest retries checkout creation).
// ---------------------------------------------------------------------------
describe('recordPendingPayment', () => {
  it('returns the existing row id for a repeated booking+provider+checkoutId', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const id1 = await recordPending(t, hold.bookingId, 'cs_same', 5000);
    const id2 = await recordPending(t, hold.bookingId, 'cs_same', 5000);
    expect(id1).toBe(id2);
    const rows = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 11. CRITICAL: double-charge. Two distinct pending sessions (stripe cs_A +
//     square ord_B) both captured → the SECOND is 'duplicate_payment', flipped
//     paid, a full refund scheduled, booking still confirmed once, promo count
//     unchanged, apology email scheduled. (Old behavior: swallowed 'duplicate',
//     row B stranded 'pending' forever, money silently kept.)
// ---------------------------------------------------------------------------
describe('confirmFromPayment: second distinct capture on a confirmed booking (double-charge)', () => {
  it("records + auto-refunds the second capture as 'duplicate_payment', confirming only once", async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEMO_MODE', 'true');
    stubStripeRefundFetch();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 5 });
    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      promoCode: 'WELCOME10',
    });
    const total = hold.price.totalCents;
    // Two live sessions for one hold: stripe cs_A + square ord_B.
    await recordPendingProvider(t, hold.bookingId, 'stripe', 'cs_A', total);
    await recordPendingProvider(t, hold.bookingId, 'square', 'ord_B', total);

    // Pay session A → hold confirmed.
    const first = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_A',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_A',
      providerPaymentId: 'pi_A',
      amountCents: total,
      currency: 'CAD',
    });
    expect(first.outcome).toBe('confirmed');

    // Pay session B → SECOND capture on an already-confirmed booking.
    const second = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'square',
      eventId: 'evt_B',
      eventType: 'payment_succeeded',
      checkoutId: 'ord_B',
      providerPaymentId: 'sqpay_B',
      amountCents: total,
      currency: 'CAD',
    });
    expect(second.outcome).toBe('duplicate_payment');

    // Booking confirmed exactly once; promo consumed exactly once.
    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    expect(booking!.status).toBe('confirmed');
    expect(booking!.statusHistory.filter((h) => h.status === 'confirmed')).toHaveLength(1);
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(1);

    // Row B was flipped to paid (audit) and a FULL refund + apology scheduled.
    const rowB = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_provider_checkout', (q) => q.eq('provider', 'square').eq('providerCheckoutId', 'ord_B'))
        .first(),
    );
    expect(rowB!.status).toBe('paid');
    const scheduled = await scheduledNames(t);
    const refundJob = scheduled.find(
      (s) => s.name.includes('refundPayment') && JSON.stringify(s.args).includes('duplicate_payment'),
    );
    expect(refundJob).toBeTruthy();
    expect(JSON.stringify(refundJob!.args)).toContain(String(total));
    const emailJob = scheduled.find(
      (s) => s.name.includes('sendBookingEmail') && JSON.stringify(s.args).includes('payment_conflict'),
    );
    expect(emailJob).toBeTruthy();
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 12. CRITICAL: resurrection. A cancelled+refunded booking gets a fresh success
//     event → 'late_capture_refunded', booking stays cancelled, NO unitNights
//     written, the settled row is untouched (immutability), promo NOT re-applied.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: redundant event on a cancelled+refunded booking (resurrection)', () => {
  it('does not resurrect: settled row untouched, no unitNights, promo count unchanged', async () => {
    vi.useFakeTimers();
    // Square payment: stub the Square refund endpoint so cancelByGuest's
    // scheduled refund settles the row to 'refunded' inside the test lifecycle.
    vi.stubEnv('SQUARE_ACCESS_TOKEN', 'sq_test');
    vi.stubEnv('SQUARE_LOCATION_ID', 'loc');
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', 'key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v2/refunds')) {
          return new Response(JSON.stringify({ refund: { id: 'sqrf_1' } }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 5 });
    // Book 30 days out (100% refund policy) via square, with a promo.
    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    const total = hold.price.totalCents;
    await recordPendingProvider(t, hold.bookingId, 'square', 'ord_x', total);
    await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'square',
      eventId: 'evt_pay',
      eventType: 'payment_succeeded',
      checkoutId: 'ord_x',
      providerPaymentId: 'sqpay_x',
      amountCents: total,
      currency: 'CAD',
    });

    // Guest cancels → nights released, refund scheduled + settled.
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    await drain(t); // settle the refund (payment → refunded)
    const afterCancel = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(afterCancel!.status).toBe('refunded');
    const promoAfterCancel = await t.run(async (ctx) => ctx.db.get(promoId));

    // Square re-emits payment.updated (still COMPLETED) with a NEW event_id.
    const resurrect = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'square',
      eventId: 'evt_reemit',
      eventType: 'payment_succeeded',
      checkoutId: 'ord_x',
      providerPaymentId: 'sqpay_x',
      amountCents: total,
      currency: 'CAD',
    });
    // Settled row → immutable → 'duplicate' (no re-flip, no resurrection).
    expect(resurrect.outcome).toBe('duplicate');

    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    expect(booking!.status).toBe('cancelled');
    const nights = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(nights).toHaveLength(0);
    // Payment row still 'refunded' — NOT re-flipped to paid.
    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(payment!.status).toBe('refunded');
    expect(payment!.refunds).toHaveLength(1); // no second refund appended
    // Promo NOT re-applied: no new applied redemption, count unchanged.
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo!.redemptionCount).toBe(promoAfterCancel!.redemptionCount);
    const redemptions = await t.run(async (ctx) =>
      ctx.db.query('promoRedemptions').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    expect(redemptions.filter((r) => r.status === 'applied')).toHaveLength(1);
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 13. Immutability: a redundant fresh-eventId success for an already-'paid' row
//     is 'duplicate' and touches nothing (still holds after the row is refunded).
// ---------------------------------------------------------------------------
describe('confirmFromPayment: settled-row immutability', () => {
  it("a fresh event on an already-'paid' row is 'duplicate' with no re-flip", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const total = hold.price.totalCents;
    await recordPending(t, hold.bookingId, 'cs_im', total);
    await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_im1',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_im',
      providerPaymentId: 'pi_im',
      amountCents: total,
      currency: 'CAD',
    });
    const paidAtBefore = await t.run(async (ctx) => {
      const p = await ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first();
      return p!.paidAt;
    });

    // A DIFFERENT event id for the same 'paid' row → duplicate, untouched.
    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_im2',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_im',
      providerPaymentId: 'pi_im',
      amountCents: total,
      currency: 'CAD',
    });
    expect(res.outcome).toBe('duplicate');
    const after = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    expect(after!.status).toBe('paid');
    expect(after!.paidAt).toBe(paidAtBefore); // not re-flipped
    // No refund scheduled by the duplicate.
    const scheduled = await scheduledNames(t);
    expect(scheduled.some((s) => s.name.includes('refundPayment'))).toBe(false);
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 14. Amount mismatch: captured amount ≠ pending row → 'amount_mismatch', no
//     confirm, full refund + staff alert scheduled.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: amount mismatch', () => {
  it("records the actual capture, does NOT confirm, schedules refund + staff alert", async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEMO_MODE', 'true');
    stubStripeRefundFetch();
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const total = hold.price.totalCents;
    await recordPending(t, hold.bookingId, 'cs_mm', total);

    const res = await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_mm',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_mm',
      providerPaymentId: 'pi_mm',
      amountCents: total - 1000, // short capture
      currency: 'CAD',
    });
    expect(res.outcome).toBe('amount_mismatch');

    const booking = await t.run(async (ctx) => ctx.db.get(hold.bookingId));
    expect(booking!.status).toBe('hold'); // NOT confirmed
    const payment = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).first(),
    );
    // The ACTUAL captured amount was recorded (not the invoice amount).
    expect(payment!.amountCents).toBe(total - 1000);
    const scheduled = await scheduledNames(t);
    const refundJob = scheduled.find(
      (s) => s.name.includes('refundPayment') && JSON.stringify(s.args).includes('amount_mismatch'),
    );
    expect(refundJob).toBeTruthy();
    const alertJob = scheduled.find((s) => s.name.includes('sendStaffAlert'));
    expect(alertJob).toBeTruthy();
    await drain(t);
  });
});

// ---------------------------------------------------------------------------
// 15. Refund retry policy: a 4xx (HTTP 402) → NO retry, dead-letter + staff
//     alert; a network / 5xx → a retry IS scheduled.
// ---------------------------------------------------------------------------
describe('refundPayment: retry only on transient failures', () => {
  async function seedPaidStripe(t: ReturnType<typeof convexTest>) {
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const paymentId = await recordPending(t, hold.bookingId, 'cs_r', hold.price.totalCents);
    await t.run(async (ctx) =>
      ctx.db.patch(paymentId, { status: 'paid', paidAt: Date.now(), providerPaymentId: 'pi_r' }),
    );
    return { paymentId, amount: hold.price.totalCents };
  }

  it('a 4xx refund error dead-letters immediately (no retry) and alerts staff', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/v1/refunds')) return new Response('card_error', { status: 402 });
        return new Response('{}', { status: 200 }); // sendStaffAlert send path (no RESEND key → logs anyway)
      }),
    );
    const t = convexTest(schema, modules);
    const { paymentId, amount } = await seedPaidStripe(t);

    await t.action(internal.payments.webhooks.refundPayment, {
      paymentId,
      amountCents: amount,
      reason: 'guest_cancellation',
    });

    // No retry scheduled.
    const scheduled = await scheduledNames(t);
    expect(scheduled.some((s) => s.name.includes('refundPayment'))).toBe(false);
    // A refund_failed log row exists.
    const logs = await t.run(async (ctx) => ctx.db.query('emailLog').collect());
    expect(logs.some((l) => l.templateKey === 'refund_failed')).toBe(true);
    expect(logs.some((l) => l.templateKey === 'staff_alert')).toBe(true);
  });

  it('a 5xx refund error schedules a retry', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream', { status: 503 })),
    );
    const t = convexTest(schema, modules);
    const { paymentId, amount } = await seedPaidStripe(t);

    await t.action(internal.payments.webhooks.refundPayment, {
      paymentId,
      amountCents: amount,
      reason: 'guest_cancellation',
    });

    const scheduled = await scheduledNames(t);
    const retry = scheduled.find((s) => s.name.includes('refundPayment'));
    expect(retry).toBeTruthy();
    expect(JSON.stringify(retry!.args)).toContain('"attempt":2');
    // No dead-letter yet (still retrying).
    const logs = await t.run(async (ctx) => ctx.db.query('emailLog').collect());
    expect(logs.some((l) => l.templateKey === 'refund_failed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16. Per-payment GST attribution (pure helper). Invoice-proportional with a
//     remainder on the settling payment so the sum equals invoice GST EXACTLY,
//     and non-taxable add-ons never inflate it.
// ---------------------------------------------------------------------------
describe('gstForPayment (invoice-proportional attribution)', () => {
  it('25% deposit + 75% balance sum EXACTLY to invoice gstCents', () => {
    // Invoice: total 15,500¢, gst 500¢ (e.g. 10,000 taxable + 5,000 non-taxable
    // at 5%). Deposit = 25% of 15,500 = 3,875; balance = 11,625.
    const pb = { gstCents: 500, totalCents: 15_500 };
    const deposit = 3_875;
    const balance = 15_500 - deposit;

    const gstDeposit = gstForPayment({
      amountCents: deposit,
      priceBreakdown: pb,
      priorPaidCents: 0,
      priorGstCents: 0,
      taxRateBps: 500,
    });
    // Proportional: round(500 · 3875 / 15500) = 125.
    expect(gstDeposit).toBe(125);

    // Balance settles the invoice → remainder attribution = 500 − 125 = 375.
    const gstBalance = gstForPayment({
      amountCents: balance,
      priceBreakdown: pb,
      priorPaidCents: deposit,
      priorGstCents: gstDeposit,
      taxRateBps: 500,
    });
    expect(gstDeposit + gstBalance).toBe(pb.gstCents); // EXACT
  });

  it('does NOT overstate GST on a non-taxable-add-on invoice (full deposit)', () => {
    // The old flat extraction round(amt·rate/(10000+rate)) on the full 15,500
    // payment would claim round(15500·500/10500) = 738¢ — a 48% overstatement.
    const pb = { gstCents: 500, totalCents: 15_500 };
    const gst = gstForPayment({
      amountCents: 15_500,
      priceBreakdown: pb,
      priorPaidCents: 0,
      priorGstCents: 0,
      taxRateBps: 500,
    });
    // Settles the whole invoice → remainder = full invoice GST, exactly 500.
    expect(gst).toBe(500);
  });

  it('falls back to tax-inclusive extraction when there is no priceBreakdown', () => {
    const gst = gstForPayment({
      amountCents: 5_250,
      priceBreakdown: null,
      priorPaidCents: 0,
      priorGstCents: 0,
      taxRateBps: 500,
    });
    // round(5250 · 500 / 10500) = 250 — the legacy behavior.
    expect(gst).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// 17. Deposit-then-balance flow through confirmFromPayment: two captures on the
//     same booking → per-payment gstCents sums to the invoice gstCents exactly.
// ---------------------------------------------------------------------------
describe('confirmFromPayment: deposit + balance GST sums exactly', () => {
  it('two paid captures attribute GST proportionally with a remainder', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    // 25% deposit. 2 nights × $100 = $200 base + $10 GST = $210 invoice.
    const fx = await seedFixture(t, { depositPolicy: { type: 'percent', value: 25 } });
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const pb = hold.price;
    const deposit = pb.depositDueCents; // 5,250
    const balance = pb.totalCents - deposit; // 15,750

    // Capture the deposit (hold → confirmed).
    await recordPending(t, hold.bookingId, 'cs_dep', deposit);
    await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'stripe',
      eventId: 'evt_dep',
      eventType: 'payment_succeeded',
      checkoutId: 'cs_dep',
      providerPaymentId: 'pi_dep',
      amountCents: deposit,
      currency: 'CAD',
    });

    // Capture the balance on the now-confirmed booking. This is a legitimate
    // second capture in the state machine's eyes (duplicate_payment) — but the
    // GST attribution still runs on the paid flip, which is what we assert.
    await recordPendingProvider(t, hold.bookingId, 'square', 'ord_bal', balance);
    await t.mutation(internal.bookings.confirmFromPayment, {
      provider: 'square',
      eventId: 'evt_bal',
      eventType: 'payment_succeeded',
      checkoutId: 'ord_bal',
      providerPaymentId: 'sqpay_bal',
      amountCents: balance,
      currency: 'CAD',
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId)).collect(),
    );
    const totalGst = rows.reduce((sum, p) => sum + p.gstCents, 0);
    expect(totalGst).toBe(pb.gstCents); // sums EXACTLY to the invoice GST
    await drain(t);
  });
});
