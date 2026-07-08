import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { getProvider } from './index';

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
 *     internal.bookings.confirmFromPayment. That single serializable mutation
 *     handles idempotency, the paid flip with per-payment GST extraction, the
 *     hold→confirmed transition (or re-acquire / payment_conflict), promo
 *     application, and scheduling the confirmation email. On a
 *     'payment_conflict' outcome the refund + apology email were ALREADY
 *     scheduled INSIDE the mutation — handleWebhook stays thin.
 *  4. kind 'payment_failed' / 'checkout_expired' → runMutation
 *     internal.bookings.markCheckoutFailed (flips the pending row to 'failed';
 *     the booking stays 'hold' and the 2-min cron owns expiry).
 *  5. Always { status: 200 } for authentic events, even on 'duplicate' /
 *     'orphan' — providers retry non-2xx forever, and re-delivery is a no-op.
 */
export const handleWebhook = internalAction({
  args: {
    provider: v.union(v.literal('stripe'), v.literal('square')),
    body: v.string(),
    headers: v.record(v.string(), v.string()),
    requestUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const provider = getProvider(args.provider);
    const parsed = await provider.verifyAndParseWebhook({
      body: args.body,
      headers: args.headers,
      requestUrl: args.requestUrl,
    });

    // Bad signature → process NOTHING. 400 tells the provider to stop.
    if (parsed === null) return { status: 400 };

    if (parsed.kind === 'ignored') return { status: 200 };

    if (parsed.kind === 'payment_succeeded') {
      // A success event without the join key / amount can't be processed;
      // acknowledge so the provider stops retrying an event we can't use.
      if (!parsed.checkoutId || parsed.amountCents === undefined) {
        return { status: 200 };
      }
      await ctx.runMutation(internal.bookings.confirmFromPayment, {
        provider: args.provider,
        eventId: parsed.eventId,
        eventType: parsed.kind,
        checkoutId: parsed.checkoutId,
        providerPaymentId: parsed.providerPaymentId,
        amountCents: parsed.amountCents,
        currency: parsed.currency ?? '',
      });
      // The refund + apology email on a 'payment_conflict' outcome are scheduled
      // inside confirmFromPayment — nothing more to do here. Authentic → 200.
      return { status: 200 };
    }

    // payment_failed | checkout_expired.
    if (parsed.checkoutId) {
      await ctx.runMutation(internal.bookings.markCheckoutFailed, {
        provider: args.provider,
        eventId: parsed.eventId,
        eventType: parsed.kind,
        checkoutId: parsed.checkoutId,
      });
    }
    return { status: 200 };
  },
});

/**
 * Provider refund executor — called from confirmFromPayment's payment_conflict
 * path and from guest cancellation of provider-paid bookings. Loads the payment
 * (actions have no db → internal.bookings.getPayment), calls the provider
 * refund, then runMutation internal.bookings.recordRefund appends to refunds[]
 * and updates status. Retries: on transient provider failure, reschedule self
 * (attempt < 3, backoff 60s·attempt). After the final attempt, write an
 * emailLog 'refund_failed' alert row for staff via internal.email.writeLog.
 */
export const refundPayment = internalAction({
  args: {
    paymentId: v.id('payments'),
    amountCents: v.number(),
    reason: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const attempt = args.attempt ?? 1;
    const MAX_ATTEMPTS = 3;

    const payment = await ctx.runQuery(internal.bookings.getPayment, {
      paymentId: args.paymentId,
    });
    if (!payment) {
      // Nothing to refund against — the row vanished; give up quietly.
      return;
    }
    // Only stripe/square refund through a provider. simulated/manual/gift are
    // recorded inline by their own flows; nothing to call here.
    if (
      (payment.provider !== 'stripe' && payment.provider !== 'square') ||
      !payment.providerPaymentId
    ) {
      return;
    }
    // Already fully refunded (a retry raced a prior success) → idempotent stop.
    if (payment.status === 'refunded') return;

    const provider = getProvider(payment.provider);
    try {
      const { providerRefundId } = await provider.refund({
        providerPaymentId: payment.providerPaymentId,
        amountCents: args.amountCents,
        currency: payment.currency,
        reason: args.reason,
      });
      await ctx.runMutation(internal.bookings.recordRefund, {
        paymentId: args.paymentId,
        amountCents: args.amountCents,
        providerRefundId,
        reason: args.reason,
      });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        // Transient — back off linearly (60s, 120s) and retry.
        await ctx.scheduler.runAfter(attempt * 60_000, internal.payments.webhooks.refundPayment, {
          paymentId: args.paymentId,
          amountCents: args.amountCents,
          reason: args.reason,
          attempt: attempt + 1,
        });
        return;
      }
      // Out of retries — surface a staff alert so a human refunds manually.
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.email.writeLog, {
        propertyId: payment.propertyId,
        to: 'staff',
        templateKey: 'refund_failed',
        subject: `Refund failed for payment ${args.paymentId} (${args.amountCents}¢)`,
        bookingId: payment.bookingId ?? undefined,
        status: 'failed',
        error: message,
      });
    }
  },
});
