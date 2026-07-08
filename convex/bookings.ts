import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
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

/**
 * Release a booking's promo redemption and give the usage slot back —
 * but ONLY for redemptions still in 'reserved' (unconsumed holds that
 * expired or were abandoned). An 'applied' redemption was consumed by a
 * confirmed booking and stays consumed forever, even if that booking is
 * later cancelled: otherwise a guest could loop book→cancel to re-redeem a
 * once-per-guest code indefinitely, and capped codes would over-discount
 * past their cap. (Adversarial review findings 2 & 3.)
 */
async function releasePromoRedemption(ctx: MutationCtx, bookingId: Id<'bookings'>): Promise<void> {
  const redemptions = await ctx.db
    .query('promoRedemptions')
    .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
    .collect();
  for (const redemption of redemptions) {
    if (redemption.status !== 'reserved') continue; // applied = consumed; released = already handled
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
    const property = await ctx.db.get(booking.propertyId);
    const taxRateBps = property?.taxRateBps ?? 0;
    const amountCents = booking.priceBreakdown?.depositDueCents ?? 0;
    await ctx.db.insert('payments', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      provider: 'simulated',
      amountCents,
      // GST contained in THIS payment (tax-inclusive extraction) — never the
      // invoice's full GST, or partial-deposit payments overstate remittance.
      // (Adversarial review finding 1.)
      gstCents: Math.round((amountCents * taxRateBps) / (10_000 + taxRateBps)),
      currency: property?.currency ?? 'CAD',
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
    // Demo parity with the real provider path: schedule the confirmation email.
    // In DEMO_MODE (the only mode that reaches here) builder E's module logs
    // instead of sending, so this is a no-op-visible-in-emailLog on the demo.
    await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
      bookingId: booking._id,
      kind: 'confirmation',
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

    // Refund execution. Real providers (stripe/square) refund out-of-band via a
    // scheduled action (actions can call the provider over the network; a
    // mutation cannot). Simulated/manual payments have no external ledger, so we
    // record the refund inline here. The policy allocates the total refundCents
    // across the paid rows in order until exhausted (partial-deposit bookings
    // may have multiple 'paid' rows).
    let remainingRefund = refundCents;
    for (const payment of paidPayments) {
      if (remainingRefund <= 0) break;
      const thisRefund = Math.min(remainingRefund, payment.amountCents);
      if (thisRefund <= 0) continue;
      if (payment.provider === 'stripe' || payment.provider === 'square') {
        // Provider refund runs in a scheduled action; recordRefund writes the
        // refunds[] row + status only after the provider confirms.
        await ctx.scheduler.runAfter(0, internal.payments.webhooks.refundPayment, {
          paymentId: payment._id,
          amountCents: thisRefund,
          reason: 'guest_cancellation',
        });
      } else if (payment.provider === 'simulated' || payment.provider === 'manual') {
        await ctx.db.patch(payment._id, {
          status: thisRefund >= payment.amountCents ? 'refunded' : 'partially_refunded',
          refunds: [
            ...payment.refunds,
            { amountCents: thisRefund, reason: 'guest_cancellation', ts: now, by: 'guest' },
          ],
        });
      }
      remainingRefund -= thisRefund;
    }

    // Notify the guest their booking was cancelled (E's module; logs in DEMO).
    await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
      bookingId: booking._id,
      kind: 'cancellation',
    });

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
    const property = await ctx.db.get(booking.propertyId);
    const addOns = await ctx.db
      .query('bookingAddOns')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .collect();
    return {
      currency: property?.currency ?? 'CAD',
      taxLabel: property?.taxLabel,
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

// ===========================================================================
// M1 PAYMENTS BRIDGE (builder B). Internal functions the payment provider
// contracts (convex/payments/**) call to move real money through the same
// serializable-mutation booking machinery createHold/confirmSimulated use.
//
// Money-integrity invariants enforced here (adversarial-review critical):
// - A payment row's gstCents is the tax CONTAINED IN THAT PAYMENT (tax-inclusive
//   extraction round(amt·rate/(10000+rate))), NEVER the invoice's full GST —
//   partial deposits would otherwise over-report remittance.
// - The webhookEvents check-and-insert runs in the SAME mutation as the state
//   change, so a provider's at-least-once retries never double-confirm,
//   double-charge, or double-email.
// - confirmFromPayment re-guards on booking status: a hold whose nights were
//   re-taken after expiry can never produce two confirmed bookings on the same
//   nights — it becomes 'payment_conflict' and the capture is refunded.
// ===========================================================================

/**
 * Booking snapshot the checkout action needs to build a provider session.
 * Returns null when the booking is missing so the action can throw a clean
 * 'BOOKING_NOT_FOUND'. Currency/taxLabel/propertyName come off the property;
 * the guest email is required for the hosted payment page + receipt.
 */
export const getForCheckout = internalQuery({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    const property = await ctx.db.get(booking.propertyId);
    const guest = booking.guestId ? await ctx.db.get(booking.guestId) : null;
    return {
      booking: {
        _id: booking._id,
        status: booking.status,
        holdExpiresAt: booking.holdExpiresAt,
        confirmationCode: booking.confirmationCode,
        priceBreakdown: booking.priceBreakdown,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
      },
      property: property
        ? {
            name: property.name,
            currency: property.currency,
            taxLabel: property.taxLabel,
          }
        : null,
      guestEmail: guest?.email ?? null,
    };
  },
});

/** Load a payment row for the refund action (actions have no db access). */
export const getPayment = internalQuery({
  args: { paymentId: v.id('payments') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentId);
  },
});

