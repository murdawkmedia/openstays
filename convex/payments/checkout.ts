import { ConvexError, v } from 'convex/values';
import { action, query } from '../_generated/server';
import { internal } from '../_generated/api';
import { configuredProviders, getProvider } from './index';
import { checkoutPath } from '../../shared/bookingLinks';
import {
  PUBLIC_CONSENT_VERSION,
  eligibilityEmailDigest,
  readPublicPolicy,
  verifyEligibilityToken,
} from '../publicPolicy';

/**
 * What can this deployment charge with? The checkout UI renders one button
 * per entry. demoMode=true → the UI shows the simulated-payment path
 * (bookings.confirmSimulated) instead of real providers.
 */
export const availableProviders = query({
  args: {},
  handler: async () => {
    const policy = readPublicPolicy(process.env);
    return {
      demoMode: process.env.DEMO_MODE === 'true',
      simulatedEnabled: process.env.DEMO_MODE === 'true'
        || (policy.liveMode && policy.simulatedEnabled),
      providers: configuredProviders(),
    };
  },
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
    provider: v.union(v.literal('stripe'), v.literal('square'), v.literal('zaprite')),
    // Proof of ownership: the confirmation code the guest already holds. Without
    // it, a bare bookingId (enumerable via the cancel URL / a leak) would let an
    // attacker mint provider sessions against anyone else's hold — real
    // provider-cost abuse plus the victim's email prefilled on the hosted page.
    code: v.string(),
    consent: v.optional(v.object({
      version: v.string(),
      accepted: v.boolean(),
    })),
    eligibilityToken: v.optional(v.string()),
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
    // Ownership check: the supplied code must match this booking's confirmation
    // code. Fail with the same generic BOOKING_NOT_FOUND as a missing booking —
    // never reveal which part failed (no booking enumeration oracle).
    if (booking.confirmationCode !== args.code.trim().toUpperCase()) {
      throw new ConvexError({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });
    }
    if (booking.status !== 'hold') {
      throw new ConvexError({ code: 'NOT_A_HOLD', message: 'This booking is not a payable hold.' });
    }

    const policy = readPublicPolicy(process.env);
    let publicZaprite = false;
    if (args.provider === 'zaprite' && policy.liveMode) {
      if (!policy.zapriteEnabled) {
        throw new ConvexError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'Zaprite is not enabled for public contributions.',
        });
      }
      if (
        args.consent?.accepted !== true
        || args.consent.version !== PUBLIC_CONSENT_VERSION
      ) {
        throw new ConvexError({
          code: 'PUBLIC_PAYMENT_CONSENT_REQUIRED',
          message: 'Accept the fictional-booking disclosure before continuing.',
        });
      }
      const signingKey = process.env.ELIGIBILITY_HMAC_SECRET ?? '';
      if (!args.eligibilityToken || !signingKey || !data.guestNormalizedEmail) {
        throw new ConvexError({
          code: 'ELIGIBILITY_REQUIRED',
          message: 'Complete the payment eligibility check before continuing.',
        });
      }
      let eligibility;
      try {
        eligibility = await verifyEligibilityToken(
          args.eligibilityToken,
          { action: 'zaprite_payment', bookingId: String(booking._id) },
          signingKey,
          Date.now(),
        );
      } catch {
        throw new ConvexError({
          code: 'ELIGIBILITY_INVALID',
          message: 'The payment eligibility check expired or was invalid.',
        });
      }
      if (
        eligibility.emailDigest
        !== await eligibilityEmailDigest(data.guestNormalizedEmail, signingKey)
      ) {
        throw new ConvexError({
          code: 'ELIGIBILITY_INVALID',
          message: 'The payment eligibility check does not match this booking.',
        });
      }
      publicZaprite = true;
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
    const amountCents = publicZaprite
      ? policy.zapriteContributionCents
      : pb.depositDueCents > 0
        ? pb.depositDueCents
        : pb.totalCents - pb.giftCertAppliedCents;
    const currency = publicZaprite ? 'CAD' : property.currency;

    // 4. Build success/cancel URLs from SITE_URL. The cancel URL carries the
    //    confirmation code because the public CheckoutPage can only rehydrate a
    //    booking via byConfirmationCode — a bare /checkout/<id> would strand a
    //    guest who backs out of the provider page. (Checkout-UI stream addendum.)
    const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
    const successUrl = `${siteUrl}/confirmation/${booking.confirmationCode}`;
    const cancelUrl = `${siteUrl}${checkoutPath(booking._id, booking.confirmationCode)}`;

    // Best-effort: expire other live Stripe pending sessions for this booking
    // before creating a new one, so a guest who opens two tabs / backs out and
    // retries can't leave two payable Stripe sessions open (double-charge
    // mitigation). Errors are swallowed — this is only a mitigation; the
    // confirmFromPayment state machine (a second capture is recorded and
    // auto-refunded as 'duplicate_payment') is the actual guarantee. Square
    // links are already deduped by their deterministic idempotency key for the
    // same amount, and any cross-provider duplicate is caught by the same
    // duplicate_payment auto-refund, so we only sweep Stripe here.
    if (args.provider === 'stripe') {
      const stale = await ctx.runQuery(internal.bookings.getPendingCheckoutIds, {
        bookingId: booking._id,
        provider: 'stripe',
      });
      const secret = process.env.STRIPE_SECRET_KEY;
      if (secret) {
        for (const checkoutId of stale) {
          try {
            await fetch(`https://api.stripe.com/v1/checkout/sessions/${checkoutId}/expire`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${secret}` },
            });
          } catch {
            // Swallow — mitigation only.
          }
        }
      }
    }

    const session = await provider.createCheckout({
      bookingId: booking._id,
      confirmationCode: booking.confirmationCode,
      propertyName: property.name,
      description: publicZaprite
        ? `OpenStays project contribution — ${booking.confirmationCode}`
        : `${property.name} — booking ${booking.confirmationCode}`,
      amountCents,
      currency,
      customerEmail: guestEmail,
      successUrl,
      cancelUrl,
      expiresAtMs,
      consentVersion: publicZaprite ? PUBLIC_CONSENT_VERSION : undefined,
    });

    // 5. Record the pending payments row BEFORE returning, so the webhook always
    //    finds its row when the guest pays. Idempotent on the checkout id.
    await ctx.runMutation(internal.bookings.recordPendingPayment, {
      bookingId: booking._id,
      provider: args.provider,
      providerCheckoutId: session.checkoutId,
      amountCents,
      currency,
      providerReconciliationId: publicZaprite
        ? `openstays:${booking._id}:${expiresAtMs}`
        : undefined,
      providerCheckoutConfigId: publicZaprite
        ? process.env.ZAPRITE_CUSTOM_CHECKOUT_ID
        : undefined,
      providerExpiresAt: publicZaprite ? expiresAtMs : undefined,
      consentVersion: publicZaprite ? PUBLIC_CONSENT_VERSION : undefined,
      publicPaymentConsent: publicZaprite
        ? {
            version: PUBLIC_CONSENT_VERSION,
            acceptedAt: Date.now(),
            rail: 'zaprite' as const,
          }
        : undefined,
    });

    return { checkoutUrl: session.checkoutUrl };
  },
});
