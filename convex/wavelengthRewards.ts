import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { sha256HexOf } from './apiKeys';

const REWARD_SATS = 210 as const;
const LEASE_MS = 60_000;

async function authenticatedBooking(ctx: any, confirmationCode: string, email: string) {
  const booking = await ctx.db.query('bookings')
    .withIndex('by_confirmationCode', (q: any) => q.eq('confirmationCode', confirmationCode.trim().toUpperCase())).first();
  if (!booking?.guestId) throw new ConvexError('BOOKING_NOT_FOUND');
  const guest = await ctx.db.get(booking.guestId);
  if (guest?.normalizedEmail !== email.trim().toLowerCase()) throw new ConvexError('BOOKING_NOT_FOUND');
  return booking;
}

export const submitInvoice = mutation({
  args: { confirmationCode: v.string(), email: v.string(), bolt11: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const booking = await authenticatedBooking(ctx, args.confirmationCode, args.email);
    const reward = await ctx.db.query('wavelengthRewards')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique();
    if (!reward) throw new ConvexError('CONSENSUS_RECEIPT_NOT_SUBMITTED');
    if (reward.status === 'paid') return reward;
    const bolt11 = args.bolt11.trim();
    const now = Date.now();
    if (!bolt11.toLowerCase().startsWith('lntbs') || bolt11.length > 10_000 || args.expiresAt <= now + 30_000 || args.expiresAt > now + 3_600_000) {
      throw new ConvexError('INVALID_SIGNET_REWARD_INVOICE');
    }
    if (reward.status === 'invoice_ready' || reward.status === 'paying') {
      if (reward.bolt11 === bolt11) return reward;
      throw new ConvexError('WAVELENGTH_REWARD_ALREADY_IN_PROGRESS');
    }
    if (!['eligible', 'expired', 'failed'].includes(reward.status)) throw new ConvexError('WAVELENGTH_REWARD_NOT_ELIGIBLE');
    await ctx.db.patch(reward._id, { status: 'invoice_ready', bolt11, invoiceExpiresAt: args.expiresAt,
      attemptCount: reward.attemptCount + 1, failureReason: undefined, merchantActivityId: undefined,
      paymentHash: undefined, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now });
    return (await ctx.db.get(reward._id))!;
  },
});

export const claimPending = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 25);
    const ready = await ctx.db.query('wavelengthRewards')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'invoice_ready')).take(limit);
    const stale = (await ctx.db.query('wavelengthRewards')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'paying')).take(limit))
      .filter((reward) => (reward.leaseExpiresAt ?? 0) <= now);
    const claimed = [];
    for (const reward of [...ready, ...stale].slice(0, limit)) {
      if (!reward.bolt11 || (reward.invoiceExpiresAt ?? 0) <= now + 30_000 || reward.network !== 'signet' || reward.satsAmount !== REWARD_SATS) {
        await ctx.db.patch(reward._id, { status: 'expired', failureReason: 'invoice expired', updatedAt: now,
          leaseToken: undefined, leaseExpiresAt: undefined });
        continue;
      }
      const leaseToken = await sha256HexOf(`${reward._id}:${now}:${reward.attemptCount}`);
      await ctx.db.patch(reward._id, { status: 'paying', leaseToken, leaseExpiresAt: now + LEASE_MS, updatedAt: now });
      claimed.push({ ...reward, status: 'paying' as const, leaseToken, leaseExpiresAt: now + LEASE_MS, updatedAt: now });
    }
    return claimed;
  },
});

export const markPaid = internalMutation({
  args: { rewardId: v.id('wavelengthRewards'), leaseToken: v.string(), network: v.literal('signet'), satsAmount: v.number(),
    bolt11: v.string(), merchantActivityId: v.string(), paymentHash: v.string() },
  handler: async (ctx, args) => {
    const reward = await ctx.db.get(args.rewardId);
    if (!reward) throw new ConvexError('WAVELENGTH_REWARD_NOT_FOUND');
    if (reward.status === 'paid') return { paid: false };
    if (reward.status !== 'paying' || reward.leaseToken !== args.leaseToken || (reward.leaseExpiresAt ?? 0) <= Date.now() ||
      reward.network !== args.network || reward.satsAmount !== REWARD_SATS || args.satsAmount !== REWARD_SATS ||
      reward.bolt11 !== args.bolt11 || !args.merchantActivityId.trim() || !args.paymentHash.trim() ||
      (reward.merchantActivityId !== undefined && reward.merchantActivityId !== args.merchantActivityId.trim()) ||
      (reward.paymentHash !== undefined && reward.paymentHash !== args.paymentHash.trim())) {
      throw new ConvexError('WAVELENGTH_REWARD_MISMATCH');
    }
    const now = Date.now();
    await ctx.db.patch(reward._id, { status: 'paid', merchantActivityId: args.merchantActivityId.trim(),
      paymentHash: args.paymentHash.trim(), paidAt: now, updatedAt: now, leaseToken: undefined, leaseExpiresAt: undefined,
      failureReason: undefined });
    return { paid: true };
  },
});

export const markDispatched = internalMutation({
  args: { rewardId: v.id('wavelengthRewards'), leaseToken: v.string(), merchantActivityId: v.string(), paymentHash: v.string() },
  handler: async (ctx, args) => {
    const reward = await ctx.db.get(args.rewardId);
    if (!reward) throw new ConvexError('WAVELENGTH_REWARD_NOT_FOUND');
    if (reward.status !== 'paying' || reward.leaseToken !== args.leaseToken || !args.merchantActivityId.trim() || !args.paymentHash.trim()) {
      throw new ConvexError('WAVELENGTH_REWARD_MISMATCH');
    }
    await ctx.db.patch(reward._id, { merchantActivityId: args.merchantActivityId.trim(), paymentHash: args.paymentHash.trim(), updatedAt: Date.now() });
    return { dispatched: true };
  },
});

export const markFailed = internalMutation({
  args: { rewardId: v.id('wavelengthRewards'), leaseToken: v.string(), reason: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const reward = await ctx.db.get(args.rewardId);
    if (!reward) throw new ConvexError('WAVELENGTH_REWARD_NOT_FOUND');
    if (reward.status !== 'paying' || reward.leaseToken !== args.leaseToken) throw new ConvexError('STALE_REWARD_LEASE');
    await ctx.db.patch(reward._id, { status: args.retryable ? 'invoice_ready' : 'failed', failureReason: args.reason.slice(0, 500),
      leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
    return { failed: true };
  },
});

export const forGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    try {
      const booking = await authenticatedBooking(ctx, args.confirmationCode, args.email);
      return await ctx.db.query('wavelengthRewards').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique();
    } catch {
      return null;
    }
  },
});