/**
 * Insert (or return the existing) pending payments row for a checkout attempt.
 * Idempotent per (booking, provider, providerCheckoutId): a guest who reloads
 * the checkout page and re-creates the same provider session must not spawn a
 * second pending row (the webhook joins on the checkout id and must find one).
 */
export const recordPendingPayment = internalMutation({
  args: {
    bookingId: v.id('bookings'),
    provider: v.union(v.literal('stripe'), v.literal('square')),
    providerCheckoutId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'payments'>> => {
    const existing = await ctx.db
      .query('payments')
      .withIndex('by_provider_checkout', (q) =>
        q.eq('provider', args.provider).eq('providerCheckoutId', args.providerCheckoutId),
      )
      .filter((q) => q.eq(q.field('bookingId'), args.bookingId))
      .first();
    if (existing) return existing._id;

    const booking = await ctx.db.get(args.bookingId);
    if (!booking) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    return await ctx.db.insert('payments', {
      propertyId: booking.propertyId,
      bookingId: args.bookingId,
      provider: args.provider,
      providerCheckoutId: args.providerCheckoutId,
      amountCents: args.amountCents,
      gstCents: 0, // filled on confirm (tax-inclusive extraction of the captured amount)
      currency: args.currency,
      status: 'pending',
      refunds: [],
      createdAt: Date.now(),
    });
  },
});

/**
 * THE money transaction: a provider 'payment_succeeded' webhook lands here.
 * One serializable mutation does everything or nothing:
 *   (a) webhookEvents check-and-insert on (provider, eventId) — a duplicate
 *       delivery writes nothing and returns 'duplicate';
 *   (b) join the pending payments row via by_provider_checkout — missing row =
 *       'orphan' (still records the webhookEvent so retries stay idempotent);
 *   (c) flip the payment to 'paid' with per-payment GST extraction;
 *   (d) transition the booking:
 *         hold                 → confirmed (+ apply promo, clear hold)
 *         expired | cancelled  → re-acquire the nights (same conflict check as
 *                                createHold); free → confirmed + fresh
 *                                unitNights + fresh applied redemption; taken →
 *                                'payment_conflict' + schedule full refund +
 *                                apology email
 *         confirmed            → 'duplicate' (a second provider event)
 *   (e) plain-confirm success schedules the confirmation email.
 */
export const confirmFromPayment = internalMutation({
  args: {
    provider: v.union(v.literal('stripe'), v.literal('square')),
    eventId: v.string(),
    eventType: v.string(),
    checkoutId: v.string(),
    providerPaymentId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ outcome: 'confirmed' | 'payment_conflict' | 'duplicate' | 'orphan' }> => {
    const now = Date.now();

    // (a) Idempotency: check-and-insert the webhookEvents row FIRST. A duplicate
    //     delivery of the same provider event id writes nothing else and bails.
    const priorEvent = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_event', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId),
      )
      .first();
    if (priorEvent) return { outcome: 'duplicate' };

    // (b) Join the pending payments row by (provider, checkoutId).
    const payment = await ctx.db
      .query('payments')
      .withIndex('by_provider_checkout', (q) =>
        q.eq('provider', args.provider).eq('providerCheckoutId', args.checkoutId),
      )
      .first();
    if (!payment || !payment.bookingId) {
      // Record the event so retries of this orphan are also idempotent no-ops.
      await ctx.db.insert('webhookEvents', {
        provider: args.provider,
        eventId: args.eventId,
        type: args.eventType,
        processedAt: now,
      });
      return { outcome: 'orphan' };
    }

    const booking = await ctx.db.get(payment.bookingId);
    if (!booking) {
      await ctx.db.insert('webhookEvents', {
        provider: args.provider,
        eventId: args.eventId,
        type: args.eventType,
        processedAt: now,
      });
      return { outcome: 'orphan' };
    }

    // A second authentic provider event for an already-confirmed booking (e.g.
    // Stripe + a redundant payment_intent event): the money is already booked.
    if (booking.status === 'confirmed' || booking.status === 'checked_in' || booking.status === 'checked_out') {
      await ctx.db.insert('webhookEvents', {
        provider: args.provider,
        eventId: args.eventId,
        type: args.eventType,
        bookingId: booking._id,
        processedAt: now,
      });
      return { outcome: 'duplicate' };
    }

    // (c) Flip the payment to 'paid'. gstCents = tax CONTAINED IN THIS PAYMENT
    //     (tax-inclusive extraction), never the invoice's full GST — the exact
    //     adversarial-review invariant confirmSimulated already honours.
    const property = await ctx.db.get(booking.propertyId);
    const taxRateBps = property?.taxRateBps ?? 0;
    const gstCents = Math.round((args.amountCents * taxRateBps) / (10_000 + taxRateBps));
    await ctx.db.patch(payment._id, {
      status: 'paid',
      paidAt: now,
      gstCents,
      providerPaymentId: args.providerPaymentId,
      // Trust the invoice amount recorded at checkout; the captured amount is
      // asserted equal by the provider parse. currency stays as recorded.
    });

    // Record the idempotency ledger row now that we've committed to processing.
    await ctx.db.insert('webhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      type: args.eventType,
      bookingId: booking._id,
      processedAt: now,
    });

    // (d) Booking transition.
    if (booking.status === 'hold') {
      // Happy path: the hold is still live. Confirm, consume the promo, clear
      // the hold timer. unitNights already exist from createHold.
      await applyPromoRedemption(ctx, booking._id);
      await ctx.db.patch(booking._id, {
        status: 'confirmed',
        holdExpiresAt: undefined,
        statusHistory: [...booking.statusHistory, { status: 'confirmed', ts: now }],
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
        bookingId: booking._id,
        kind: 'confirmation',
      });
      return { outcome: 'confirmed' };
    }

    if (booking.status === 'expired' || booking.status === 'cancelled') {
      // The hold expired (or was cancelled) BEFORE the payment landed — its
      // nights and promo reservation were already released. The guest paid the
      // discounted price, so try to RE-ACQUIRE the same nights + prep tail with
      // the identical conflict check createHold uses.
      const ratePlan = booking.ratePlanId ? await ctx.db.get(booking.ratePlanId) : null;
      const prepBufferNights = ratePlan?.prepBufferNights ?? 0;
      const blockedUntil = addDays(booking.checkOut, prepBufferNights);
      const conflict = await ctx.db
        .query('unitNights')
        .withIndex('by_unit_date', (q) =>
          q.eq('unitId', booking.unitId).gte('date', booking.checkIn).lt('date', blockedUntil),
        )
        .first();

      if (conflict) {
        // Nights are gone. We captured money we can't honour with a room →
        // payment_conflict, refund the FULL captured amount, apologise. NO
        // unitNights are written (we don't own the nights).
        await ctx.db.patch(booking._id, {
          status: 'payment_conflict',
          holdExpiresAt: undefined,
          statusHistory: [...booking.statusHistory, { status: 'payment_conflict', ts: now }],
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.payments.webhooks.refundPayment, {
          paymentId: payment._id,
          amountCents: args.amountCents,
          reason: 'payment_after_expiry',
        });
        await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
          bookingId: booking._id,
          kind: 'payment_conflict',
        });
        return { outcome: 'payment_conflict' };
      }

      // Nights are free — re-take them. Re-insert unitNights (stay + prep) and
      // confirm. The reserved promo redemption was RELEASED at expiry, so we
      // insert a FRESH 'applied' redemption and bump redemptionCount even if the
      // cap is now exceeded: the guest already paid the discounted price, so
      // money integrity wins over the (marketing) cap. This is deliberate.
      for (const date of enumerateNights(booking.checkIn, blockedUntil)) {
        await ctx.db.insert('unitNights', {
          unitId: booking.unitId,
          date,
          bookingId: booking._id,
          kind: date < booking.checkOut ? 'stay' : 'prep',
        });
      }
      if (booking.promoCodeId) {
        const normalizedEmail = booking.guestId
          ? (await ctx.db.get(booking.guestId))?.normalizedEmail ?? ''
          : '';
        await ctx.db.insert('promoRedemptions', {
          promoCodeId: booking.promoCodeId,
          bookingId: booking._id,
          normalizedEmail,
          discountCents: booking.priceBreakdown?.promoDiscountCents ?? 0,
          status: 'applied',
          ts: now,
        });
        const promo = await ctx.db.get(booking.promoCodeId);
        if (promo) {
          await ctx.db.patch(promo._id, { redemptionCount: promo.redemptionCount + 1 });
        }
      }
      await ctx.db.patch(booking._id, {
        status: 'confirmed',
        holdExpiresAt: undefined,
        statusHistory: [...booking.statusHistory, { status: 'confirmed', ts: now }],
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
        bookingId: booking._id,
        kind: 'confirmation',
      });
      return { outcome: 'confirmed' };
    }

    // Any other status (payment_conflict already, external, blocked, no_show):
    // the payment is already captured ('paid' above) but we can't seat the
    // guest. Force a refund + apology. Booking status is left as-is (we don't
    // own or want to reshape a maintenance block or an external booking).
    await ctx.scheduler.runAfter(0, internal.payments.webhooks.refundPayment, {
      paymentId: payment._id,
      amountCents: args.amountCents,
      reason: 'payment_after_expiry',
    });
    await ctx.scheduler.runAfter(0, internal.email.sendBookingEmail, {
      bookingId: booking._id,
      kind: 'payment_conflict',
    });
    return { outcome: 'payment_conflict' };
  },
});

