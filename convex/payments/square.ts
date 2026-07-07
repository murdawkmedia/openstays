import type { PaymentProvider } from './types';

/**
 * Square via Payment Links (Online Checkout API) — raw REST, no SDK (the
 * official SDK is Node-bound; Convex default runtime wants fetch). Base URL by
 * SQUARE_ENV: sandbox → https://connect.squareupsandbox.com, production →
 * https://connect.squareup.com. Webhook verification: HMAC-SHA256 over
 * (notificationUrl + rawBody) with SQUARE_WEBHOOK_SIGNATURE_KEY, base64,
 * constant-time compare against the `x-square-hmacsha256-signature` header.
 * Payment Links have no short expiry — payment-after-hold-expiry is handled
 * by confirmFromPayment's re-acquire / payment_conflict path, never here.
 *
 * Implemented by builder B. Contract in ./types.ts is FIXED.
 */
export const squareProvider: PaymentProvider = {
  name: 'square',
  isConfigured: () =>
    Boolean(
      process.env.SQUARE_ACCESS_TOKEN &&
        process.env.SQUARE_LOCATION_ID &&
        process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    ),
  createCheckout: async () => {
    throw new Error('NOT_IMPLEMENTED: square.createCheckout (builder B)');
  },
  verifyAndParseWebhook: async () => {
    throw new Error('NOT_IMPLEMENTED: square.verifyAndParseWebhook (builder B)');
  },
  refund: async () => {
    throw new Error('NOT_IMPLEMENTED: square.refund (builder B)');
  },
};
