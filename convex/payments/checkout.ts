import { ConvexError, v } from 'convex/values';
import { action, query } from '../_generated/server';
import { configuredProviders } from './index';

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
export const createCheckoutSession = action({
  args: {
    bookingId: v.id('bookings'),
    provider: v.union(v.literal('stripe'), v.literal('square')),
  },
  handler: async (): Promise<{ checkoutUrl: string }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder B
  },
});
