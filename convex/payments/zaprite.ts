import type { CheckoutRequest, CheckoutSession, ParsedWebhookEvent, PaymentProvider } from './types';
import { timingSafeEqual } from './stripe';

const ZAPRITE_API = 'https://api.zaprite.com';

function apiBaseUrl(): string {
  return (process.env.ZAPRITE_API_BASE_URL ?? ZAPRITE_API).replace(/\/$/, '');
}

type ZapriteError = { code?: string; message?: string };

export type ZapriteOrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'OVERPAID'
  | 'UNDERPAID'
  | 'COMPLETE';

export type ZapriteOrder = {
  id: string;
  externalUniqId?: string | null;
  customCheckoutId?: string | null;
  expiresAt?: string | null;
  totalAmount: number;
  currency: string;
  status: ZapriteOrderStatus;
  checkoutUrl?: string;
  metadata?: Record<string, string>;
  transactions?: Array<{
    id?: string;
    amountInOrderCurrency?: number | null;
    status?: 'PENDING' | 'CONFIRMED' | 'CANCELED';
    externalRef?: string | null;
  }>;
};

export type ZapriteDisposition =
  | { disposition: 'wait'; status: ZapriteOrderStatus }
  | { disposition: 'mismatch'; reason: string; status: ZapriteOrderStatus }
  | {
      disposition: 'confirm';
      paidCents: number;
      excessCents: number;
      status: 'PAID' | 'COMPLETE' | 'OVERPAID';
    };

export function classifyZapriteOrder(args: {
  order: ZapriteOrder;
  orderId: string;
  bookingId: string;
  amountCents: number;
  currency: string;
  reconciliationId: string;
  customCheckoutId: string;
  consentVersion: string;
  expiresAtMs: number;
}): ZapriteDisposition {
  const { order } = args;
  if (order.id !== args.orderId) {
    return { disposition: 'mismatch', reason: 'order_id', status: order.status };
  }
  if (order.metadata?.bookingId !== args.bookingId) {
    return { disposition: 'mismatch', reason: 'booking_metadata', status: order.status };
  }
  if (
    order.externalUniqId !== args.reconciliationId
    || order.metadata?.reconciliationId !== args.reconciliationId
  ) {
    return { disposition: 'mismatch', reason: 'reconciliation_id', status: order.status };
  }
  if (order.customCheckoutId !== args.customCheckoutId) {
    return { disposition: 'mismatch', reason: 'custom_checkout', status: order.status };
  }
  if (order.metadata?.consentVersion !== args.consentVersion) {
    return { disposition: 'mismatch', reason: 'consent_version', status: order.status };
  }
  if (
    typeof order.expiresAt !== 'string'
    || Date.parse(order.expiresAt) !== args.expiresAtMs
  ) {
    return { disposition: 'mismatch', reason: 'expiry', status: order.status };
  }
  if (order.totalAmount !== args.amountCents) {
    return { disposition: 'mismatch', reason: 'order_amount', status: order.status };
  }
  if (order.currency.toUpperCase() !== args.currency.toUpperCase()) {
    return { disposition: 'mismatch', reason: 'currency', status: order.status };
  }
  if (order.status === 'PENDING' || order.status === 'PROCESSING' || order.status === 'UNDERPAID') {
    return { disposition: 'wait', status: order.status };
  }
  if (order.status === 'OVERPAID') {
    const received = (order.transactions ?? [])
      .filter((transaction) => transaction.status === 'CONFIRMED')
      .reduce((sum, transaction) => sum + (transaction.amountInOrderCurrency ?? 0), 0);
    if (received <= args.amountCents) {
      return { disposition: 'mismatch', reason: 'overpaid_without_excess', status: order.status };
    }
    return {
      disposition: 'confirm',
      paidCents: args.amountCents,
      excessCents: received - args.amountCents,
      status: order.status,
    };
  }
  return { disposition: 'confirm', paidCents: args.amountCents, excessCents: 0, status: order.status };
}

async function zapriteError(response: Response, operation: string): Promise<Error> {
  let body: ZapriteError = {};
  try {
    body = (await response.json()) as ZapriteError;
  } catch {
    // Keep the fallback generic; never include headers or credentials.
  }
  const code = body.code ? ` ${body.code}` : '';
  const message = body.message ? `: ${body.message}` : '';
  return new Error(`Zaprite ${operation} failed (HTTP ${response.status}${code})${message}`);
}

function apiKey(): string {
  return process.env.ZAPRITE_API_KEY ?? '';
}

export async function getZapriteOrder(orderId: string): Promise<ZapriteOrder> {
  const response = await fetch(`${apiBaseUrl()}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!response.ok) throw await zapriteError(response, 'get order');
  return (await response.json()) as ZapriteOrder;
}

export const zapriteProvider: PaymentProvider = {
  name: 'zaprite',
  refundMode: 'manual',
  isConfigured: () =>
    Boolean(
      process.env.ZAPRITE_API_KEY &&
        process.env.ZAPRITE_CUSTOM_CHECKOUT_ID &&
        process.env.ZAPRITE_WEBHOOK_SECRET,
    ),
  createCheckout: async (req: CheckoutRequest): Promise<CheckoutSession> => {
    const reconciliationId = `openstays:${req.bookingId}:${req.expiresAtMs}`;
    const response = await fetch(`${apiBaseUrl()}/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: req.amountCents,
        currency: req.currency.toUpperCase(),
        expiresAt: new Date(req.expiresAtMs).toISOString(),
        externalUniqId: reconciliationId,
        redirectUrl: req.successUrl,
        redirectIfPending: false,
        label: req.description,
        customCheckoutId: process.env.ZAPRITE_CUSTOM_CHECKOUT_ID,
        sendReceiptToCustomer: true,
        customerData: { email: req.customerEmail },
        metadata: {
          bookingId: req.bookingId,
          confirmationCode: req.confirmationCode,
          reconciliationId,
          consentVersion: req.consentVersion,
        },
        tags: ['openstays', 'consensus-commons'],
      }),
    });
    if (!response.ok) throw await zapriteError(response, 'create order');
    const order = (await response.json()) as ZapriteOrder;
    if (!order.id || !order.checkoutUrl) {
      throw new Error('Zaprite create order failed: response omitted id or checkoutUrl');
    }
    return { checkoutId: order.id, checkoutUrl: order.checkoutUrl };
  },
  verifyAndParseWebhook: async ({ requestUrl }): Promise<ParsedWebhookEvent | null> => {
    const expected = process.env.ZAPRITE_WEBHOOK_SECRET ?? '';
    const supplied = new URL(requestUrl).searchParams.get('secret') ?? '';
    if (!expected || !supplied || !timingSafeEqual(supplied, expected)) return null;
    // Zaprite does not document a signed body contract. An authenticated URL is
    // only a nudge; reconciliation fetches each order with the server API key.
    return { eventId: 'zaprite-nudge', kind: 'ignored' };
  },
  refund: async () => {
    throw new Error('Zaprite refunds require staff completion with an external reference.');
  },
};
