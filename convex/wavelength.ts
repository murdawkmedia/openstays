import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { timingSafeEqual } from './payments/stripe';
import {
  DEFAULT_SIGNET_SATS_PER_CURRENCY_UNIT,
  parseWavelengthNetwork,
  quoteSignetSats,
  type WavelengthNetwork,
} from '../shared/wavelength';
import {
  eligibilityEmailDigest,
  PUBLIC_CONSENT_VERSION,
  readPublicPolicy,
  verifyEligibilityToken,
} from './publicPolicy';

const HEALTH_FRESH_MS = 60_000;

export function bridgeBearerAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith('Bearer ') || !expectedToken) return false;
  const supplied = authorization.slice('Bearer '.length);
  return supplied.length === expectedToken.length && timingSafeEqual(supplied, expectedToken);
}

function configuredRate(): number {
  const raw = process.env.WAVELENGTH_SIGNET_SATS_PER_CURRENCY_UNIT;
  if (!raw) return DEFAULT_SIGNET_SATS_PER_CURRENCY_UNIT;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConvexError('INVALID_WAVELENGTH_RATE');
  }
  return parsed;
}

export function configuredNetwork(): WavelengthNetwork {
  try {
    return parseWavelengthNetwork(process.env.WAVELENGTH_NETWORK);
  } catch {
    throw new ConvexError('INVALID_WAVELENGTH_NETWORK');
  }
}

export function configuredBridgeToken(): string {
  return process.env.WAVELENGTH_BRIDGE_TOKEN ?? '';
}

function quoteSats(amountCents: number): number {
  return quoteSignetSats(amountCents, configuredRate());
}

export const available = query({
  args: {},
  handler: async (ctx) => {
    const network = configuredNetwork();
    const policy = readPublicPolicy(process.env);
    if (policy.liveMode) {
      const health = await ctx.db.query('bridgeHealth')
        .withIndex('by_service', (q) => q.eq('service', 'wavelength'))
        .unique();
      return {
        available: Boolean(
          policy.wavelengthEnabled
          && configuredBridgeToken()
          && health?.status === 'ready'
          && health.lastHeartbeatAt >= Date.now() - HEALTH_FRESH_MS,
        ),
        network,
        satsPerCurrencyUnit: configuredRate(),
        fixedPaymentSats: policy.wavelengthPaymentSats,
      };
    }
    return {
      available: Boolean(configuredBridgeToken()),
      network,
      satsPerCurrencyUnit: configuredRate(),
    };
  },
});

export const createRequest = mutation({
  args: {
    bookingId: v.id('bookings'),
    confirmationCode: v.string(),
    email: v.string(),
    consent: v.optional(v.object({
      version: v.string(),
      accepted: v.boolean(),
    })),
    eligibilityToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const network = configuredNetwork();
    if (!configuredBridgeToken()) throw new ConvexError('WAVELENGTH_NOT_CONFIGURED');
    const policy = readPublicPolicy(process.env);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || !booking.guestId || booking.confirmationCode !== args.confirmationCode.trim().toUpperCase()) {
      throw new ConvexError('BOOKING_NOT_FOUND');
    }
    const guest = await ctx.db.get(booking.guestId);
    if (!guest || guest.normalizedEmail !== args.email.trim().toLowerCase()) {
      throw new ConvexError('BOOKING_NOT_FOUND');
    }
    if (booking.status !== 'hold' || !booking.priceBreakdown || !booking.holdExpiresAt) {
      throw new ConvexError('NOT_A_PAYABLE_HOLD');
    }
    const existing = await ctx.db
      .query('wavelengthRequests')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .order('desc')
      .first();
    if (existing && ['requested', 'claimed', 'invoice_ready'].includes(existing.status)) return existing;
    if (policy.liveMode) {
      const health = await ctx.db.query('bridgeHealth')
        .withIndex('by_service', (q) => q.eq('service', 'wavelength'))
        .unique();
      if (
        !policy.wavelengthEnabled
        || !health
        || health.status !== 'ready'
        || health.lastHeartbeatAt < Date.now() - HEALTH_FRESH_MS
      ) {
        throw new ConvexError('WAVELENGTH_UNAVAILABLE');
      }
      if (
        !args.consent?.accepted
        || args.consent.version !== PUBLIC_CONSENT_VERSION
      ) {
        throw new ConvexError('PUBLIC_PAYMENT_CONSENT_REQUIRED');
      }
      const signingKey = process.env.ELIGIBILITY_HMAC_SECRET ?? '';
      if (!args.eligibilityToken || !signingKey) {
        throw new ConvexError('WAVELENGTH_ELIGIBILITY_REQUIRED');
      }
      let eligibility;
      try {
        eligibility = await verifyEligibilityToken(
          args.eligibilityToken,
          { action: 'wavelength_payment', bookingId: String(booking._id) },
          signingKey,
          Date.now(),
        );
      } catch {
        throw new ConvexError('WAVELENGTH_ELIGIBILITY_INVALID');
      }
      if (
        eligibility.emailDigest
        !== await eligibilityEmailDigest(guest.normalizedEmail, signingKey)
      ) {
        throw new ConvexError('WAVELENGTH_ELIGIBILITY_INVALID');
      }
    }

    const property = await ctx.db.get(booking.propertyId);
    if (!property) throw new ConvexError('PROPERTY_NOT_FOUND');
    const amountCents = booking.priceBreakdown.depositDueCents > 0
      ? booking.priceBreakdown.depositDueCents
      : booking.priceBreakdown.totalCents - booking.priceBreakdown.giftCertAppliedCents;
    const satsAmount = policy.liveMode
      ? policy.wavelengthPaymentSats
      : quoteSats(amountCents);
    const now = Date.now();
    const paymentId = await ctx.db.insert('payments', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      provider: 'wavelength',
      amountCents,
      gstCents: 0,
      currency: property.currency,
      status: 'pending',
      consentVersion: policy.liveMode ? PUBLIC_CONSENT_VERSION : undefined,
      refunds: [],
      createdAt: now,
    });
    const requestId = await ctx.db.insert('wavelengthRequests', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      paymentId,
      quotedAmountCents: amountCents,
      currency: property.currency,
      network,
      satsAmount,
      expiresAt: booking.holdExpiresAt,
      status: 'requested',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(paymentId, { providerCheckoutId: requestId });
    if (policy.liveMode && !booking.publicPaymentConsent) {
      await ctx.db.patch(booking._id, {
        publicPaymentConsent: {
          version: PUBLIC_CONSENT_VERSION,
          rail: 'wavelength',
          acceptedAt: now,
        },
      });
    }
    return await ctx.db.get(requestId);
  },
});

