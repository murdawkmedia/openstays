/// <reference types="vite/client" />
// Unit tests for the provider webhook verification + event mapping. Signatures
// are computed in-test with crypto.subtle so the tests exercise the REAL HMAC
// path (no mocking). vi.stubEnv supplies synthetic secrets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripeProvider, formEncode, hmacSha256Hex, timingSafeEqual } from './payments/stripe';
import { squareProvider, hmacSha256Base64 } from './payments/square';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Shared pure helpers
// ---------------------------------------------------------------------------
describe('formEncode (Stripe bracket convention)', () => {
  it('encodes nested objects and arrays with brackets (percent-encoded per x-www-form-urlencoded)', () => {
    const s = formEncode({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: 5250 } }],
      metadata: { bookingId: 'bk_1' },
    });
    // encodeURIComponent percent-encodes the [] in keys — Stripe's form parser
    // decodes these, so line_items%5B0%5D%5Bquantity%5D is the wire form of
    // line_items[0][quantity]. Decode back to assert the logical structure.
    const decoded = decodeURIComponent(s);
    expect(decoded).toContain('mode=payment');
    expect(decoded).toContain('line_items[0][quantity]=1');
    expect(decoded).toContain('line_items[0][price_data][currency]=cad');
    expect(decoded).toContain('line_items[0][price_data][unit_amount]=5250');
    expect(decoded).toContain('metadata[bookingId]=bk_1');
  });

  it('url-encodes special characters and skips null/undefined', () => {
    const s = formEncode({ a: 'x y&z', b: undefined, c: null, d: 'ok' });
    expect(s).toContain('a=x%20y%26z');
    expect(s).toContain('d=ok');
    expect(s).not.toContain('b=');
    expect(s).not.toContain('c=');
  });
});

