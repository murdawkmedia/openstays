import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { sha256HexOf } from './apiKeys';
import { buildCanonicalConsensusReceipt, stableStringify } from '../shared/consensusReceipt';
import { requireStaff } from './staff';
import { CONSENSUS_REWARD_SATS } from './rewardPolicy';

const RECEIPT_SCHEMA = 'openstays.consensus-receipt.v1' as const;
const LEASE_MS = 60_000;
const MAX_PROOF_BYTES = 256 * 1024;

export const ensureForBooking = internalMutation({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('consensusReceipts')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId)).unique();
    if (existing) return existing;
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.status !== 'confirmed' || !booking.priceBreakdown) return null;
    const [property, payments, emails, channel] = await Promise.all([
      ctx.db.get(booking.propertyId),
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('emailLog').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('channelSync').withIndex('by_property', (q) => q.eq('propertyId', booking.propertyId)).first(),
    ]);
    if (!property) throw new ConvexError('PROPERTY_NOT_FOUND');
    const settled = payments.filter((payment) => ['paid', 'partially_refunded', 'refunded'].includes(payment.status));
    const payment = settled[settled.length - 1];
    if (!payment) throw new ConvexError('SETTLED_PAYMENT_REQUIRED');
    const createdAt = booking.statusHistory.find((entry) => entry.status === 'confirmed')?.ts ?? booking.updatedAt;
    const [bookingCommitment, statusHistoryDigest, paymentEventsDigest, notificationEventsDigest, channelEventsDigest] = await Promise.all([
      sha256HexOf(`openstays-booking-v1\0${booking._id}\0${booking.confirmationCode}`),
      sha256HexOf(stableStringify(booking.statusHistory.map(({ status, ts }) => ({ status, ts })))),
      sha256HexOf(stableStringify(settled.map(({ provider, amountCents, currency, status, paidAt }) => ({ provider, amountCents, currency, status, paidAt: paidAt ?? 0 })))),
      sha256HexOf(stableStringify(emails.map(({ templateKey, status, ts }) => ({ templateKey, status, ts })))),
      sha256HexOf(stableStringify({ mapped: Boolean(property.channexPropertyId), dirtySince: channel?.dirtySince ?? 0 })),
    ]);
    const canonicalJson = buildCanonicalConsensusReceipt({
      bookingCommitment, propertyName: property.name, propertySlug: property.slug,
      amountCents: payment.amountCents, currency: payment.currency, paymentProvider: payment.provider,
      paymentStatus: payment.status, bookingStatus: booking.status, statusHistoryDigest, paymentEventsDigest,
      notificationEventsDigest, channelEventsDigest, createdAt,
    });
    const sha256 = await sha256HexOf(canonicalJson);
    const receiptId = await ctx.db.insert('consensusReceipts', {
      propertyId: booking.propertyId, bookingId: booking._id, publicId: `cr_${booking._id}`,
      schemaVersion: RECEIPT_SCHEMA, canonicalJson, sha256, status: 'queued', createdAt, updatedAt: Date.now(),
    });
    return (await ctx.db.get(receiptId))!;
  },
});

export const claimPending = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 25);
    const queued = await ctx.db.query('consensusReceipts')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'queued')).take(limit);
    const stale = (await ctx.db.query('consensusReceipts')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'stamping')).take(limit))
      .filter((receipt) => (receipt.leaseExpiresAt ?? 0) <= now);
    const claimed = [];
    for (const receipt of [...queued, ...stale].slice(0, limit)) {
      const leaseToken = await sha256HexOf(`${receipt._id}:${now}:${receipt.updatedAt}`);
      await ctx.db.patch(receipt._id, { status: 'stamping', leaseToken, leaseExpiresAt: now + LEASE_MS, updatedAt: now });
      claimed.push({ ...receipt, status: 'stamping' as const, leaseToken, leaseExpiresAt: now + LEASE_MS, updatedAt: now });
    }
    const upgrades = await ctx.db.query('consensusReceipts')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'submitted')).take(Math.max(0, limit - claimed.length));
    return [
      ...claimed.map((receipt) => ({ ...receipt, work: 'stamp' as const })),
      ...upgrades.map((receipt) => ({ ...receipt, work: 'upgrade' as const })),
    ];
  },
});

