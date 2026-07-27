// ---------------------------------------------------------------------------
// PaymentProvider contract (M1). Both Stripe and Square implement this exact
// interface; the rest of the codebase never imports a provider directly —
// always through getProvider() in ./index.ts.
//
// Env vars per deployment (orchestrator-set via `npx convex env set`, NEVER in
// code, settings table, or the repo):
//   STRIPE_SECRET_KEY            sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SECRET        whsec_...
//   SQUARE_ACCESS_TOKEN
//   SQUARE_LOCATION_ID
//   SQUARE_WEBHOOK_SIGNATURE_KEY
//   SQUARE_ENV                   'sandbox' | 'production'
//   SITE_URL                     frontend origin for success/cancel redirects
// A provider is "configured" iff its required env vars are present; the
// checkout UI only offers configured providers (see availability in index.ts).
// ---------------------------------------------------------------------------

export type ProviderName = 'stripe' | 'square' | 'zaprite';

export type CheckoutRequest = {
  /** Our booking id + code, round-tripped through provider metadata. */
  bookingId: string;
  confirmationCode: string;
  propertyName: string;
  /** Line-item description shown on the hosted payment page. */
  description: string;
  amountCents: number;
  /** ISO 4217, from property.currency (e.g. 'CAD'). */
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Hold expiry instant (epoch ms). Stripe: pass as expires_at (min 30 min
   * away — guaranteed by the 35-min hold TTL + the <31-min refusal rule).
   * Square Payment Links have no short expiry — the webhook/confirm path
   * handles payment-after-expiry via re-acquire or payment_conflict.
   */
  expiresAtMs: number;
  consentVersion?: string;
};

export type CheckoutSession = {
  /** Provider's checkout/session id — stored on the pending payments row. */
  checkoutId: string;
  /** Hosted payment page the guest is redirected to. */
  checkoutUrl: string;
};

export type ParsedWebhookEvent = {
  /** Provider event id — the webhookEvents idempotency key. */
  eventId: string;
  kind: 'payment_succeeded' | 'payment_failed' | 'checkout_expired' | 'ignored';
  /** Provider checkout id — joins back to the pending payments row. */
  checkoutId?: string;
  providerPaymentId?: string;
  amountCents?: number;
  currency?: string;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly refundMode: 'automatic' | 'manual';
  /** True when this deployment has the env vars to run this provider. */
  isConfigured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verify the webhook signature and parse the event.
   * Returns null on BAD SIGNATURE (caller responds 400 and processes nothing).
   * Unrecognized-but-authentic events return kind 'ignored'.
   */
  verifyAndParseWebhook(args: {
    body: string;
    headers: Record<string, string>;
    /** Full request URL as received — Square signs over the notification URL. */
    requestUrl: string;
  }): Promise<ParsedWebhookEvent | null>;
  refund(args: {
    providerPaymentId: string;
    amountCents: number;
    currency: string;
    reason: string;
  }): Promise<{ providerRefundId: string }>;
}
