/// <reference types="vite/client" />
// Adversarial review pass (see CLAUDE.md "Review policy"). Each test tries to
// find a sequence of events where the code loses money, double-charges,
// double-books, over-discounts, under-charges GST, or leaks a paid booking.
// Tests that FAIL prove a real defect; tests that PASS document a probed gap
// where the code holds.
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
  overrides: Partial<{
    code: string;
    normalizedCode: string;
    kind: 'percent' | 'fixed';
    valueBps: number;
    valueCents: number;
    maxRedemptions: number;
    oncePerGuest: boolean;
    minSubtotalCents: number;
    active: boolean;
    endsAt: number;
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert('promoCodes', {
      propertyId: fx.propertyId,
      code: overrides.code ?? 'WELCOME10',
      normalizedCode: overrides.normalizedCode ?? 'WELCOME10',
      kind: overrides.kind ?? 'percent',
      valueBps: overrides.valueBps ?? 1_000,
      valueCents: overrides.valueCents,
      oncePerGuest: overrides.oncePerGuest ?? false,
      maxRedemptions: overrides.maxRedemptions,
      minSubtotalCents: overrides.minSubtotalCents,
      endsAt: overrides.endsAt,
      appliesToUnitTypes: [],
      active: overrides.active ?? true,
      redemptionCount: 0,
      createdAt: Date.now(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// FINDING 1: confirmSimulated stamps the FULL invoice GST onto a payment whose
// amount is only the deposit. The payment row then claims to contain more GST
// than dollars collected (gstCents can exceed amountCents). This corrupts GST
// remittance for any non-'full' deposit policy.
// ---------------------------------------------------------------------------
describe('FINDING 1: deposit payment carries full-invoice GST', () => {
  it('a percent-deposit confirmation records more GST than it collected', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    // 25% deposit on a $200 + $10 GST = $210 invoice → deposit $52.50 → 5250¢.
    const fx = await seedFixture(t, { depositPolicy: { type: 'percent', value: 25 } });
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId });

    const payment = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
        .first(),
    );
    // Invoice: $200 base + $10 GST = $210 total; 25% deposit collected = 5250¢.
    // A payment's gstCents must be the GST *inside that payment*. For a 25%
    // deposit that is 250¢. The code stamps the FULL invoice GST (1000¢) — the
    // payment claims 4× the GST it actually collected, corrupting remittance.
    expect(payment!.amountCents).toBe(5_250);
    expect(payment!.gstCents).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// FINDING 2: once-per-guest code is re-granted after the guest CANCELS a
// confirmed (paid, redeemed) booking. releasePromoRedemption flips the
// redemption to 'released', and the once-per-guest guard only blocks
// redemptions whose status !== 'released'. So a guest can bank the discount,
// cancel, and redeem the "once per guest" code a second time.
// ---------------------------------------------------------------------------
describe('FINDING 2: once-per-guest re-grantable by cancelling', () => {
  it('lets the same email redeem a once-per-guest code twice via cancel', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { oncePerGuest: true });

    const first = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.confirmSimulated, { bookingId: first.bookingId });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: first.confirmationCode,
      email: 'guest@example.com',
    });

    // Same guest redeems again — a once-per-guest code should now be spent.
    await expect(
      t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(40), D(42)),
        promoCode: 'WELCOME10',
      }),
    ).rejects.toThrow(/PROMO_ALREADY_USED|already used/);
  });
});

// ---------------------------------------------------------------------------
// FINDING 3 (RESOLVED): maxRedemptions means "N discounts ever consumed by
// confirmed bookings". An applied redemption stays consumed even if the
// booking is later cancelled — cancellation must NOT re-open the cap.
// ---------------------------------------------------------------------------
describe('FINDING 3: maxRedemptions cap survives cancellation', () => {
  it('rejects a 2nd redemption of a max=1 code after the 1st confirms then cancels', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { maxRedemptions: 1 });

    const a = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.confirmSimulated, { bookingId: a.bookingId });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: a.confirmationCode,
      email: 'guest@example.com',
    });

    // The one allowed discount was consumed by a confirmed booking; the cap
    // stays closed for everyone afterward.
    await expect(
      t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(30), D(32), 'other@example.com'),
        promoCode: 'WELCOME10',
      }),
    ).rejects.toThrow(/PROMO_EXHAUSTED|fully redeemed/);
  });
});

