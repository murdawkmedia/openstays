import { v } from 'convex/values';
import { internalAction } from '../_generated/server';

/**
 * Webhook processing pipeline (M1, builder B; signatures FIXED — http.ts
 * routes are already wired to handleWebhook).
 *
 * handleWebhook:
 *  1. getProvider(provider).verifyAndParseWebhook({ body, headers, requestUrl })
 *     → null means bad signature → return { status: 400 }. NOTHING is
 *     processed on a bad signature.
 *  2. kind 'ignored' → { status: 200 } (acknowledged, no-op).
 *  3. kind 'payment_succeeded' → runMutation
 *     internal.bookings.confirmFromPayment { provider, eventId, checkoutId,
 *     providerPaymentId, amountCents, currency }. That mutation is the single
 *     serializable transaction that: checks-and-inserts webhookEvents
 *     (idempotency — duplicate eventId returns outcome 'duplicate' and writes
 *     nothing), flips the pending payments row to 'paid' with per-payment GST
 *     extraction round(amt×rate/(10000+rate)), confirms the hold (or
 *     re-acquires nights if the hold expired; if nights are gone → status
 *     'payment_conflict'), applies the promo redemption, and schedules the
 *     confirmation email (internal.email.sendBookingEmail).
 *     If outcome is 'payment_conflict' → schedule refundPayment (below) for
 *     the full captured amount + the apology email.
 *  4. kind 'payment_failed' / 'checkout_expired' → runMutation
 *     internal.bookings.markCheckoutFailed { provider, eventId, checkoutId }
 *     (flips pending payments row to 'failed'; booking stays 'hold' and the
 *     2-min cron owns expiry).
 *  5. Always { status: 200 } for authentic events, even on outcome
 *     'duplicate' — providers retry non-2xx forever.
 */
export const handleWebhook = internalAction({
  args: {
    provider: v.union(v.literal('stripe'), v.literal('square')),
    body: v.string(),
    headers: v.record(v.string(), v.string()),
    requestUrl: v.string(),
  },
  handler: async (): Promise<{ status: number }> => {
    // builder B — until implemented, acknowledge nothing.
    return { status: 501 };
  },
});

/**
 * Provider refund executor — called from confirmFromPayment's payment_conflict
 * path and from guest cancellation of provider-paid bookings. On provider
 * success, runMutation internal.bookings.recordRefund appends to the payments
 * row's refunds[] and updates its status (refunded / partially_refunded).
 * Retries: schedule self up to 3 times on transient provider failure, then
 * emailLog a 'refund_failed' alert for staff.
 */
export const refundPayment = internalAction({
  args: {
    paymentId: v.id('payments'),
    amountCents: v.number(),
    reason: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (): Promise<void> => {
    throw new Error('NOT_IMPLEMENTED: refundPayment (builder B)');
  },
});
