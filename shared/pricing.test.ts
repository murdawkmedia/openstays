import { describe, expect, it } from 'vitest';
import {
  addDays,
  computePrice,
  computeRefundCents,
  daysBetween,
  enumerateNights,
  findSeason,
  isIsoDate,
  validateStayRules,
  type RatePlanLike,
} from './pricing';

const basePlan: RatePlanLike = {
  baseNightlyCents: 10_000,
  seasons: [],
  minStayNights: 1,
  maxStayNights: 21,
  minLeadTimeHours: 0,
  maxAdvanceDays: 365,
  prepBufferNights: 0,
  depositPolicy: { type: 'full', value: 0 },
  cancellationPolicy: [
    { daysBefore: 7, refundPercent: 100 },
    { daysBefore: 2, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ],
};

describe('date helpers', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-07-08')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-7-8')).toBe(false);
    expect(isIsoDate('garbage')).toBe(false);
  });

  it('addDays crosses month/year/leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('enumerateNights is half-open', () => {
    expect(enumerateNights('2026-07-01', '2026-07-04')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(enumerateNights('2026-07-01', '2026-07-01')).toEqual([]);
  });

  it('daysBetween matches nights count', () => {
    expect(daysBetween('2026-07-01', '2026-07-04')).toBe(3);
  });
});

describe('seasons', () => {
  const plan: RatePlanLike = {
    ...basePlan,
    seasons: [
      { label: 'Peak', startDate: '2026-06-15', endDate: '2026-09-01', nightlyCents: 15_000 },
    ],
  };

  it('season boundaries are inclusive on both ends', () => {
    expect(findSeason(plan.seasons, '2026-06-14')).toBeUndefined();
    expect(findSeason(plan.seasons, '2026-06-15')?.label).toBe('Peak');
    expect(findSeason(plan.seasons, '2026-09-01')?.label).toBe('Peak');
    expect(findSeason(plan.seasons, '2026-09-02')).toBeUndefined();
  });

  it('prices a stay straddling a season boundary night-by-night', () => {
    // 2 nights before peak (10k) + 2 nights inside (15k) = 50k
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-06-13',
      checkOut: '2026-06-17',
      addOns: [],
      taxRateBps: 500,
    });
    expect(price.nightlySubtotalCents).toBe(50_000);
    expect(price.gstCents).toBe(2_500);
    expect(price.totalCents).toBe(52_500);
  });
});

describe('GST rounding', () => {
  it('rounds once on the aggregate taxable base', () => {
    // 3 nights at $33.33 = $99.99 → GST 5% = 499.95¢ → rounds to 500¢, not 3×167=501
    const plan = { ...basePlan, baseNightlyCents: 3_333 };
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-04',
      addOns: [],
      taxRateBps: 500,
    });
    expect(price.nightlySubtotalCents).toBe(9_999);
    expect(price.gstCents).toBe(500);
    expect(price.totalCents).toBe(10_499);
  });

  it('non-taxable add-ons are excluded from the GST base', () => {
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [
        { name: 'Firewood', unitPriceCents: 1_200, quantity: 2, taxable: true },
        { name: 'Donation', unitPriceCents: 500, quantity: 1, taxable: false },
      ],
      taxRateBps: 500,
    });
    expect(price.addOnSubtotalCents).toBe(2_900);
    expect(price.taxableSubtotalCents).toBe(12_400); // 10000 night + 2400 firewood
    expect(price.gstCents).toBe(620);
    expect(price.totalCents).toBe(10_000 + 2_900 + 620);
  });

  it('total always equals subtotal - promo + gst, to the cent', () => {
    for (const nightly of [3_333, 9_999, 12_501, 14_900]) {
      for (const nights of [1, 2, 3, 7, 13]) {
        const plan = { ...basePlan, baseNightlyCents: nightly, weeklyRateCents: undefined };
        const price = computePrice({
          ratePlan: plan,
          checkIn: '2026-07-01',
          checkOut: addDays('2026-07-01', nights),
          addOns: [],
          taxRateBps: 500,
        });
        expect(price.totalCents).toBe(
          price.nightlySubtotalCents + price.addOnSubtotalCents - price.promoDiscountCents + price.gstCents,
        );
      }
    }
  });
});