export const forGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db
      .query('bookings')
      .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', args.confirmationCode.trim().toUpperCase()))
      .first();
    if (!booking?.guestId) return null;
    const guest = await ctx.db.get(booking.guestId);
    if (guest?.normalizedEmail !== args.email.trim().toLowerCase()) return null;
    return await ctx.db.query('wavelengthRequests').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).order('desc').first();
  },
});

export const claimPending = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 25);
    const requested = await ctx.db
      .query('wavelengthRequests')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'requested'))
      .take(limit);
    const alreadyActive = (
      await Promise.all(
        (['claimed', 'invoice_ready'] as const).map((status) =>
          ctx.db
            .query('wavelengthRequests')
            .withIndex('by_status_createdAt', (q) => q.eq('status', status))
            .take(limit),
        ),
      )
    ).flat();
    const payable = [];
    for (const request of [...requested, ...alreadyActive].sort((a, b) => a.createdAt - b.createdAt)) {
      if (request.network !== 'signet') continue;
      const payment = await ctx.db.get(request.paymentId);
      const authoritativePayment =
        payment?.provider === 'wavelength' &&
        (payment.status === 'paid' || payment.status === 'refunded' || payment.status === 'partially_refunded') &&
        payment.providerPaymentId?.trim()
          ? payment
          : null;
      if (authoritativePayment) {
        const authoritativePaymentHash = authoritativePayment.providerPaymentId!.trim();
        await ctx.db.patch(request._id, {
          status: 'settled',
          paymentHash: authoritativePaymentHash,
          settledAt: authoritativePayment.paidAt ?? now,
          failureReason: undefined,
          updatedAt: now,
        });
        continue;
      }
      if (request.expiresAt <= now) {
        await ctx.db.patch(request._id, { status: 'expired', updatedAt: now });
        if (payment?.status === 'pending') await ctx.db.patch(payment._id, { status: 'failed' });
        continue;
      }
      if (!payment || payment.status !== 'pending') {
        await ctx.db.patch(request._id, {
          status: 'failed',
          failureReason: 'WAVELENGTH_PAYMENT_NOT_PENDING',
          updatedAt: now,
        });
        continue;
      }
      const booking = await ctx.db.get(request.bookingId);
      if (!booking || booking.status !== 'hold' || !booking.holdExpiresAt || booking.holdExpiresAt <= now) {
        await ctx.db.patch(request._id, { status: 'failed', failureReason: 'BOOKING_NOT_PAYABLE', updatedAt: now });
        await ctx.db.patch(payment._id, { status: 'failed' });
        continue;
      }
      if (request.status === 'requested') {
        await ctx.db.patch(request._id, { status: 'claimed', claimedAt: now, updatedAt: now });
        payable.push({ ...request, status: 'claimed' as const, claimedAt: now, updatedAt: now });
      } else {
        payable.push(request);
      }
    }
    return payable.slice(0, limit);
  },
});

