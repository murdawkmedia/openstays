import { v } from 'convex/values';
import { query } from './_generated/server';

/**
 * Public promo-code preview for the checkout "Discount code" field.
 * Checks the guest-visible conditions (exists, active, window, unit-type
 * scope) so the UI can re-render pricing live. Usage caps and once-per-guest
 * are deliberately NOT checked here — they depend on concurrent state and are
 * enforced authoritatively inside createHold's serializable transaction.
 */
export const preview = query({
  args: {
    propertyId: v.id('properties'),
    unitTypeId: v.id('unitTypes'),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedCode = args.code.trim().toUpperCase();
    if (normalizedCode === '') return { valid: false as const, reason: 'EMPTY' };
    const promo = await ctx.db
      .query('promoCodes')
      .withIndex('by_code', (q) =>
        q.eq('propertyId', args.propertyId).eq('normalizedCode', normalizedCode),
      )
      .first();
    const now = Date.now();
    if (!promo || !promo.active) return { valid: false as const, reason: 'INVALID' };
    if (
      (promo.startsAt !== undefined && now < promo.startsAt) ||
      (promo.endsAt !== undefined && now > promo.endsAt)
    ) {
      return { valid: false as const, reason: 'INACTIVE_WINDOW' };
    }
    if (promo.appliesToUnitTypes.length > 0 && !promo.appliesToUnitTypes.includes(args.unitTypeId)) {
      return { valid: false as const, reason: 'WRONG_UNIT_TYPE' };
    }
    return {
      valid: true as const,
      code: promo.code,
      kind: promo.kind,
      valueBps: promo.valueBps,
      valueCents: promo.valueCents,
      minSubtotalCents: promo.minSubtotalCents,
      description: promo.description,
    };
  },
});