describe('promo codes (pre-tax price reduction)', () => {
  it('percent promo discounts the pre-tax base; GST is charged on the discounted amount', () => {
    // $100/night × 2 = $200; 20% off = $40 off; GST 5% on $160 = $8; total $168.
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      addOns: [],
      taxRateBps: 500,
      promo: { kind: 'percent', valueBps: 2_000 },
    });
    expect(price.promoDiscountCents).toBe(4_000);
    expect(price.taxableSubtotalCents).toBe(16_000);
    expect(price.gstCents).toBe(800);
    expect(price.totalCents).toBe(16_800);
  });

  it('fixed promo caps at the eligible subtotal (never negative totals)', () => {
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [],
      taxRateBps: 500,
      promo: { kind: 'fixed', valueCents: 999_999 },
    });
    expect(price.promoDiscountCents).toBe(10_000);
    expect(price.taxableSubtotalCents).toBe(0);
    expect(price.gstCents).toBe(0);
    expect(price.totalCents).toBe(0);
  });

  it('fixed promo across mixed taxable/non-taxable items allocates proportionally', () => {
    // Night $100 (taxable) + non-taxable add-on $100 → subtotal $200, taxable $100.
    // $50 fixed promo → taxable share = 50 × (100/200) = $25 → taxable base $75.
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [{ name: 'Donation', unitPriceCents: 10_000, quantity: 1, taxable: false }],
      taxRateBps: 500,
      promo: { kind: 'fixed', valueCents: 5_000 },
    });
    expect(price.promoDiscountCents).toBe(5_000);
    expect(price.taxableSubtotalCents).toBe(7_500);
    expect(price.gstCents).toBe(375);
    expect(price.totalCents).toBe(20_000 - 5_000 + 375);
  });

  it('percent promo rounds to the cent on odd bases', () => {
    // $33.33 night, 15% (1500 bps) = 499.95¢ → 500¢.
    const plan = { ...basePlan, baseNightlyCents: 3_333 };
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [],
      taxRateBps: 500,
      promo: { kind: 'percent', valueBps: 1_500 },
    });
    expect(price.promoDiscountCents).toBe(500);
  });
});

describe('gift certificates (post-tax payment method)', () => {
  it('GST is charged on the FULL amount; the certificate pays down the total', () => {
    // $100/night × 2 = $200; GST $10 → invoice total $210. $50 gift cert →
    // net due $160. GST is NOT reduced by the certificate.
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      addOns: [],
      taxRateBps: 500,
      giftBalanceCents: 5_000,
    });
    expect(price.gstCents).toBe(1_000);
    expect(price.totalCents).toBe(21_000);
    expect(price.giftCertAppliedCents).toBe(5_000);
    expect(price.depositDueCents + price.balanceDueCents).toBe(16_000);
  });

  it('gift certificate caps at the invoice total', () => {
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [],
      taxRateBps: 500,
      giftBalanceCents: 999_999,
    });
    expect(price.totalCents).toBe(10_500);
    expect(price.giftCertAppliedCents).toBe(10_500);
    expect(price.depositDueCents).toBe(0);
    expect(price.balanceDueCents).toBe(0);
  });

  it('promo and gift certificate stack in the right order (promo pre-tax, cert post-tax)', () => {
    // $200 − 20% promo = $160; GST $8 → total $168; $100 cert → $68 due.
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      addOns: [],
      taxRateBps: 500,
      promo: { kind: 'percent', valueBps: 2_000 },
      giftBalanceCents: 10_000,
    });
    expect(price.totalCents).toBe(16_800);
    expect(price.giftCertAppliedCents).toBe(10_000);
    expect(price.depositDueCents + price.balanceDueCents).toBe(6_800);
  });
});