export const publishInvoice = internalMutation({
  args: {
    requestId: v.id('wavelengthRequests'),
    network: v.literal('signet'),
    bolt11: v.string(),
    bridgeActivityId: v.string(),
    satsAmount: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError('WAVELENGTH_REQUEST_NOT_FOUND');
    if (request.status === 'invoice_ready' && request.bolt11 === args.bolt11) return { published: false };
    if (request.status !== 'claimed' && request.status !== 'requested') throw new ConvexError('WAVELENGTH_REQUEST_NOT_CLAIMED');
    if (args.network !== request.network) throw new ConvexError('WAVELENGTH_NETWORK_MISMATCH');
    if (args.satsAmount !== request.satsAmount) throw new ConvexError('WAVELENGTH_AMOUNT_MISMATCH');
    const bolt11 = args.bolt11.trim();
    const activityId = args.bridgeActivityId.trim();
    if (!bolt11 || !activityId || args.expiresAt <= Date.now() || args.expiresAt > request.expiresAt) {
      throw new ConvexError('INVALID_WAVELENGTH_INVOICE');
    }
    await ctx.db.patch(request._id, {
      bolt11,
      bridgeActivityId: activityId,
      expiresAt: args.expiresAt,
      status: 'invoice_ready',
      updatedAt: Date.now(),
    });
    return { published: true };
  },
});

export const prepareSettlement = internalMutation({
  args: {
    requestId: v.id('wavelengthRequests'),
    network: v.literal('signet'),
    bolt11: v.string(),
    bridgeActivityId: v.string(),
    paymentHash: v.string(),
    satsAmount: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError('WAVELENGTH_REQUEST_NOT_FOUND');
    if (request.status === 'settled') return { duplicate: true, request };
    if (request.status !== 'invoice_ready') throw new ConvexError('WAVELENGTH_INVOICE_NOT_READY');
    if (request.network !== args.network) throw new ConvexError('WAVELENGTH_NETWORK_MISMATCH');
    if (
      request.bolt11 !== args.bolt11 ||
      request.bridgeActivityId !== args.bridgeActivityId ||
      request.satsAmount !== args.satsAmount ||
      !args.paymentHash.trim()
    ) {
      throw new ConvexError('WAVELENGTH_SETTLEMENT_MISMATCH');
    }
    return { duplicate: false, request };
  },
});

export const markFailed = internalMutation({
  args: {
    requestId: v.id('wavelengthRequests'),
    network: v.literal('signet'),
    bolt11: v.string(),
    bridgeActivityId: v.string(),
    satsAmount: v.number(),
    terminalStatus: v.union(v.literal('failed'), v.literal('expired')),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError('WAVELENGTH_REQUEST_NOT_FOUND');
    if (
      request.network !== args.network ||
      request.bolt11 !== args.bolt11 ||
      request.bridgeActivityId !== args.bridgeActivityId ||
      request.satsAmount !== args.satsAmount
    ) {
      throw new ConvexError('WAVELENGTH_FAILURE_MISMATCH');
    }
    if (request.status === 'settled' || request.status === 'failed' || request.status === 'expired') {
      return { failed: false, duplicate: true };
    }
    if (request.status !== 'invoice_ready') throw new ConvexError('WAVELENGTH_INVOICE_NOT_READY');
    const payment = await ctx.db.get(request.paymentId);
    if (!payment || payment.status !== 'pending') throw new ConvexError('WAVELENGTH_PAYMENT_NOT_PENDING');
    const reason = args.reason.trim().slice(0, 500) || 'WAVELENGTH_RECEIVE_FAILED';
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.terminalStatus,
      failureReason: reason,
      updatedAt: now,
    });
    await ctx.db.patch(payment._id, { status: 'failed' });
    return { failed: true, duplicate: false };
  },
});

export const markSettled = internalMutation({
  args: { requestId: v.id('wavelengthRequests'), paymentHash: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError('WAVELENGTH_REQUEST_NOT_FOUND');
    if (request.status === 'settled') return { settled: false };
    if (
      request.status !== 'invoice_ready' &&
      request.status !== 'failed' &&
      request.status !== 'expired'
    ) {
      throw new ConvexError('WAVELENGTH_INVOICE_NOT_READY');
    }
    const paymentHash = args.paymentHash.trim();
    const payment = await ctx.db.get(request.paymentId);
    if (
      !payment ||
      payment.provider !== 'wavelength' ||
      (payment.status !== 'paid' &&
        payment.status !== 'refunded' &&
        payment.status !== 'partially_refunded') ||
      payment.providerPaymentId?.trim() !== paymentHash
    ) {
      throw new ConvexError('WAVELENGTH_PAYMENT_NOT_SETTLED');
    }
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: 'settled',
      paymentHash,
      settledAt: payment.paidAt ?? now,
      failureReason: undefined,
      updatedAt: now,
    });
    return { settled: true };
  },
});