describe('timingSafeEqual', () => {
  it('true for equal strings, false for different (incl. length)', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stripe webhook verification
// ---------------------------------------------------------------------------
describe('stripe.verifyAndParseWebhook', () => {
  const SECRET = 'whsec_test_synthetic_key';

  async function signedRequest(body: string, t: number, secret = SECRET) {
    const sig = await hmacSha256Hex(secret, `${t}.${body}`);
    return { body, headers: { 'stripe-signature': `t=${t},v1=${sig}` }, requestUrl: 'https://x/webhooks/stripe' };
  }

  beforeEach(() => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  });

  it('parses a valid checkout.session.completed → payment_succeeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123', payment_intent: 'pi_abc', amount_total: 5250, currency: 'cad' } },
    });
    const parsed = await stripeProvider.verifyAndParseWebhook(await signedRequest(body, t));
    expect(parsed).toEqual({
      eventId: 'evt_1',
      kind: 'payment_succeeded',
      checkoutId: 'cs_123',
      providerPaymentId: 'pi_abc',
      amountCents: 5250,
      currency: 'CAD',
    });
  });

  it('maps expired and async_payment_failed events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = Math.floor(Date.now() / 1000);
    const expired = JSON.stringify({ id: 'evt_2', type: 'checkout.session.expired', data: { object: { id: 'cs_9' } } });
    const failed = JSON.stringify({
      id: 'evt_3',
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_8' } },
    });
    expect(await stripeProvider.verifyAndParseWebhook(await signedRequest(expired, t))).toMatchObject({
      kind: 'checkout_expired',
      checkoutId: 'cs_9',
    });
    expect(await stripeProvider.verifyAndParseWebhook(await signedRequest(failed, t))).toMatchObject({
      kind: 'payment_failed',
      checkoutId: 'cs_8',
    });
  });

  it('authentic-but-unknown event type → ignored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_x', type: 'customer.created', data: { object: {} } });
    const parsed = await stripeProvider.verifyAndParseWebhook(await signedRequest(body, t));
    expect(parsed).toEqual({ eventId: 'evt_x', kind: 'ignored' });
  });

  it('tampered body → null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 100 } } });
    const req = await signedRequest(body, t);
    req.body = req.body.replace('100', '999999'); // sign no longer matches
    expect(await stripeProvider.verifyAndParseWebhook(req)).toBeNull();
  });

  it('wrong secret → null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 100 } } });
    const req = await signedRequest(body, t, 'whsec_WRONG');
    expect(await stripeProvider.verifyAndParseWebhook(req)).toBeNull();
  });

  it('stale timestamp (> 5 min skew) → null even with a valid signature', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const staleT = Math.floor(Date.now() / 1000) - 301; // 301s old
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 100 } } });
    const req = await signedRequest(body, staleT);
    expect(await stripeProvider.verifyAndParseWebhook(req)).toBeNull();
  });

  it('missing header or missing secret → null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const body = '{}';
    expect(
      await stripeProvider.verifyAndParseWebhook({ body, headers: {}, requestUrl: 'https://x' }),
    ).toBeNull();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect(
      await stripeProvider.verifyAndParseWebhook({ body, headers: { 'stripe-signature': 't=1,v1=x' }, requestUrl: 'https://x' }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Square webhook verification
// ---------------------------------------------------------------------------
describe('square.verifyAndParseWebhook', () => {
  const KEY = 'sq_sig_synthetic_key';
  const URL = 'https://deploy.example.com/webhooks/square';

  async function signedRequest(body: string, key = KEY, url = URL) {
    const sig = await hmacSha256Base64(key, url + body);
    return { body, headers: { 'x-square-hmacsha256-signature': sig }, requestUrl: url };
  }

  beforeEach(() => {
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', KEY);
  });

  it('parses a COMPLETED payment.updated → payment_succeeded (checkoutId = order_id)', async () => {
    const body = JSON.stringify({
      event_id: 'sqevt_1',
      type: 'payment.updated',
      data: { object: { payment: { id: 'sqpay_1', order_id: 'ord_1', status: 'COMPLETED', amount_money: { amount: 5250, currency: 'CAD' } } } },
    });
    const parsed = await squareProvider.verifyAndParseWebhook(await signedRequest(body));
    expect(parsed).toEqual({
      eventId: 'sqevt_1',
      kind: 'payment_succeeded',
      checkoutId: 'ord_1',
      providerPaymentId: 'sqpay_1',
      amountCents: 5250,
      currency: 'CAD',
    });
  });

  it('maps FAILED / CANCELED → payment_failed, in-flight → ignored', async () => {
    const failed = JSON.stringify({
      event_id: 'e_f',
      type: 'payment.updated',
      data: { object: { payment: { id: 'p', order_id: 'o_f', status: 'FAILED' } } },
    });
    const pending = JSON.stringify({
      event_id: 'e_p',
      type: 'payment.updated',
      data: { object: { payment: { id: 'p', order_id: 'o_p', status: 'PENDING' } } },
    });
    expect(await squareProvider.verifyAndParseWebhook(await signedRequest(failed))).toMatchObject({
      kind: 'payment_failed',
      checkoutId: 'o_f',
    });
    expect(await squareProvider.verifyAndParseWebhook(await signedRequest(pending))).toMatchObject({
      kind: 'ignored',
    });
  });

  it('non-payment event type → ignored', async () => {
    const body = JSON.stringify({ event_id: 'e', type: 'refund.updated', data: { object: {} } });
    expect(await squareProvider.verifyAndParseWebhook(await signedRequest(body))).toEqual({
      eventId: 'e',
      kind: 'ignored',
    });
  });

  it('tampered body → null', async () => {
    const body = JSON.stringify({
      event_id: 'e',
      type: 'payment.updated',
      data: { object: { payment: { id: 'p', order_id: 'o', status: 'COMPLETED', amount_money: { amount: 100, currency: 'CAD' } } } },
    });
    const req = await signedRequest(body);
    req.body = req.body.replace('100', '9999');
    expect(await squareProvider.verifyAndParseWebhook(req)).toBeNull();
  });

  it('wrong signature key → null', async () => {
    const body = JSON.stringify({ event_id: 'e', type: 'payment.updated', data: { object: { payment: { status: 'COMPLETED' } } } });
    const req = await signedRequest(body, 'sq_WRONG_key');
    expect(await squareProvider.verifyAndParseWebhook(req)).toBeNull();
  });

  it('signature over the WRONG url → null (Square signs the exact notification URL)', async () => {
    const body = JSON.stringify({ event_id: 'e', type: 'payment.updated', data: { object: { payment: { status: 'COMPLETED' } } } });
    // Sign over a different URL than the requestUrl passed to verify.
    const sig = await hmacSha256Base64(KEY, 'https://attacker.example.com/webhooks/square' + body);
    const parsed = await squareProvider.verifyAndParseWebhook({
      body,
      headers: { 'x-square-hmacsha256-signature': sig },
      requestUrl: URL,
    });
    expect(parsed).toBeNull();
  });

  it('missing header or missing key → null', async () => {
    const body = '{}';
    expect(
      await squareProvider.verifyAndParseWebhook({ body, headers: {}, requestUrl: URL }),
    ).toBeNull();
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', '');
    expect(
      await squareProvider.verifyAndParseWebhook({ body, headers: { 'x-square-hmacsha256-signature': 'x' }, requestUrl: URL }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isConfigured gates
// ---------------------------------------------------------------------------
describe('isConfigured', () => {
  it('stripe requires secret + webhook secret', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect(stripeProvider.isConfigured()).toBe(false);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec');
    expect(stripeProvider.isConfigured()).toBe(true);
  });

  it('square requires token + location + signature key', () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', 'tok');
    vi.stubEnv('SQUARE_LOCATION_ID', 'loc');
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', '');
    expect(squareProvider.isConfigured()).toBe(false);
    vi.stubEnv('SQUARE_WEBHOOK_SIGNATURE_KEY', 'key');
    expect(squareProvider.isConfigured()).toBe(true);
  });
});