describe('weekly rate', () => {
  it('applies per full 7-night block when cheaper', () => {
    const plan = { ...basePlan, baseNightlyCents: 10_000, weeklyRateCents: 60_000 };
    // 10 nights: one weekly block (60k, cheaper than 70k) + 3 nightly (30k) = 90k
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-11',
      addOns: [],
      taxRateBps: 0,
    });
    expect(price.nightlySubtotalCents).toBe(90_000);
  });

  it('never charges more than nightly when weekly is worse', () => {
    const plan = { ...basePlan, baseNightlyCents: 5_000, weeklyRateCents: 60_000 };
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-08',
      addOns: [],
      taxRateBps: 0,
    });
    expect(price.nightlySubtotalCents).toBe(35_000);
  });
});

describe('deposits', () => {
  it('percent deposit rounds and balance adds back to total', () => {
    const plan = { ...basePlan, depositPolicy: { type: 'percent' as const, value: 50 } };
    const price = computePrice({
      ratePlan: { ...plan, baseNightlyCents: 3_333 },
      checkIn: '2026-07-01',
      checkOut: '2026-07-04',
      addOns: [],
      taxRateBps: 500,
    });
    expect(price.depositDueCents + price.balanceDueCents).toBe(price.totalCents);
    expect(price.depositDueCents).toBe(Math.round(price.totalCents / 2));
  });

  it('first_night deposit includes its GST and caps at total', () => {
    const plan = { ...basePlan, depositPolicy: { type: 'first_night' as const, value: 0 } };
    const price = computePrice({
      ratePlan: plan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      addOns: [],
      taxRateBps: 500,
    });
    expect(price.depositDueCents).toBe(10_500);
    expect(price.balanceDueCents).toBe(0);
  });
});

describe('cancellation refunds', () => {
  const policy = basePlan.cancellationPolicy;

  it('picks the correct window at each boundary', () => {
    expect(computeRefundCents(policy, 10_000, 10)).toBe(10_000); // >= 7 days
    expect(computeRefundCents(policy, 10_000, 7)).toBe(10_000); // boundary inclusive
    expect(computeRefundCents(policy, 10_000, 6)).toBe(5_000);
    expect(computeRefundCents(policy, 10_000, 2)).toBe(5_000); // boundary inclusive
    expect(computeRefundCents(policy, 10_000, 1)).toBe(0);
    expect(computeRefundCents(policy, 10_000, 0)).toBe(0);
  });

  it('handles unordered policy arrays', () => {
    const shuffled = [policy[2], policy[0], policy[1]];
    expect(computeRefundCents(shuffled, 10_000, 10)).toBe(10_000);
    expect(computeRefundCents(shuffled, 10_000, 3)).toBe(5_000);
  });

  it('returns 0 for an empty policy', () => {
    expect(computeRefundCents([], 10_000, 30)).toBe(0);
  });
});

describe('stay rules', () => {
  const tz = 'America/Edmonton';
  const future = (days: number) => {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return addDays(today, days);
  };

  it('rejects inverted and same-day-out ranges', () => {
    expect(() => validateStayRules(basePlan, future(5), future(5), tz)).toThrow();
    expect(() => validateStayRules(basePlan, future(5), future(3), tz)).toThrow();
  });

  it('enforces min stay including seasonal overrides', () => {
    const plan: RatePlanLike = {
      ...basePlan,
      minStayNights: 1,
      seasons: [
        { label: 'Peak', startDate: future(0), endDate: future(200), nightlyCents: 15_000, minStayNights: 3 },
      ],
    };
    expect(() => validateStayRules(plan, future(10), future(12), tz)).toThrow(/Minimum stay/);
    expect(() => validateStayRules(plan, future(10), future(13), tz)).not.toThrow();
  });

  it('enforces max stay, past dates, and the advance window', () => {
    expect(() => validateStayRules(basePlan, future(1), future(30), tz)).toThrow(/Maximum stay/);
    expect(() => validateStayRules(basePlan, addDays(future(0), -3), future(1), tz)).toThrow(/past/);
    expect(() => validateStayRules(basePlan, future(400), future(402), tz)).toThrow(/days before arrival/);
  });
});
