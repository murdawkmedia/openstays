import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  addDays,
  computePrice,
  computeRefundCents,
  daysBetween,
  enumerateNights,
  generateConfirmationCode,
  StayRuleError,
  validateStayRules,
} from '../shared/pricing';

/**
 * Hold TTL. NOT shorter: Stripe Checkout Sessions cannot expire sooner than
 * 30 minutes after creation, so a shorter hold would guarantee a window where
 * the hold is dead while the payment page is still live. The checkout action
 * (M1) refuses to create a session on a hold with < 31 minutes remaining.
 */
export const HOLD_TTL_MS = 35 * 60 * 1000;

/** Cap concurrent active holds per guest email (hold-spam guard). */
const MAX_ACTIVE_HOLDS_PER_EMAIL = 3;

const ACTIVE_KINDS = ['hold', 'confirmed', 'checked_in', 'external', 'blocked'] as const;

export const createHold = mutation({
  args: {
    unitId: v.id('units'),
    ratePlanId: v.id('ratePlans'),
    checkIn: v.string(),
    checkOut: v.string(),
    adults: v.number(),
    children: v.number(),
    guest: v.object({
      name: v.string(),
      email: v.string(),
      phone: v.string(),
      marketingOptIn: v.boolean(),
    }),
    addOns: v.array(v.object({ addOnId: v.id('addOns'), quantity: v.number() })),
    promoCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.status !== 'active') {
      throw new ConvexError({ code: 'UNIT_UNAVAILABLE', message: 'This unit is not bookable.' });
    }
    const property = await ctx.db.get(unit.propertyId);
    if (!property?.active) {
      throw new ConvexError({ code: 'UNIT_UNAVAILABLE', message: 'This property is not accepting bookings.' });
    }
    const ratePlan = await ctx.db.get(args.ratePlanId);
    if (!ratePlan || !ratePlan.active || ratePlan.unitTypeId !== unit.unitTypeId) {
      throw new ConvexError({ code: 'RATE_PLAN_INVALID', message: 'Rate plan does not match this unit.' });
    }
    if (unit.bookableFrom && args.checkIn < unit.bookableFrom) {
      throw new ConvexError({
        code: 'UNIT_NOT_YET_BOOKABLE',
        message: `This unit opens for stays on ${unit.bookableFrom}.`,
      });
    }

    // 1. Stay rules (dates sane, min/max stay, lead time, advance window).
    try {
      validateStayRules(ratePlan, args.checkIn, args.checkOut, property.timezone);
    } catch (error) {
      if (error instanceof StayRuleError) {
        throw new ConvexError({ code: error.code, message: error.message });
      }
      throw error;
    }

    // 2. CONFLICT CHECK — one indexed range read over occupied nights,
    //    covering the requested stay PLUS this booking's own prep tail.
    //    Serializable transaction semantics make this race-free: two
    //    concurrent createHold calls over overlapping nights serialize, and
    //    the loser sees the winner's unitNights rows.
    const blockedUntil = addDays(args.checkOut, ratePlan.prepBufferNights);
    const conflict = await ctx.db
      .query('unitNights')
      .withIndex('by_unit_date', (q) =>
        q.eq('unitId', args.unitId).gte('date', args.checkIn).lt('date', blockedUntil),
      )
      .first();
    if (conflict) {
      throw new ConvexError({ code: 'DATES_UNAVAILABLE', message: 'Those dates were just taken.' });
    }

    // 3. Guest upsert via index.
    const normalizedEmail = args.guest.email.trim().toLowerCase();
    const normalizedPhone = args.guest.phone.replace(/\D/g, '');
    if (!normalizedEmail.includes('@')) {
      throw new ConvexError({ code: 'GUEST_INVALID', message: 'A valid email is required.' });
    }
    const existingGuest = await ctx.db
      .query('guests')
      .withIndex('by_email', (q) =>
        q.eq('propertyId', unit.propertyId).eq('normalizedEmail', normalizedEmail),
      )
      .first();

    // Hold-spam guard: cap active holds per guest email.
    if (existingGuest) {
      const activeHolds = await ctx.db
        .query('bookings')
        .withIndex('by_guest', (q) => q.eq('guestId', existingGuest._id))
        .filter((q) => q.eq(q.field('status'), 'hold'))
        .collect();
      if (activeHolds.length >= MAX_ACTIVE_HOLDS_PER_EMAIL) {
        throw new ConvexError({
          code: 'TOO_MANY_HOLDS',
          message: 'Too many pending bookings for this email. Complete or let one expire first.',
        });
      }
    }
    const guestId =
      existingGuest?._id ??
      (await ctx.db.insert('guests', {
        propertyId: unit.propertyId,
        name: args.guest.name.trim(),
        email: args.guest.email.trim(),
        phone: args.guest.phone.trim(),
        normalizedEmail,
        normalizedPhone,
        marketingOptIn: args.guest.marketingOptIn,
        notes: [],
      }));

    // 4. Server-authoritative pricing (add-on prices come from the DB, never the client).
    const addOnLines = [];
    for (const line of args.addOns) {
      const addOn = await ctx.db.get(line.addOnId);
      if (!addOn || !addOn.active || addOn.propertyId !== unit.propertyId) {
        throw new ConvexError({ code: 'ADDON_INVALID', message: 'An add-on is unavailable.' });
      }
      if (addOn.appliesTo.length > 0 && !addOn.appliesTo.includes(unit.unitTypeId)) {
        throw new ConvexError({ code: 'ADDON_INVALID', message: `${addOn.name} is not available for this unit.` });
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
        throw new ConvexError({ code: 'ADDON_INVALID', message: 'Invalid add-on quantity.' });
      }
      addOnLines.push({
        addOn,
        quantity: line.quantity,
      });
    }
    const addOnPriceLines = addOnLines.map((l) => ({
      name: l.addOn.name,
      unitPriceCents: l.addOn.priceCents,
      quantity: l.quantity,
      taxable: l.addOn.taxable,
    }));

    // Promo validation (Shopify-style): existence, active, window, unit-type
    // scope, minimum spend, total-usage cap, once-per-guest. All checks and
    // the reservation below run in this same serializable transaction, so
    // caps stay accurate under concurrency.
    let promoDoc = null;
    if (args.promoCode !== undefined && args.promoCode.trim() !== '') {
      const normalizedCode = args.promoCode.trim().toUpperCase();
      promoDoc = await ctx.db
        .query('promoCodes')
        .withIndex('by_code', (q) =>
          q.eq('propertyId', unit.propertyId).eq('normalizedCode', normalizedCode),
        )
        .first();
      const now = Date.now();
      if (!promoDoc || !promoDoc.active) {
        throw new ConvexError({ code: 'PROMO_INVALID', message: 'That code is not valid.' });
      }
      if (
        (promoDoc.startsAt !== undefined && now < promoDoc.startsAt) ||
        (promoDoc.endsAt !== undefined && now > promoDoc.endsAt)
      ) {
        throw new ConvexError({ code: 'PROMO_INVALID', message: 'That code is not active right now.' });
      }
      if (promoDoc.appliesToUnitTypes.length > 0 && !promoDoc.appliesToUnitTypes.includes(unit.unitTypeId)) {
        throw new ConvexError({ code: 'PROMO_INVALID', message: 'That code does not apply to this unit.' });
      }
      if (promoDoc.maxRedemptions !== undefined && promoDoc.redemptionCount >= promoDoc.maxRedemptions) {
        throw new ConvexError({ code: 'PROMO_EXHAUSTED', message: 'That code has been fully redeemed.' });
      }
      if (promoDoc.oncePerGuest) {
        const prior = await ctx.db
          .query('promoRedemptions')
          .withIndex('by_promo_email', (q) =>
            q.eq('promoCodeId', promoDoc!._id).eq('normalizedEmail', normalizedEmail),
          )
          .collect();
        if (prior.some((r) => r.status !== 'released')) {
          throw new ConvexError({ code: 'PROMO_ALREADY_USED', message: 'That code was already used with this email.' });
        }
      }
      if (promoDoc.minSubtotalCents !== undefined) {
        const preview = computePrice({
          ratePlan,
          checkIn: args.checkIn,
          checkOut: args.checkOut,
          addOns: addOnPriceLines,
          taxRateBps: property.taxRateBps,
        });
        const subtotal = preview.nightlySubtotalCents + preview.addOnSubtotalCents;
        if (subtotal < promoDoc.minSubtotalCents) {
          throw new ConvexError({
            code: 'PROMO_MIN_SPEND',
            message: 'The booking subtotal is below the minimum for that code.',
          });
        }
      }
    }

    const price = computePrice({
      ratePlan,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      addOns: addOnPriceLines,
      taxRateBps: property.taxRateBps,
      promo: promoDoc
        ? { kind: promoDoc.kind, valueBps: promoDoc.valueBps, valueCents: promoDoc.valueCents }
        : undefined,
    });

    // 5. Insert booking + occupancy rows atomically (same transaction).
    const now = Date.now();
    const confirmationCode = generateConfirmationCode((max) => Math.floor(Math.random() * max));
    const bookingId = await ctx.db.insert('bookings', {
      propertyId: unit.propertyId,
      unitId: args.unitId,
      unitTypeId: unit.unitTypeId,
      guestId,
      ratePlanId: args.ratePlanId,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      nights: enumerateNights(args.checkIn, args.checkOut).length,
      adults: args.adults,
      children: args.children,
      status: 'hold',
      holdExpiresAt: now + HOLD_TTL_MS,
      source: 'online',
      confirmationCode,
      priceBreakdown: price,
      promoCodeId: promoDoc?._id,
      promoCodeSnapshot: promoDoc?.code,
      statusHistory: [{ status: 'hold', ts: now }],
      notes: [],
      createdAt: now,
      updatedAt: now,
    });
    if (promoDoc) {
      // Reserve the redemption; confirm flips it to 'applied', expiry/cancel
      // release it and give the usage slot back.
      await ctx.db.insert('promoRedemptions', {
        promoCodeId: promoDoc._id,
        bookingId,
        normalizedEmail,
        discountCents: price.promoDiscountCents,
        status: 'reserved',
        ts: now,
      });
      await ctx.db.patch(promoDoc._id, { redemptionCount: promoDoc.redemptionCount + 1 });
    }
    for (const date of enumerateNights(args.checkIn, blockedUntil)) {
      await ctx.db.insert('unitNights', {
        unitId: args.unitId,
        date,
        bookingId,
        kind: date < args.checkOut ? 'stay' : 'prep',
      });
    }
    for (const line of addOnLines) {
      await ctx.db.insert('bookingAddOns', {
        bookingId,
        addOnId: line.addOn._id,
        nameSnapshot: line.addOn.name,
        unitPriceCents: line.addOn.priceCents,
        quantity: line.quantity,
        taxable: line.addOn.taxable,
        soldAt: now,
      });
    }

    return {
      bookingId,
      confirmationCode,
      price,
      holdExpiresAt: now + HOLD_TTL_MS,
    };
  },
});

