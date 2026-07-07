// Adversarial pricing review (see CLAUDE.md "Review policy"). Property-based
// sweeps over computePrice looking for a broken money identity, a GST that is
// wrong by more than the single-rounding tolerance, or a discount that goes
// out of bounds. Failing tests prove a defect; passing tests bound the error.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computePrice, computePromoDiscountCents, type RatePlanLike } from './pricing';

const basePlan: RatePlanLike = {
  baseNightlyCents: 10_000,
  seasons: [],
  minStayNights: 1,
  maxStayNights: 60,
  minLeadTimeHours: 0,
  maxAdvanceDays: 3650,
  prepBufferNights: 0,
  depositPolicy: { type: 'full', value: 0 },
  cancellationPolicy: [],
};

// ---------------------------------------------------------------------------
// COVERAGE: the load-bearing money identity totalCents = subtotals − promo + gst
// must hold for ANY mix of taxable/non-taxable add-ons and any promo. (Expected
// to hold — this is the invariant the whole ledger rests on.)
// ---------------------------------------------------------------------------
describe('money identity holds under adversarial inputs', () => {
  it('totalCents === nightly + addOns − promo + gst, always', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }), // taxable add-on cents
        fc.integer({ min: 0, max: 500_000 }), // non-taxable add-on cents
        fc.integer({ min: 1, max: 60 }), // nights count
        fc.oneof(
          fc.record({ kind: fc.constant('percent' as const), valueBps: fc.integer({ min: 0, max: 20_000 }) }),
          fc.record({ kind: fc.constant('fixed' as const), valueCents: fc.integer({ min: 0, max: 900_000 }) }),
        ),
        (taxCents, nonTaxCents, nights, promo) => {
          const checkOut = new Date(Date.UTC(2026, 6, 1 + nights)).toISOString().slice(0, 10);
          const price = computePrice({
            ratePlan: basePlan,
            checkIn: '2026-07-01',
            checkOut,
            addOns: [
              { name: 'T', unitPriceCents: taxCents, quantity: 1, taxable: true },
              { name: 'N', unitPriceCents: nonTaxCents, quantity: 1, taxable: false },
            ],
            taxRateBps: 500,
            promo,
          });
          expect(price.totalCents).toBe(
            price.nightlySubtotalCents +
              price.addOnSubtotalCents -
              price.promoDiscountCents +
              price.gstCents,
          );
          // Discount and total are never negative.
          expect(price.promoDiscountCents).toBeGreaterThanOrEqual(0);
          expect(price.totalCents).toBeGreaterThanOrEqual(0);
          // Deposit + balance reconstructs net-due (total − gift).
          expect(price.depositDueCents + price.balanceDueCents).toBe(
            price.totalCents - price.giftCertAppliedCents,
          );
        },
      ),
      { numRuns: 2_000 },
    );
  });

  // -------------------------------------------------------------------------
  // COVERAGE: GST charged must stay within half a cent of the ideal GST on the
  // proportionally-discounted taxable base (the single-rounding guarantee).
  // -------------------------------------------------------------------------
  it('gstCents stays within the single-rounding tolerance of the ideal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300_000 }),
        fc.integer({ min: 0, max: 300_000 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 900_000 }),
        (taxCents, nonTaxCents, nights, fixedPromo) => {
          const checkOut = new Date(Date.UTC(2026, 6, 1 + nights)).toISOString().slice(0, 10);
          const nightly = basePlan.baseNightlyCents * nights;
          const price = computePrice({
            ratePlan: basePlan,
            checkIn: '2026-07-01',
            checkOut,
            addOns: [
              { name: 'T', unitPriceCents: taxCents, quantity: 1, taxable: true },
              { name: 'N', unitPriceCents: nonTaxCents, quantity: 1, taxable: false },
            ],
            taxRateBps: 500,
            promo: { kind: 'fixed', valueCents: fixedPromo },
          });
          const subtotal = nightly + taxCents + nonTaxCents;
          const promo = price.promoDiscountCents;
          const preTaxable = nightly + taxCents;
          const idealTaxableBase = subtotal === 0 ? 0 : preTaxable * (1 - promo / subtotal);
          const idealGst = (idealTaxableBase * 500) / 10_000;
          // One rounding of the share + one rounding of GST ⇒ bounded ~1 cent.
          expect(Math.abs(price.gstCents - idealGst)).toBeLessThanOrEqual(1.0);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// COVERAGE: computePromoDiscountCents clamps out-of-range inputs (valueBps >
// 10000, negative valueCents) so a malformed promo doc can never invert a total.
// ---------------------------------------------------------------------------
describe('promo discount clamps hostile inputs', () => {
  it('valueBps > 10000 cannot discount more than 100%', () => {
    expect(computePromoDiscountCents({ kind: 'percent', valueBps: 99_999 }, 10_000)).toBe(10_000);
  });
  it('negative valueCents never adds money', () => {
    expect(computePromoDiscountCents({ kind: 'fixed', valueCents: -5_000 }, 10_000)).toBe(0);
  });
  it('negative valueBps floors at zero', () => {
    expect(computePromoDiscountCents({ kind: 'percent', valueBps: -2_000 }, 10_000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FINDING 9 (design NOTE): computePrice happily reports giftCertAppliedCents
// from a balance, but createHold never passes giftBalanceCents and no ledger is
// debited (M4). This test documents that the breakdown can PROMISE a gift-cert
// credit that nothing in the booking flow actually backs — a future foot-gun if
// a caller starts trusting the field before the ledger wiring lands.
// ---------------------------------------------------------------------------
describe('FINDING 9: gift-cert breakdown has no backing ledger (design note)', () => {
  it('reports a gift-cert credit with no corresponding debit anywhere', () => {
    const price = computePrice({
      ratePlan: basePlan,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      addOns: [],
      taxRateBps: 500,
      giftBalanceCents: 5_000,
    });
    // The breakdown credits $50 post-tax…
    expect(price.giftCertAppliedCents).toBe(5_000);
    // …and reduces the amount due by exactly that. Since createHold does not
    // pass giftBalanceCents today, this only bites if a caller wires the input
    // before the giftCertificates ledger debit exists. Documented, not a live
    // money loss in the current call graph.
    expect(price.depositDueCents + price.balanceDueCents).toBe(price.totalCents - 5_000);
  });
});
