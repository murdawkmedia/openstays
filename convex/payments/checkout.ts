import { ConvexError, v } from 'convex/values';
import { action, query } from '../_generated/server';
import { internal } from '../_generated/api';
import { configuredProviders, getProvider } from './index';

/**
 * What can this deployment charge with? The checkout UI renders one button
 * per entry. demoMode=true → the UI shows the simulated-payment path
 * (bookings.confirmSimulated) instead of real providers.
 */
export const availableProviders = query({
  args: {},
  handler: async () => ({
    demoMode: process.env.DEMO_MODE === 'true',
    providers: configuredProviders(),
  }),
});

/**
 * createCheckoutSession (public action) — the M1 hold→pay bridge.
 *
 * Contract (implemented by builder B; signature FIXED — the checkout UI codes
 * against this):
 *  1. runQuery internal.bookings.getForCheckout — booking must be status
 *     'hold'. Throws ConvexError codes: 'BOOKING_NOT_FOUND', 'NOT_A_HOLD'.
 *  2. Refuse stale holds: if holdExpiresAt − now < 31 minutes → ConvexError
 *     'HOLD_TOO_STALE' (Stripe's minimum expires_at is 30 min; binding rule
 *     #5 in CLAUDE.md — do NOT relax).
 *  3. Amount = priceBreakdown.depositDueCents when > 0 else totalCents −
 *     giftCertAppliedCents. Currency from the property.
 *  4. provider.createCheckout(...) with success/cancel URLs built from the
 *     SITE_URL env var: success → /confirmation/<code>, cancel →
 *     /checkout/<bookingId>.
 *  5. runMutation internal.bookings.recordPendingPayment — inserts the
 *     payments row {provider, providerCheckoutId, amountCents, status:
 *     'pending'} BEFORE returning, so the webhook always finds its row.
 *  6. Returns { checkoutUrl }.
 *
 * Throws 'PROVIDER_NOT_CONFIGURED' when the deployment lacks that provider's
 * env vars. DEMO_MODE deployments use bookings.confirmSimulated instead — the
 * demo UI never calls this.
 */
/** Refuse to create a payment session on a hold with < 31 minutes left. */
const MIN_REMAINING_MS = 31 * 60 * 1000;

export const createCheckoutSession = action({
  args: {
    bookingId: v.id('bookings'),
    provider: v.union(v.literal('stripe'), v.literal('square')),
  },
  handler: async (ctx, args): Promise<{ checkoutUrl: string }> => {
    // 0. Provider must be configured for this deployment.
    const provider = getProvider(args.provider);
    if (!provider.isConfigured()) {
      throw new ConvexError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `Payment provider '${args.provider}' is not configured for this deployment.`,
      });
    }

    // 1. Load the booking + property + guest email.
    const data = await ctx.runQuery(internal.bookings.getForCheckout, {
      bookingId: args.bookingId,
    });
    if (!data || !data.property || !data.guestEmail) {
      throw new ConvexError({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });
    }
    const { booking, property, guestEmail } = data;
    if (booking.status !== 'hold') {
      throw new ConvexError({ code: 'NOT_A_HOLD', message: 'This booking is not a payable hold.' });
    }

    // 2. Refuse stale holds (binding rule #5: Stripe's min expires_at is 30 min).
    const expiresAtMs = booking.holdExpiresAt ?? 0;
    if (expiresAtMs - Date.now() < MIN_REMAINING_MS) {
      throw new ConvexError({
        code: 'HOLD_TOO_STALE',
        message: 'This hold is too close to expiry to start a payment. Please re-book.',
      });
    }

    // 3. Amount = deposit when > 0, else the net total (total − gift cert).
    const pb = booking.priceBreakdown;
    if (!pb) {
      throw new ConvexError({ code: 'BOOKING_NOT_FOUND', message: 'Booking has no price.' });
    }
    const amountCents =
      pb.depositDueCents > 0 ? pb.depositDueCents : pb.totalCents - pb.giftCertAppliedCents;

    // 4. Build success/cancel URLs from SITE_URL. The cancel URL carries the
    //    confirmation code because the public CheckoutPage can only rehydrate a
    //    booking via byConfirmationCode — a bare /checkout/<id> would strand a
    //    guest who backs out of the provider page. (Checkout-UI stream addendum.)
    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const successUrl = `${siteUrl}/confirmation/${booking.confirmationCode}`;
    const cancelUrl = `${siteUrl}/checkout/${booking._id}?code=${booking.confirmationCode}`;

    const session = await provider.createCheckout({
      bookingId: booking._id,
      confirmationCode: booking.confirmationCode,
      propertyName: property.name,
      description: `${property.name} — booking ${booking.confirmationCode}`,
      amountCents,
      currency: property.currency,
      customerEmail: guestEmail,
      successUrl,
      cancelUrl,
      expiresAtMs,
    });

    // 5. Record the pending payments row BEFORE returning, so the webhook always
    //    finds its row when the guest pays. Idempotent on the checkout id.
    await ctx.runMutation(internal.bookings.recordPendingPayment, {
      bookingId: booking._id,
      provider: args.provider,
      providerCheckoutId: session.checkoutId,
      amountCents,
      currency: property.currency,
    });

    return { checkoutUrl: session.checkoutUrl };
  },
});