/** Release nights + restore side effects for a booking leaving an active state. */
async function releaseNights(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const nights = await ctx.db
    .query('unitNights')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const night of nights) await ctx.db.delete(night._id);
}

/** Flip a booking's reserved redemption to applied (payment confirmed). */
async function applyPromoRedemption(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const redemptions = await ctx.db
    .query('promoRedemptions')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const redemption of redemptions) {
    if (redemption.status === 'reserved') {
      await ctx.db.patch(redemption._id, { status: 'applied', ts: Date.now() });
    }
  }
}

/** Release a booking's promo redemption and give the usage slot back. */
async function releasePromoRedemption(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const redemptions = await ctx.db
    .query('promoRedemptions')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const redemption of redemptions) {
    if (redemption.status === 'released') continue;
    await ctx.db.patch(redemption._id, { status: 'released', ts: Date.now() });
    const promo = await ctx.db.get(redemption.promoCodeId);
    if (promo) {
      await ctx.db.patch(promo._id, { redemptionCount: Math.max(0, promo.redemptionCount - 1) });
    }
  }
}

export const expireHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('bookings')
      .withIndex('by_status_holdExpires', (q) => q.eq('status', 'hold').lt('holdExpiresAt', now))
      .take(50);
    for (const booking of stale) {
      await releaseNights(ctx, booking._id);
      await releasePromoRedemption(ctx, booking._id);
      await ctx.db.patch(booking._id, {
        status: 'expired',
        holdExpiresAt: undefined,
        statusHistory: [...booking.statusHistory, { status: 'expired', ts: now }],
        updatedAt: now,
      });
    }
    return { expired: stale.length };
  },
});