/**
 * Provider reported the checkout failed or expired. Idempotent on
 * (provider, eventId); flips the pending payments row to 'failed' (only while
 * still pending). The booking stays 'hold' — the 2-minute expiry cron owns
 * hold lifecycle, so a failed one-off attempt doesn't kill a hold the guest may
 * still complete via a retry.
 */
export const markCheckoutFailed = internalMutation({
  args: {
    provider: v.union(v.literal('stripe'), v.literal('square')),
    eventId: v.string(),
    eventType: v.optional(v.string()),
    checkoutId: v.string(),
  },
  handler: async (ctx, args): Promise<{ outcome: 'failed' | 'duplicate' | 'orphan' }> => {
    const now = Date.now();
    const priorEvent = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_event', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId),
      )
      .first();
    if (priorEvent) return { outcome: 'duplicate' };

    await ctx.db.insert('webhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      type: args.eventType ?? 'checkout_failed',
      processedAt: now,
    });

    const payment = await ctx.db
      .query('payments')
      .withIndex('by_provider_checkout', (q) =>
        q.eq('provider', args.provider).eq('providerCheckoutId', args.checkoutId),
      )
      .first();
    if (!payment) return { outcome: 'orphan' };
    if (payment.status === 'pending') {
      await ctx.db.patch(payment._id, { status: 'failed' });
    }
    return { outcome: 'failed' };
  },
});

/**
 * Record a provider refund on a payments row: append to refunds[] and set the
 * row's status to 'refunded' (cumulative refunds ≥ amount) or
 * 'partially_refunded'. Called by the refundPayment action after the provider
 * confirms the refund.
 */
export const recordRefund = internalMutation({
  args: {
    paymentId: v.id('payments'),
    amountCents: v.number(),
    providerRefundId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Payment not found.' });
    }
    const now = Date.now();
    const refunds = [
      ...payment.refunds,
      {
        amountCents: args.amountCents,
        providerRefundId: args.providerRefundId,
        reason: args.reason,
        ts: now,
        by: 'system',
      },
    ];
    const totalRefunded = refunds.reduce((sum, r) => sum + r.amountCents, 0);
    await ctx.db.patch(args.paymentId, {
      refunds,
      status: totalRefunded >= payment.amountCents ? 'refunded' : 'partially_refunded',
    });
  },
});

export type BookingDoc = Doc<'bookings'>;
