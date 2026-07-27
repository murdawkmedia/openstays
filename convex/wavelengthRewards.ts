import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { sha256HexOf } from './apiKeys';
import { CONSENSUS_REWARD_SATS, LEGACY_CONSENSUS_REWARD_SATS } from './rewardPolicy';
import {
  eligibilityEmailDigest,
  readPublicPolicy,
  verifyEligibilityToken,
} from './publicPolicy';

const LEASE_MS = 60_000;
const REWARD_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1_000;
const HEALTH_FRESH_MS = 60_000;

async function authenticatedBooking(ctx: any, confirmationCode: string, email: string) {
  const booking = await ctx.db.query('bookings')
    .withIndex('by_confirmationCode', (q: any) => q.eq('confirmationCode', confirmationCode.trim().toUpperCase())).first();
  if (!booking?.guestId) throw new ConvexError('BOOKING_NOT_FOUND');
  const guest = await ctx.db.get(booking.guestId);
  if (guest?.normalizedEmail !== email.trim().toLowerCase()) throw new ConvexError('BOOKING_NOT_FOUND');
  return booking;
}

export const submitInvoice = mutation({
  args: {
    confirmationCode: v.string(),
    email: v.string(),
    satsAmount: v.number(),
    bolt11: v.string(),
    expiresAt: v.number(),
    eligibilityToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await authenticatedBooking(ctx, args.confirmationCode, args.email);
    const reward = await ctx.db.query('wavelengthRewards')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique();
    if (!reward) throw new ConvexError('CONSENSUS_RECEIPT_NOT_SUBMITTED');
    if (reward.status === 'paid') return reward;
    const bolt11 = args.bolt11.trim();
    const now = Date.now();
    if (args.satsAmount !== CONSENSUS_REWARD_SATS || reward.satsAmount !== CONSENSUS_REWARD_SATS ||
      !bolt11.toLowerCase().startsWith('lntbs') || bolt11.length > 10_000 ||
      args.expiresAt <= now + 30_000 || args.expiresAt > now + 3_600_000) {
      throw new ConvexError('INVALID_SIGNET_REWARD_INVOICE');
    }

    const policy = readPublicPolicy(process.env);
    if (policy.liveMode) {
      if (!policy.rewardsEnabled) throw new ConvexError('WAVELENGTH_REWARDS_DISABLED');
      const signingKey = process.env.ELIGIBILITY_HMAC_SECRET ?? '';
      if (!args.eligibilityToken || !signingKey) {
        throw new ConvexError('REWARD_ELIGIBILITY_REQUIRED');
      }
      let eligibility;
      try {
        eligibility = await verifyEligibilityToken(
          args.eligibilityToken,
          { action: 'reward_claim', bookingId: String(booking._id) },
          signingKey,
          now,
        );
      } catch {
        throw new ConvexError('REWARD_ELIGIBILITY_INVALID');
      }
      if (
        eligibility.emailDigest
        !== await eligibilityEmailDigest(args.email.trim().toLowerCase(), signingKey)
      ) {
        throw new ConvexError('REWARD_ELIGIBILITY_INVALID');
      }

      const existingToken = await ctx.db.query('publicRewardClaims')
        .withIndex('by_tokenId', (q) => q.eq('tokenId', eligibility.jti))
        .unique();
      if (existingToken && existingToken.rewardId !== reward._id) {
        throw new ConvexError('REWARD_ELIGIBILITY_REPLAYED');
      }
      if (!existingToken) {
        const since = now - REWARD_LIMIT_WINDOW_MS;
        const [emailClaims, deviceClaims, networkClaims, accepted, paid, health] = await Promise.all([
          ctx.db.query('publicRewardClaims')
            .withIndex('by_email_claimedAt', (q) =>
              q.eq('emailDigest', eligibility.emailDigest).gte('claimedAt', since))
            .collect(),
          ctx.db.query('publicRewardClaims')
            .withIndex('by_device_claimedAt', (q) =>
              q.eq('deviceDigest', eligibility.deviceDigest).gte('claimedAt', since))
            .collect(),
          ctx.db.query('publicRewardClaims')
            .withIndex('by_network_claimedAt', (q) =>
              q.eq('networkDigest', eligibility.networkDigest).gte('claimedAt', since))
            .collect(),
          ctx.db.query('publicRewardClaims')
            .withIndex('by_status_claimedAt', (q) =>
              q.eq('status', 'accepted').gte('claimedAt', since))
            .collect(),
          ctx.db.query('publicRewardClaims')
            .withIndex('by_status_claimedAt', (q) =>
              q.eq('status', 'paid').gte('claimedAt', since))
            .collect(),
          ctx.db.query('bridgeHealth')
            .withIndex('by_service', (q) => q.eq('service', 'wavelength'))
            .unique(),
        ]);
        const active = (claims: typeof emailClaims) =>
          claims.some((claim) => claim.status === 'accepted' || claim.status === 'paid');
        if (active(emailClaims) || active(deviceClaims) || active(networkClaims)) {
          throw new ConvexError('REWARD_LIMIT_REACHED');
        }
        const reservedSats = [...accepted, ...paid]
          .reduce((sum, claim) => sum + claim.satsAmount, 0);
        if (
          policy.rewardDailyBudgetSats < CONSENSUS_REWARD_SATS
          || reservedSats + CONSENSUS_REWARD_SATS > policy.rewardDailyBudgetSats
        ) {
          throw new ConvexError('REWARD_DAILY_BUDGET_EXHAUSTED');
        }
        if (
          !health
          || health.status !== 'ready'
          || health.lastHeartbeatAt < now - HEALTH_FRESH_MS
          || (health.spendableSats ?? 0)
            < CONSENSUS_REWARD_SATS + policy.rewardMaxFeeSats
        ) {
          throw new ConvexError('WAVELENGTH_REWARD_UNAVAILABLE');
        }
        await ctx.db.insert('publicRewardClaims', {
          propertyId: reward.propertyId,
          bookingId: booking._id,
          rewardId: reward._id,
          receiptId: reward.receiptId,
          tokenId: eligibility.jti,
          emailDigest: eligibility.emailDigest,
          deviceDigest: eligibility.deviceDigest,
          networkDigest: eligibility.networkDigest,
          network: 'signet',
          satsAmount: CONSENSUS_REWARD_SATS,
          status: 'accepted',
          claimedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
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
      if (!reward.bolt11 || (reward.invoiceExpiresAt ?? 0) <= now + 30_000 || reward.network !== 'signet' || reward.satsAmount !== CONSENSUS_REWARD_SATS) {
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
      reward.network !== args.network || reward.satsAmount !== CONSENSUS_REWARD_SATS || args.satsAmount !== CONSENSUS_REWARD_SATS ||
      reward.bolt11 !== args.bolt11 || !args.merchantActivityId.trim() || !args.paymentHash.trim() ||
      (reward.merchantActivityId !== undefined && reward.merchantActivityId !== args.merchantActivityId.trim()) ||
      (reward.paymentHash !== undefined && reward.paymentHash !== args.paymentHash.trim())) {
      throw new ConvexError('WAVELENGTH_REWARD_MISMATCH');
    }
    const now = Date.now();
    await ctx.db.patch(reward._id, { status: 'paid', merchantActivityId: args.merchantActivityId.trim(),
      paymentHash: args.paymentHash.trim(), paidAt: now, updatedAt: now, leaseToken: undefined, leaseExpiresAt: undefined,
      failureReason: undefined });
    const claims = await ctx.db.query('publicRewardClaims')
      .withIndex('by_booking', (q) => q.eq('bookingId', reward.bookingId))
      .collect();
    for (const claim of claims) {
      if (claim.rewardId === reward._id && claim.status === 'accepted') {
        await ctx.db.patch(claim._id, {
          status: 'paid',
          paidAt: now,
          updatedAt: now,
        });
      }
    }
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
    if (!args.retryable) {
      const claims = await ctx.db.query('publicRewardClaims')
        .withIndex('by_booking', (q) => q.eq('bookingId', reward.bookingId))
        .collect();
      for (const claim of claims) {
        if (claim.rewardId === reward._id && claim.status === 'accepted') {
          await ctx.db.patch(claim._id, {
            status: 'failed',
            updatedAt: Date.now(),
          });
        }
      }
    }
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

export const upgradeLegacyRewards = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
    const rewards = await ctx.db.query('wavelengthRewards').take(limit);
    const now = Date.now();
    let upgraded = 0;
    for (const reward of rewards) {
      const inactive = reward.status === 'eligible' || reward.status === 'expired' || reward.status === 'failed';
      if (reward.satsAmount !== LEGACY_CONSENSUS_REWARD_SATS || !inactive ||
        reward.merchantActivityId !== undefined || reward.paymentHash !== undefined || reward.paidAt !== undefined) continue;
      await ctx.db.patch(reward._id, {
        satsAmount: CONSENSUS_REWARD_SATS,
        status: 'eligible',
        attemptCount: 0,
        bolt11: undefined,
        invoiceExpiresAt: undefined,
        merchantActivityId: undefined,
        paymentHash: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        failureReason: undefined,
        paidAt: undefined,
        updatedAt: now,
      });
      upgraded += 1;
    }
    return { scanned: rewards.length, upgraded };
  },
});