/**
 * DEMO/dev confirmation path: simulates a successful payment without a
 * provider. Enabled ONLY when the deployment sets DEMO_MODE=true (the public
 * demo) — production uses the provider webhook path (M1).
 */
export const confirmSimulated = mutation({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ConvexError({ code: 'DEMO_ONLY', message: 'Simulated payment is demo-only.' });
    }
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
    if (booking.status !== 'hold') {
      throw new ConvexError({ code: 'HOLD_NOT_ACTIVE', message: 'This booking is no longer holdable.' });
    }
    const now = Date.now();
    await ctx.db.insert('payments', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      provider: 'simulated',
      amountCents: booking.priceBreakdown?.depositDueCents ?? 0,
      gstCents: booking.priceBreakdown?.gstCents ?? 0,
      currency: 'CAD',
      status: 'paid',
      refunds: [],
      createdAt: now,
      paidAt: now,
    });
    await applyPromoRedemption(ctx, booking._id);
    await ctx.db.patch(booking._id, {
      status: 'confirmed',
      holdExpiresAt: undefined,
      statusHistory: [...booking.statusHistory, { status: 'confirmed', ts: now }],
      updatedAt: now,
    });
    return { confirmationCode: booking.confirmationCode };
  },
});

/** Guest-facing cancellation: code + email must match; policy decides refund. */
export const cancelByGuest = mutation({
  args: {
    confirmationCode: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query('bookings')
      .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', args.confirmationCode.trim().toUpperCase()))
      .first();
    if (!booking || !booking.guestId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    const guest = await ctx.db.get(booking.guestId);
    if (!guest || guest.normalizedEmail !== args.email.trim().toLowerCase()) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status !== 'confirmed' && booking.status !== 'hold') {
      throw new ConvexError({ code: 'NOT_CANCELLABLE', message: `Booking is ${booking.status}.` });
    }

    const property = (await ctx.db.get(booking.propertyId))!;
    const ratePlan = booking.ratePlanId ? await ctx.db.get(booking.ratePlanId) : null;
    const paidPayments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .filter((q) => q.eq(q.field('status'), 'paid'))
      .collect();
    const paidCents = paidPayments.reduce((sum, p) => sum + p.amountCents, 0);

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: property.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const refundCents = ratePlan
      ? computeRefundCents(ratePlan.cancellationPolicy, paidCents, daysBetween(today, booking.checkIn))
      : 0;

    const now = Date.now();
    await releaseNights(ctx, booking._id);
    await releasePromoRedemption(ctx, booking._id);
    await ctx.db.patch(booking._id, {
      status: 'cancelled',
      holdExpiresAt: undefined,
      statusHistory: [...booking.statusHistory, { status: 'cancelled', ts: now }],
      updatedAt: now,
    });

    // Refund execution against real providers lands in M1 (scheduled action).
    // For simulated/demo payments, record the refund inline.
    for (const payment of paidPayments) {
      if (payment.provider === 'simulated' && refundCents > 0) {
        await ctx.db.patch(payment._id, {
          status: refundCents >= payment.amountCents ? 'refunded' : 'partially_refunded',
          refunds: [
            ...payment.refunds,
            { amountCents: Math.min(refundCents, payment.amountCents), reason: 'guest_cancellation', ts: now, by: 'guest' },
          ],
        });
      }
    }

    return { refundCents, paidCents };
  },
});

