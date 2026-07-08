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