// ---------------------------------------------------------------------------
// FINDING 4: cancelByGuest on an unpaid HOLD releases the promo redemption and
// frees nights (correct), but a hold can ALSO be silently cancelled by a guest
// who only knows the confirmation code + email — no payment ever happened.
// Probe: does cancelling a hold leave the promo count and redemption consistent?
// ---------------------------------------------------------------------------
describe('FINDING 4: cancel of an unpaid hold', () => {
  it('cancelling a hold releases redemption and refunds zero', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 1 });
    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    const res = await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    expect(res.paidCents).toBe(0);
    expect(res.refundCents).toBe(0);
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo?.redemptionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FINDING 5: once-per-guest / hold-cap keyed on raw normalized email is
// bypassable with plus-addressing or gmail dots — the same human redeems a
// once-per-guest code repeatedly. Industry-standard limitation, but the code
// advertises enforcement, so this documents the gap.
// ---------------------------------------------------------------------------
describe('FINDING 5: once-per-guest email-alias bypass', () => {
  it('lets one human redeem a once-per-guest code via plus-addressing', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { oncePerGuest: true });

    const first = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32), 'sam@example.com'),
      promoCode: 'WELCOME10',
    });
    expect(first.price.promoDiscountCents).toBeGreaterThan(0);

    // Same person, "+promo" alias — routes to the same inbox but a different
    // normalizedEmail, so the once-per-guest guard does not fire.
    const second = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(40), D(42), 'sam+promo@example.com'),
      promoCode: 'WELCOME10',
    });
    // Documents the bypass: both redemptions succeed with a discount.
    expect(second.price.promoDiscountCents).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FINDING 6: DOUBLE-BOOK PROBE. A hold expires (nights freed), a second guest
// books those exact nights, and THEN the first hold is confirmed. If the
// confirm path did not re-guard on status, two confirmed bookings would own the
// same nights. Verify the status guard actually prevents it (expected: holds).
// ---------------------------------------------------------------------------
describe('FINDING 6: confirm-after-expiry double-book probe', () => {
  it('refuses to confirm an expired hold whose nights were rebooked', async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv('DEMO_MODE', 'true');
      const t = convexTest(schema, modules);
      const fx = await seedFixture(t);
      const first = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));

      // Expire the first hold.
      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      await t.mutation(internal.bookings.expireHolds, {});

      // Second guest grabs the freed nights and confirms.
      const second = await t.mutation(
        api.bookings.createHold,
        holdArgs(fx, D(10), D(13), 'other@example.com'),
      );
      await t.mutation(api.bookings.confirmSimulated, { bookingId: second.bookingId });

      // Confirming the STALE first hold must fail — else two confirmed bookings
      // own D(10)-D(13).
      await expect(
        t.mutation(api.bookings.confirmSimulated, { bookingId: first.bookingId }),
      ).rejects.toThrow(/HOLD_NOT_ACTIVE|no longer holdable/);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// FINDING 7: DOUBLE-CHARGE PROBE. Confirm a hold, cancel it, then attempt to
// confirm again. If confirmSimulated did not re-guard on status, it would
// insert a SECOND payment on a cancelled booking (double-charge). Verify the
// status guard holds (expected: holds).
// ---------------------------------------------------------------------------
describe('FINDING 7: re-confirm after cancel double-charge probe', () => {
  it('refuses to re-confirm a cancelled booking', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(30), D(32)));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    await expect(
      t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId }),
    ).rejects.toThrow(/HOLD_NOT_ACTIVE|no longer holdable/);

    const payments = await t.run(async (ctx) =>
      ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
        .collect(),
    );
    expect(payments).toHaveLength(1); // never a second charge
  });
});

// ---------------------------------------------------------------------------
// FINDING 8: DOUBLE-DECREMENT PROBE. Cancel a confirmed booking twice (second
// call must be blocked by the status guard) — count integrity must hold.
// Updated for the findings-2/3 fix: an APPLIED redemption stays consumed on
// cancel (no decrement), so with one applied + one reserved the count is 2.
// ---------------------------------------------------------------------------
describe('FINDING 8: double-cancel redemption-count integrity', () => {
  it('a second cancel does not corrupt redemptionCount', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 5 });
    // Two independent guests redeem, bringing count to 2.
    const a = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(40), D(42), 'other@example.com'),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.confirmSimulated, { bookingId: a.bookingId });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: a.confirmationCode,
      email: 'guest@example.com',
    });
    // Second cancel is blocked (already cancelled).
    await expect(
      t.mutation(api.bookings.cancelByGuest, {
        confirmationCode: a.confirmationCode,
        email: 'guest@example.com',
      }),
    ).rejects.toThrow(/NOT_CANCELLABLE|is cancelled/);
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    // a's redemption stays APPLIED (consumed by a confirmed booking); the
    // other guest's is still reserved → count === 2, and never negative.
    expect(promo?.redemptionCount).toBe(2);
  });
});
