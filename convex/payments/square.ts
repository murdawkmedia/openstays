import type { CheckoutRequest, CheckoutSession, ParsedWebhookEvent, PaymentProvider } from './types';
import { sha256Hex, timingSafeEqual } from './stripe';

/**
 * Square via Payment Links (Online Checkout API) — raw REST, no SDK (the
 * official SDK is Node-bound; Convex default runtime wants fetch). Base URL by
 * SQUARE_ENV: sandbox → https://connect.squareupsandbox.com, production →
 * https://connect.squareup.com. Webhook verification: HMAC-SHA256 over
 * (notificationUrl + rawBody) with SQUARE_WEBHOOK_SIGNATURE_KEY, base64,
 * constant-time compare against the `x-square-hmacsha256-signature` header.
 *
 * Payment Links have NO short expiry — payment-after-hold-expiry is handled by
 * confirmFromPayment's re-acquire / payment_conflict path, never here.
 *
 * Implemented by builder B. Contract in ./types.ts is FIXED.
 *
 * CURRENCY SCOPE: CAD/USD/EUR only (all 2-decimal). Integer cents map 1:1 to
 * Square's amount_money.amount (minor units). Zero-decimal currencies are OUT
 * OF SCOPE.
 *
 * IMPORTANT checkoutId choice: we store the created payment link's related
 * ORDER id as checkoutId, because Square's `payment.updated` webhook references
 * `payment.order_id`, NOT the payment-link id. Joining on the link id would
 * orphan every payment.
 */

const SQUARE_VERSION = '2024-10-17';

function squareBaseUrl(): string {
  return process.env.SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

/** HMAC-SHA256 over `message` with `secret`, returned as base64 (Square style). */
export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  let binary = '';
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export const squareProvider: PaymentProvider = {
  name: 'square',
  isConfigured: () =>
    Boolean(
      process.env.SQUARE_ACCESS_TOKEN &&
        process.env.SQUARE_LOCATION_ID &&
        process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    ),

  createCheckout: async (req: CheckoutRequest): Promise<CheckoutSession> => {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!token || !locationId) throw new Error('Square not configured');

    // Deterministic idempotency key so a retried createCheckout for the same
    // booking+amount doesn't create two links/orders.
    const idempotencyKey = `os-${req.bookingId}-${req.amountCents}`.slice(0, 45);

    const res = await fetch(`${squareBaseUrl()}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        order: {
          location_id: locationId,
          line_items: [
            {
              name: req.description,
              quantity: '1',
              base_price_money: { amount: req.amountCents, currency: req.currency.toUpperCase() },
            },
          ],
        },
        checkout_options: {
          redirect_url: req.successUrl,
          ask_for_shipping_address: false,
        },
        pre_populated_data: { buyer_email: req.customerEmail },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Square createCheckout failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as {
      payment_link?: { url?: string; order_id?: string };
    };
    const url = data.payment_link?.url;
    const orderId = data.payment_link?.order_id;
    if (!url || !orderId) {
      throw new Error('Square createCheckout: missing url/order_id in response');
    }
    // checkoutId = order_id (what the payment webhook references), not link id.
    return { checkoutId: orderId, checkoutUrl: url };
  },

  verifyAndParseWebhook: async ({ body, headers, requestUrl }): Promise<ParsedWebhookEvent | null> => {
    const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!key) return null;
    const provided = headers['x-square-hmacsha256-signature'];
    if (!provided) return null;

    // Square signs the EXACT notification URL configured in the dashboard
    // concatenated with the raw body. Use requestUrl as passed.
    const expected = await hmacSha256Base64(key, requestUrl + body);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return null;
    }

    let event: {
      event_id?: string;
      type?: string;
      data?: { object?: { payment?: Record<string, unknown> } };
    };
    try {
      event = JSON.parse(body);
    } catch {
      return null;
    }
    // Square event id key is 'event_id'; fall back to 'id' just in case.
    const eventId = event.event_id ?? (event as { id?: string }).id;
    if (!eventId) return null;

    if (event.type === 'payment.updated') {
      const payment = event.data?.object?.payment ?? {};
      const status = payment.status as string | undefined;
      const amountMoney = payment.amount_money as { amount?: number; currency?: string } | undefined;
      if (status === 'COMPLETED') {
        return {
          eventId,
          kind: 'payment_succeeded',
          checkoutId: typeof payment.order_id === 'string' ? payment.order_id : undefined,
          providerPaymentId: typeof payment.id === 'string' ? payment.id : undefined,
          amountCents: typeof amountMoney?.amount === 'number' ? amountMoney.amount : undefined,
          currency:
            typeof amountMoney?.currency === 'string' ? amountMoney.currency.toUpperCase() : undefined,
        };
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        return {
          eventId,
          kind: 'payment_failed',
          checkoutId: typeof payment.order_id === 'string' ? payment.order_id : undefined,
        };
      }
      // APPROVED / PENDING and other in-flight states — acknowledge, no state change.
      return { eventId, kind: 'ignored' };
    }
    // Authentic but uninteresting event.
    return { eventId, kind: 'ignored' };
  },

  refund: async ({ providerPaymentId, amountCents, currency, reason }): Promise<{ providerRefundId: string }> => {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    if (!token) throw new Error('Square not configured');
    // Square idempotency keys cap at 45 chars. A naive
    // `os-refund-${paymentId}-${amount}`.slice(0,45) TRUNCATES the amount
    // discriminator away for long payment ids, so two refunds of DIFFERENT
    // amounts against the same payment would collide on one key and Square would
    // silently replay the first refund. Hash the discriminating tuple to a
    // fixed-width, collision-safe key instead. (Adversarial-review LOW.)
    const digest = await sha256Hex(`${providerPaymentId}:${amountCents}`);
    const idempotencyKey = `osrf-${digest.slice(0, 40)}`;
    const res = await fetch(`${squareBaseUrl()}/v2/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        payment_id: providerPaymentId,
        amount_money: { amount: amountCents, currency: currency.toUpperCase() },
        reason,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Prefix with the HTTP status so refundPayment can distinguish a 4xx
      // (permanent — dead-letter, no retry) from a 5xx (transient — retry).
      throw new Error(`HTTP ${res.status}: Square refund failed: ${detail}`);
    }
    const data = (await res.json()) as { refund?: { id?: string } };
    const id = data.refund?.id;
    if (!id) throw new Error('Square refund: missing refund.id in response');
    return { providerRefundId: id };
  },
};