function proofBytes(base64: string): number {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new ConvexError('INVALID_OTS_PROOF');
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

export const publishProof = internalMutation({
  args: { receiptId: v.id('consensusReceipts'), leaseToken: v.string(), sha256: v.string(), proofBase64: v.string(), calendarCount: v.number() },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) throw new ConvexError('RECEIPT_NOT_FOUND');
    if (receipt.status === 'submitted' || receipt.status === 'bitcoin_anchored') return { published: false };
    if (receipt.status !== 'stamping' || receipt.leaseToken !== args.leaseToken || (receipt.leaseExpiresAt ?? 0) <= Date.now()) {
      throw new ConvexError('STALE_OTS_LEASE');
    }
    if (args.sha256 !== receipt.sha256 || proofBytes(args.proofBase64) > MAX_PROOF_BYTES || !Number.isInteger(args.calendarCount) || args.calendarCount < 1) {
      throw new ConvexError('INVALID_OTS_PROOF');
    }
    const now = Date.now();
    await ctx.db.patch(receipt._id, {
      status: 'submitted', proofBase64: args.proofBase64, calendarCount: args.calendarCount,
      submittedAt: now, updatedAt: now, leaseToken: undefined, leaseExpiresAt: undefined, failureReason: undefined,
    });
    const existingReward = await ctx.db.query('wavelengthRewards')
      .withIndex('by_receipt', (q) => q.eq('receiptId', receipt._id)).unique();
    if (!existingReward) await ctx.db.insert('wavelengthRewards', {
      propertyId: receipt.propertyId, bookingId: receipt.bookingId, receiptId: receipt._id,
      network: 'signet', satsAmount: CONSENSUS_REWARD_SATS, status: 'eligible', attemptCount: 0, createdAt: now, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, (internal as any).email.sendBookingEmail, {
      bookingId: receipt.bookingId, kind: 'consensus_receipt', receiptId: receipt.publicId, receiptSha256: receipt.sha256,
    });
    return { published: true };
  },
});

export const markAnchored = internalMutation({
  args: { receiptId: v.id('consensusReceipts'), sha256: v.string(), proofBase64: v.string(), bitcoinBlockHeight: v.number(), bitcoinBlockTime: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) throw new ConvexError('RECEIPT_NOT_FOUND');
    if (receipt.status === 'bitcoin_anchored') return { anchored: false };
    if (receipt.status !== 'submitted' || receipt.sha256 !== args.sha256 || proofBytes(args.proofBase64) > MAX_PROOF_BYTES || args.bitcoinBlockHeight <= 0) {
      throw new ConvexError('INVALID_OTS_ATTESTATION');
    }
    const now = Date.now();
    await ctx.db.patch(receipt._id, { status: 'bitcoin_anchored', proofBase64: args.proofBase64,
      bitcoinBlockHeight: args.bitcoinBlockHeight, bitcoinBlockTime: args.bitcoinBlockTime, anchoredAt: now, updatedAt: now });
    return { anchored: true };
  },
});

export const markFailed = internalMutation({
  args: { receiptId: v.id('consensusReceipts'), leaseToken: v.string(), reason: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) throw new ConvexError('RECEIPT_NOT_FOUND');
    if (receipt.status !== 'stamping' || receipt.leaseToken !== args.leaseToken) throw new ConvexError('STALE_OTS_LEASE');
    await ctx.db.patch(receipt._id, { status: args.retryable ? 'queued' : 'failed', failureReason: args.reason.slice(0, 500),
      leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
    return { failed: true };
  },
});

export const forGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.query('bookings')
      .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', args.confirmationCode.trim().toUpperCase())).first();
    if (!booking?.guestId) return null;
    const guest = await ctx.db.get(booking.guestId);
    if (guest?.normalizedEmail !== args.email.trim().toLowerCase()) return null;
    return await ctx.db.query('consensusReceipts').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique();
  },
});

export const staffOverview = query({
  args: {},
  handler: async (ctx) => {
    if (process.env.DEMO_MODE !== 'true') await requireStaff(ctx);
    const receipts = await ctx.db.query('consensusReceipts').order('desc').take(50);
    return await Promise.all(receipts.map(async (receipt) => {
      const [booking, reward] = await Promise.all([
        ctx.db.get(receipt.bookingId),
        ctx.db.query('wavelengthRewards').withIndex('by_receipt', (q) => q.eq('receiptId', receipt._id)).unique(),
      ]);
      return { ...receipt, canonicalJson: undefined, proofBase64: undefined,
        confirmationCode: booking?.confirmationCode ?? 'unknown', rewardStatus: reward?.status,
        rewardSatsAmount: reward?.satsAmount, rewardFailureReason: reward?.failureReason };
    }));
  },
});

export const retry = mutation({
  args: { receiptId: v.id('consensusReceipts') },
  handler: async (ctx, args) => {
    if (process.env.DEMO_MODE !== 'true') await requireStaff(ctx);
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) throw new ConvexError('RECEIPT_NOT_FOUND');
    if (receipt.status !== 'failed') return { retried: false };
    await ctx.db.patch(receipt._id, { status: 'queued', failureReason: undefined, leaseToken: undefined,
      leaseExpiresAt: undefined, updatedAt: Date.now() });
    return { retried: true };
  },
});
