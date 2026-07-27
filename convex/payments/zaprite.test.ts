import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_CONSENT_VERSION } from '../publicPolicy';
import { classifyZapriteOrder, zapriteProvider } from './zaprite';

const request = {
  bookingId: 'booking_123',
  confirmationCode: 'OS-ABC123',
  propertyName: 'Consensus Commons',
  description: 'Consensus Commons — booking OS-ABC123',
  amountCents: 100,
  currency: 'cad',
  customerEmail: 'guest@example.com',
  successUrl: 'https://stays.example/confirmation/OS-ABC123',
  cancelUrl: 'https://stays.example/checkout/booking_123',
  expiresAtMs: Date.UTC(2026, 6, 23, 18, 0, 0),
  consentVersion: PUBLIC_CONSENT_VERSION,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('zapriteProvider', () => {
  it('requires an API key, dedicated checkout id, and webhook secret', () => {
    vi.stubEnv('ZAPRITE_API_KEY', 'zap_key');
    vi.stubEnv('ZAPRITE_CUSTOM_CHECKOUT_ID', 'checkout_openstays');
    vi.stubEnv('ZAPRITE_WEBHOOK_SECRET', '');
    expect(zapriteProvider.isConfigured()).toBe(false);
    vi.stubEnv('ZAPRITE_WEBHOOK_SECRET', 'nudge_secret');
    expect(zapriteProvider.isConfigured()).toBe(true);
    expect(zapriteProvider.refundMode).toBe('manual');
  });

  it('creates a receipt-enabled order with immutable booking reconciliation metadata', async () => {
    vi.stubEnv('ZAPRITE_API_KEY', 'zap_key');
    vi.stubEnv('ZAPRITE_CUSTOM_CHECKOUT_ID', 'checkout_openstays');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'order_123', checkoutUrl: 'https://pay.zaprite.test/order_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    await expect(zapriteProvider.createCheckout(request)).resolves.toEqual({
      checkoutId: 'order_123',
      checkoutUrl: 'https://pay.zaprite.test/order_123',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.zaprite.com/v1/orders');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer zap_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      amount: 100,
      currency: 'CAD',
      expiresAt: '2026-07-23T18:00:00.000Z',
      externalUniqId: 'openstays:booking_123:1784829600000',
      redirectUrl: request.successUrl,
      redirectIfPending: false,
      label: request.description,
      customCheckoutId: 'checkout_openstays',
      sendReceiptToCustomer: true,
      customerData: { email: 'guest@example.com' },
      metadata: {
        bookingId: 'booking_123',
        confirmationCode: 'OS-ABC123',
        reconciliationId: 'openstays:booking_123:1784829600000',
        consentVersion: PUBLIC_CONSENT_VERSION,
      },
      tags: ['openstays', 'consensus-commons'],
    });
  });

  it('surfaces API errors without leaking the API key', async () => {
    vi.stubEnv('ZAPRITE_API_KEY', 'zap_secret_key');
    vi.stubEnv('ZAPRITE_CUSTOM_CHECKOUT_ID', 'checkout_openstays');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ code: 'BAD_REQUEST', message: 'Invalid input data' }), { status: 400 }),
    ));
    await expect(zapriteProvider.createCheckout(request)).rejects.toThrow(
      'Zaprite create order failed (HTTP 400 BAD_REQUEST): Invalid input data',
    );
    await expect(zapriteProvider.createCheckout(request)).rejects.not.toThrow('zap_secret_key');
  });
});

describe('classifyZapriteOrder', () => {
  const expected = {
    orderId: 'order_123',
    bookingId: 'booking_123',
    reconciliationId: 'openstays:booking_123:1784829600000',
    customCheckoutId: 'checkout_openstays',
    consentVersion: PUBLIC_CONSENT_VERSION,
    expiresAtMs: Date.UTC(2026, 6, 23, 18, 0, 0),
    amountCents: 100,
    currency: 'CAD',
  };

  it.each(['PENDING', 'PROCESSING', 'UNDERPAID'] as const)('does not confirm %s', (status) => {
    expect(classifyZapriteOrder({
      ...expected,
      order: {
        id: 'order_123',
        status,
        totalAmount: 100,
        currency: 'CAD',
        externalUniqId: expected.reconciliationId,
        customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: {
          bookingId: 'booking_123',
          reconciliationId: expected.reconciliationId,
          consentVersion: PUBLIC_CONSENT_VERSION,
        },
      },
    })).toEqual({ disposition: 'wait', status });
  });

  it.each(['PAID', 'COMPLETE'] as const)('confirms an exact %s order', (status) => {
    expect(classifyZapriteOrder({
      ...expected,
      order: {
        id: 'order_123',
        status,
        totalAmount: 100,
        currency: 'CAD',
        externalUniqId: expected.reconciliationId,
        customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: {
          bookingId: 'booking_123',
          reconciliationId: expected.reconciliationId,
          consentVersion: PUBLIC_CONSENT_VERSION,
        },
      },
    })).toEqual({ disposition: 'confirm', paidCents: 100, excessCents: 0, status });
  });

  it('confirms only the expected amount and isolates a verified overpayment excess', () => {
    expect(classifyZapriteOrder({
      ...expected,
      order: {
        id: 'order_123',
        status: 'OVERPAID',
        totalAmount: 100,
        currency: 'CAD',
        externalUniqId: expected.reconciliationId,
        customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: {
          bookingId: 'booking_123',
          reconciliationId: expected.reconciliationId,
          consentVersion: PUBLIC_CONSENT_VERSION,
        },
        transactions: [
          { id: 'tx_1', status: 'CONFIRMED', amountInOrderCurrency: 100 },
          { id: 'tx_2', status: 'CONFIRMED', amountInOrderCurrency: 655 },
          { id: 'tx_pending', status: 'PENDING', amountInOrderCurrency: 999 },
        ],
      },
    })).toEqual({ disposition: 'confirm', paidCents: 100, excessCents: 655, status: 'OVERPAID' });
  });

  it('rejects a forged join or changed order amount/currency', () => {
    for (const order of [
      {
        id: 'other', status: 'PAID', totalAmount: 100, currency: 'CAD',
        externalUniqId: expected.reconciliationId, customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'booking_123', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
      {
        id: 'order_123', status: 'PAID', totalAmount: 100, currency: 'CAD',
        externalUniqId: expected.reconciliationId, customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'attacker', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
      {
        id: 'order_123', status: 'PAID', totalAmount: 99, currency: 'CAD',
        externalUniqId: expected.reconciliationId, customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'booking_123', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
      {
        id: 'order_123', status: 'PAID', totalAmount: 100, currency: 'USD',
        externalUniqId: expected.reconciliationId, customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'booking_123', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
      {
        id: 'order_123', status: 'PAID', totalAmount: 100, currency: 'CAD',
        externalUniqId: 'forged', customCheckoutId: expected.customCheckoutId,
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'booking_123', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
      {
        id: 'order_123', status: 'PAID', totalAmount: 100, currency: 'CAD',
        externalUniqId: expected.reconciliationId, customCheckoutId: 'wrong',
        expiresAt: '2026-07-23T18:00:00.000Z',
        metadata: { bookingId: 'booking_123', reconciliationId: expected.reconciliationId, consentVersion: PUBLIC_CONSENT_VERSION },
      },
    ] as const) {
      expect(classifyZapriteOrder({ ...expected, order })).toMatchObject({ disposition: 'mismatch' });
    }
  });
});
