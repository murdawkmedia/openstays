import type { PaymentProvider } from './types';

/**
 * Stripe via Checkout Sessions — raw fetch against the Stripe REST API (no SDK;
 * the Convex default runtime provides fetch + SubtleCrypto). Webhook signatures
 * are the `Stripe-Signature: t=...,v1=...` scheme: HMAC-SHA256 over
 * `${t}.${body}` with STRIPE_WEBHOOK_SECRET, constant-time compare, and a
 * 5-minute timestamp tolerance.
 *
 * Implemented by builder B. Contract in ./types.ts is FIXED.
 */
export const stripeProvider: PaymentProvider = {
  name: 'stripe',
  isConfigured: () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
  createCheckout: async () => {
    throw new Error('NOT_IMPLEMENTED: stripe.createCheckout (builder B)');
  },
  verifyAndParseWebhook: async () => {
    throw new Error('NOT_IMPLEMENTED: stripe.verifyAndParseWebhook (builder B)');
  },
  refund: async () => {
    throw new Error('NOT_IMPLEMENTED: stripe.refund (builder B)');
  },
};
