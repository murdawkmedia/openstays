import type { CheckoutRequest, CheckoutSession, ParsedWebhookEvent, PaymentProvider } from './types';

/**
 * Stripe via Checkout Sessions — raw fetch against the Stripe REST API (no SDK;
 * the Convex default runtime provides fetch + SubtleCrypto). Webhook signatures
 * are the `Stripe-Signature: t=...,v1=...` scheme: HMAC-SHA256 over
 * `${t}.${body}` with STRIPE_WEBHOOK_SECRET, constant-time compare, and a
 * 5-minute timestamp tolerance.
 *
 * Implemented by builder B. Contract in ./types.ts is FIXED.
 *
 * CURRENCY SCOPE: CAD/USD/EUR only (all 2-decimal). Integer cents map 1:1 to
 * Stripe's `unit_amount` (minor units). Zero-decimal currencies (JPY, etc.) are
 * OUT OF SCOPE — they would need a per-currency minor-unit factor here.
 */

const STRIPE_API = 'https://api.stripe.com';
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Encode a nested object as application/x-www-form-urlencoded using Stripe's
 * bracket convention: {a: {b: 1}} → a[b]=1, {a: [{b: 1}]} → a[0][b]=1.
 */
export function formEncode(obj: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? `${prefix}[${k}]` : k, v);
      }
    } else {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
    }
  };
  walk('', obj);
  return pairs.join('&');
}

/** Constant-time compare of two equal-length hex/ascii strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** HMAC-SHA256 over `message` with `secret`, returned as lowercase hex. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 of `message`, returned as lowercase hex. */
export async function sha256Hex(message: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parse a Stripe-Signature header value ('t=123,v1=abc,v1=def') into parts. */
function parseStripeSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, val] = part.split('=');
    if (k === 't') {
      const n = Number(val);
      if (Number.isFinite(n)) t = n;
    } else if (k === 'v1' && val) {
      v1.push(val.trim());
    }
  }
  return { t, v1 };
}

export const stripeProvider: PaymentProvider = {
  name: 'stripe',
  isConfigured: () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),

  createCheckout: async (req: CheckoutRequest): Promise<CheckoutSession> => {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw new Error('STRIPE_SECRET_KEY not configured');

    const body = formEncode({
      mode: 'payment',
      // Restrict to card (instant-settlement) methods only. Belt-and-suspenders
      // with the payment_status check in verifyAndParseWebhook: delayed-
      // notification methods (ACH/PAD/SEPA bank debits) fire
      // checkout.session.completed with payment_status 'unpaid' days before
      // funds settle — confirming a booking with $0 captured. Pinning
      // payment_method_types to card means those methods can't be selected at
      // all, so an unpaid completed event can never arise here.
      payment_method_types: ['card'],
      // Stripe wants the checkout session to expire with the hold. Min 30 min
      // from now is guaranteed by the 35-min hold TTL + the <31-min refusal.
      expires_at: Math.floor(req.expiresAtMs / 1000),
      customer_email: req.customerEmail,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: req.currency.toLowerCase(),
            unit_amount: req.amountCents,
            product_data: { name: req.description },
          },
        },
      ],
      metadata: {
        bookingId: req.bookingId,
        confirmationCode: req.confirmationCode,
      },
      // Mirror the bookingId onto the PaymentIntent so a refund/dispute later
      // can be traced without the session.
      payment_intent_data: {
        metadata: { bookingId: req.bookingId },
      },
    });

    const res = await fetch(`${STRIPE_API}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Stripe createCheckout failed (${res.status}): ${detail}`);
    }
    const session = (await res.json()) as { id: string; url: string };
    return { checkoutId: session.id, checkoutUrl: session.url };
  },

  verifyAndParseWebhook: async ({ body, headers }): Promise<ParsedWebhookEvent | null> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return null;
    const sigHeader = headers['stripe-signature'];
    if (!sigHeader) return null;

    const { t, v1 } = parseStripeSignatureHeader(sigHeader);
    if (t === null || v1.length === 0) return null;

    // Replay guard: reject signatures whose timestamp is outside ±5 minutes.
    const nowSeconds = Date.now() / 1000;
    if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return null;

    const expected = await hmacSha256Hex(secret, `${t}.${body}`);
    // Any of the provided v1 signatures matching (constant-time) is authentic.
    if (!v1.some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected))) {
      return null;
    }

    let event: {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    try {
      event = JSON.parse(body);
    } catch {
      return null;
    }
    const eventId = event.id;
    if (!eventId) return null;
    const object = event.data?.object ?? {};

    switch (event.type) {
      case 'checkout.session.completed': {
        // Only a session whose payment_status is 'paid' means funds are
        // captured. Delayed-notification methods (ACH/PAD/SEPA) fire completed
        // with payment_status 'unpaid' at commit time — days before settlement.
        // Ignore those; the real money arrives later via
        // checkout.session.async_payment_succeeded (below). (We also pin
        // payment_method_types:['card'] in createCheckout, so an 'unpaid'
        // completed should never reach us — this is defense in depth.)
        if (object.payment_status !== 'paid') {
          return { eventId, kind: 'ignored' };
        }
        return {
          eventId,
          kind: 'payment_succeeded',
          checkoutId: object.id as string | undefined,
          providerPaymentId:
            typeof object.payment_intent === 'string' ? object.payment_intent : undefined,
          amountCents: typeof object.amount_total === 'number' ? object.amount_total : undefined,
          currency:
            typeof object.currency === 'string' ? (object.currency as string).toUpperCase() : undefined,
        };
      }
      case 'checkout.session.async_payment_succeeded': {
        // A delayed-notification method finally settled — same fields as a
        // 'paid' completed event. This is the event that actually confirms a
        // bank-debit booking (if such a method were ever enabled).
        return {
          eventId,
          kind: 'payment_succeeded',
          checkoutId: object.id as string | undefined,
          providerPaymentId:
            typeof object.payment_intent === 'string' ? object.payment_intent : undefined,
          amountCents: typeof object.amount_total === 'number' ? object.amount_total : undefined,
          currency:
            typeof object.currency === 'string' ? (object.currency as string).toUpperCase() : undefined,
        };
      }
      case 'checkout.session.expired':
        return { eventId, kind: 'checkout_expired', checkoutId: object.id as string | undefined };
      case 'checkout.session.async_payment_failed':
        return { eventId, kind: 'payment_failed', checkoutId: object.id as string | undefined };
      default:
        // Authentic but uninteresting event — acknowledged, no-op.
        return { eventId, kind: 'ignored' };
    }
  },

  refund: async ({ providerPaymentId, amountCents }): Promise<{ providerRefundId: string }> => {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw new Error('STRIPE_SECRET_KEY not configured');
    // Deterministic Idempotency-Key so a retried refund (e.g. the response was
    // lost after Stripe already processed it — a network timeout) does NOT
    // create a SECOND refund on a charge that still has un-refunded balance.
    // Keyed on (paymentId, amount): a genuine second refund of a DIFFERENT
    // amount uses a different key. (Adversarial-review HIGH.)
    const idempotencyKey = `os-refund-${providerPaymentId}-${amountCents}`;
    const res = await fetch(`${STRIPE_API}/v1/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: formEncode({ payment_intent: providerPaymentId, amount: amountCents }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Prefix with the HTTP status so refundPayment can distinguish a 4xx
      // (permanent — dead-letter, no retry) from a 5xx (transient — retry).
      throw new Error(`HTTP ${res.status}: Stripe refund failed: ${detail}`);
    }
    const refund = (await res.json()) as { id: string };
    return { providerRefundId: refund.id };
  },
};