/** Reactive booking lookup for the confirmation page (never trust the redirect). */
export const byConfirmationCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query('bookings')
      .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', args.code.trim().toUpperCase()))
      .first();
    if (!booking) return null;
    const unit = await ctx.db.get(booking.unitId);
    const unitType = await ctx.db.get(booking.unitTypeId);
    const addOns = await ctx.db
      .query('bookingAddOns')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .collect();
    return {
      status: booking.status,
      confirmationCode: booking.confirmationCode,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      adults: booking.adults,
      children: booking.children,
      holdExpiresAt: booking.holdExpiresAt,
      priceBreakdown: booking.priceBreakdown,
      promoCode: booking.promoCodeSnapshot,
      unitName: unit?.name ?? '',
      unitTypeName: unitType?.name ?? '',
      addOns: addOns.map((a) => ({
        name: a.nameSnapshot,
        quantity: a.quantity,
        unitPriceCents: a.unitPriceCents,
      })),
    };
  },
});

/** Admin: repair unitNights from bookings if the invariant ever drifts. */
export const repairUnitNights = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allNights = await ctx.db.query('unitNights').collect();
    for (const night of allNights) await ctx.db.delete(night._id);

    let rebuilt = 0;
    const bookings = await ctx.db.query('bookings').collect();
    for (const booking of bookings) {
      if (!(ACTIVE_KINDS as readonly string[]).includes(booking.status)) continue;
      const ratePlan = booking.ratePlanId ? await ctx.db.get(booking.ratePlanId) : null;
      const prep = ratePlan?.prepBufferNights ?? 0;
      const blockedUntil = addDays(booking.checkOut, prep);
      for (const date of enumerateNights(booking.checkIn, blockedUntil)) {
        await ctx.db.insert('unitNights', {
          unitId: booking.unitId,
          date,
          bookingId: booking._id,
          kind:
            booking.status === 'external'
              ? 'external'
              : booking.status === 'blocked'
                ? 'block'
                : date < booking.checkOut
                  ? 'stay'
                  : 'prep',
        });
        rebuilt += 1;
      }
    }
    return { rebuilt };
  },
});

export type BookingDoc = Doc<'bookings'>;
