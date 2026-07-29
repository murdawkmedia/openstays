import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { sha256HexOf } from './apiKeys';
import { requireStaff, writeAudit } from './staff';
import {
  calculateTreasuryPreview,
  validateTreasuryQuote,
  type TreasuryPreviewInput,
} from './treasuryPolicy';

const LEASE_MS = 120_000;
const ACTIVE_REWARD_STATUSES = [
  'eligible',
  'invoice_ready',
  'paying',
  'expired',
  'failed',
] as const;
const ACTIVE_SWEEP_STATUSES = [
  'prepared',
  'dispatched',
  'reconciliation_required',
] as const;

const treasuryConfigArgs = {
  enabled: v.boolean(),
  dryRun: v.boolean(),
  network: v.string(),
  destinationAddress: v.string(),
  spendableSats: v.number(),
  baseReserveSats: v.number(),
  minSweepSats: v.number(),
  cooldownMs: v.number(),
  treasuryFeeAllowanceSats: v.number(),
  rewardFeeAllowanceSats: v.number(),
};

function safeReason(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
    || 'TREASURY_OPERATION_FAILED';
}

function configuredSats(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

async function activeSweep(ctx: any) {
  for (const status of ACTIVE_SWEEP_STATUSES) {
    const row = await ctx.db.query('treasurySweeps')
      .withIndex('by_status_createdAt', (q: any) => q.eq('status', status))
      .order('asc')
      .first();
    if (row) return row;
  }
  return null;
}

async function latestCompletedAt(ctx: any): Promise<number | undefined> {
  const row = await ctx.db.query('treasurySweeps')
    .withIndex('by_status_createdAt', (q: any) => q.eq('status', 'completed'))
    .order('desc')
    .first();
  return row?.completedAt;
}

async function treasuryLiabilities(
  ctx: any,
  rewardFeeAllowanceSats: number,
): Promise<{ rewardLiabilitySats: number; refundLiabilitySats: number }> {
  let rewardLiabilitySats = 0;
  for (const status of ACTIVE_REWARD_STATUSES) {
    const rewards = await ctx.db.query('wavelengthRewards')
      .withIndex('by_status_createdAt', (q: any) => q.eq('status', status))
      .collect();
    for (const reward of rewards) {
      if (reward.network !== 'signet') continue;
      rewardLiabilitySats += reward.satsAmount + rewardFeeAllowanceSats;
    }
  }

  let refundLiabilitySats = 0;
  const openRefunds = await ctx.db.query('refundCases')
    .withIndex('by_status_createdAt', (q: any) => q.eq('status', 'open'))
    .collect();
  for (const refundCase of openRefunds) {
    const payment = await ctx.db.get(refundCase.paymentId);
    if (!payment || payment.provider !== 'wavelength' || payment.amountCents <= 0) continue;
    const request = await ctx.db.query('wavelengthRequests')
      .withIndex('by_payment', (q: any) => q.eq('paymentId', payment._id))
      .unique();
    if (!request || request.network !== 'signet' || request.satsAmount <= 0) continue;
    refundLiabilitySats += Math.ceil(
      request.satsAmount * Math.min(refundCase.amountCents, payment.amountCents)
      / payment.amountCents,
    );
  }
  return { rewardLiabilitySats, refundLiabilitySats };
}

async function previewFor(ctx: any, args: any, unresolvedTransfer?: boolean) {
  const now = Date.now();
  const liabilities = await treasuryLiabilities(ctx, args.rewardFeeAllowanceSats);
  const existing = unresolvedTransfer === undefined ? await activeSweep(ctx) : null;
  const policyInput: TreasuryPreviewInput = {
    enabled: args.enabled,
    dryRun: args.dryRun,
    network: args.network,
    destinationAddress: args.destinationAddress,
    spendableSats: args.spendableSats,
    baseReserveSats: args.baseReserveSats,
    rewardLiabilitySats: liabilities.rewardLiabilitySats,
    refundLiabilitySats: liabilities.refundLiabilitySats,
    feeAllowanceSats: args.treasuryFeeAllowanceSats,
    minSweepSats: args.minSweepSats,
    cooldownMs: args.cooldownMs,
    lastCompletedAt: await latestCompletedAt(ctx),
    unresolvedTransfer: unresolvedTransfer ?? Boolean(existing),
    now,
  };
  return {
    ...calculateTreasuryPreview(policyInput),
    ...liabilities,
    spendableSats: args.spendableSats,
    baseReserveSats: args.baseReserveSats,
    destinationAddress: args.destinationAddress,
    network: args.network,
    dryRun: args.dryRun,
    latestTransfer: existing,
  };
}

export const preview = internalQuery({
  args: treasuryConfigArgs,
  handler: async (ctx, args) => await previewFor(ctx, args),
});

export const claim = internalMutation({
  args: treasuryConfigArgs,
  handler: async (ctx, args) => {
    const existing = await activeSweep(ctx);
    const now = Date.now();
    if (existing?.status === 'reconciliation_required') {
      return { claimed: false, reason: 'reconciliation_required', sweep: existing };
    }
    if (existing?.status === 'dispatched') {
      return { claimed: true, resumed: true, sweep: existing };
    }
    if (existing?.status === 'prepared') {
      if ((existing.leaseExpiresAt ?? 0) > now) {
        return { claimed: false, reason: 'lease_active', sweep: existing };
      }
      const leaseToken = await sha256HexOf(`${existing._id}:${now}:${existing.updatedAt}`);
      await ctx.db.patch(existing._id, {
        leaseToken,
        leaseExpiresAt: now + LEASE_MS,
        updatedAt: now,
      });
      return {
        claimed: true,
        resumed: true,
        sweep: {
          ...existing,
          leaseToken,
          leaseExpiresAt: now + LEASE_MS,
          updatedAt: now,
        },
      };
    }

    const calculated = await previewFor(ctx, args, false);
    if (!calculated.canClaim) {
      return { claimed: false, reason: calculated.status, preview: calculated };
    }
    const leaseToken = await sha256HexOf(
      `${args.destinationAddress}:${args.spendableSats}:${now}`,
    );
    const sweepId = await ctx.db.insert('treasurySweeps', {
      network: 'signet',
      destinationAddress: args.destinationAddress.trim(),
      balanceSnapshotSats: args.spendableSats,
      baseReserveSats: args.baseReserveSats,
      rewardLiabilitySats: calculated.rewardLiabilitySats,
      refundLiabilitySats: calculated.refundLiabilitySats,
      requiredReserveSats: calculated.requiredReserveSats,
      feeAllowanceSats: args.treasuryFeeAllowanceSats,
      authorizedAmountSats: calculated.authorizedAmountSats,
      status: 'prepared',
      leaseToken,
      leaseExpiresAt: now + LEASE_MS,
      createdAt: now,
      updatedAt: now,
    });
    return {
      claimed: true,
      resumed: false,
      sweep: await ctx.db.get(sweepId),
    };
  },
});

export const markDispatched = internalMutation({
  args: {
    sweepId: v.id('treasurySweeps'),
    leaseToken: v.string(),
    network: v.literal('signet'),
    destinationAddress: v.string(),
    rail: v.string(),
    spendableSats: v.number(),
    preparedAmountSats: v.number(),
    preparedFeeSats: v.number(),
    preparedTotalOutflowSats: v.number(),
    maxFeeSats: v.number(),
    expiresAtUnix: v.number(),
    sendIntentId: v.string(),
    merchantActivityId: v.string(),
  },
  handler: async (ctx, args) => {
    const sweep = await ctx.db.get(args.sweepId);
    if (!sweep) throw new ConvexError('TREASURY_SWEEP_NOT_FOUND');
    const sendIntentId = args.sendIntentId.trim();
    const merchantActivityId = args.merchantActivityId.trim();
    if (sweep.status === 'dispatched') {
      if (
        sweep.sendIntentId === sendIntentId
        && sweep.merchantActivityId === merchantActivityId
        && sweep.preparedAmountSats === args.preparedAmountSats
        && sweep.preparedTotalOutflowSats === args.preparedTotalOutflowSats
      ) {
        return { dispatched: false, duplicate: true };
      }
      throw new ConvexError('TREASURY_DISPATCH_MISMATCH');
    }
    if (
      sweep.status !== 'prepared'
      || sweep.leaseToken !== args.leaseToken
      || (sweep.leaseExpiresAt ?? 0) <= Date.now()
      || !sendIntentId
      || !merchantActivityId
      || args.spendableSats !== sweep.balanceSnapshotSats
      || args.maxFeeSats !== sweep.feeAllowanceSats
    ) {
      throw new ConvexError('STALE_TREASURY_LEASE');
    }
    const validation = validateTreasuryQuote({
      network: args.network,
      expectedDestination: sweep.destinationAddress,
      actualDestination: args.destinationAddress,
      rail: args.rail,
      preparedAmountSats: args.preparedAmountSats,
      expectedFeeSats: args.preparedFeeSats,
      expectedTotalOutflowSats: args.preparedTotalOutflowSats,
      totalOutflowKnown: true,
      maxFeeSats: sweep.feeAllowanceSats,
      spendableSats: sweep.balanceSnapshotSats,
      requiredReserveSats: sweep.requiredReserveSats,
      authorizedAmountSats: sweep.authorizedAmountSats,
      expiresAtUnix: args.expiresAtUnix,
      now: Date.now(),
    });
    if (!validation.ok) throw new ConvexError(validation.code);
    const now = Date.now();
    await ctx.db.patch(sweep._id, {
      status: 'dispatched',
      preparedAmountSats: args.preparedAmountSats,
      preparedFeeSats: args.preparedFeeSats,
      preparedTotalOutflowSats: args.preparedTotalOutflowSats,
      sendIntentId,
      merchantActivityId,
      dispatchedAt: now,
      updatedAt: now,
    });
    return { dispatched: true, duplicate: false };
  },
});

export const markCompleted = internalMutation({
  args: {
    sweepId: v.id('treasurySweeps'),
    leaseToken: v.string(),
    network: v.literal('signet'),
    destinationAddress: v.string(),
    merchantActivityId: v.string(),
    sendIntentId: v.string(),
    actualAmountSats: v.number(),
    actualFeeSats: v.number(),
    actualTotalOutflowSats: v.number(),
    transactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sweep = await ctx.db.get(args.sweepId);
    if (!sweep) throw new ConvexError('TREASURY_SWEEP_NOT_FOUND');
    const transactionId = args.transactionId?.trim() || undefined;
    const exact = (
      sweep.network === args.network
      && sweep.destinationAddress === args.destinationAddress.trim()
      && sweep.merchantActivityId === args.merchantActivityId.trim()
      && sweep.sendIntentId === args.sendIntentId.trim()
      && sweep.preparedAmountSats === args.actualAmountSats
      && args.actualAmountSats > 0
      && args.actualFeeSats >= 0
      && args.actualTotalOutflowSats === args.actualAmountSats + args.actualFeeSats
      && args.actualTotalOutflowSats
        <= sweep.balanceSnapshotSats - sweep.requiredReserveSats
    );
    if (sweep.status === 'completed') {
      if (
        exact
        && sweep.actualAmountSats === args.actualAmountSats
        && sweep.actualFeeSats === args.actualFeeSats
        && sweep.actualTotalOutflowSats === args.actualTotalOutflowSats
        && sweep.transactionId === transactionId
      ) {
        return { completed: false, duplicate: true };
      }
      throw new ConvexError('TREASURY_COMPLETION_MISMATCH');
    }
    if (
      sweep.status !== 'dispatched'
      || sweep.leaseToken !== args.leaseToken
      || !exact
    ) {
      throw new ConvexError('TREASURY_COMPLETION_MISMATCH');
    }
    const now = Date.now();
    await ctx.db.patch(sweep._id, {
      status: 'completed',
      actualAmountSats: args.actualAmountSats,
      actualFeeSats: args.actualFeeSats,
      actualTotalOutflowSats: args.actualTotalOutflowSats,
      transactionId,
      completedAt: now,
      updatedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      failureReason: undefined,
    });
    return { completed: true, duplicate: false };
  },
});

export const markFailed = internalMutation({
  args: {
    sweepId: v.id('treasurySweeps'),
    leaseToken: v.string(),
    reason: v.string(),
    ambiguous: v.boolean(),
    merchantActivityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sweep = await ctx.db.get(args.sweepId);
    if (!sweep) throw new ConvexError('TREASURY_SWEEP_NOT_FOUND');
    if (sweep.status === 'completed' || sweep.status === 'failed') {
      return {
        failed: false,
        reconciliationRequired: false,
      };
    }
    if (
      !['prepared', 'dispatched', 'reconciliation_required'].includes(sweep.status)
      || sweep.leaseToken !== args.leaseToken
    ) {
      throw new ConvexError('STALE_TREASURY_LEASE');
    }
    const reportedActivityId = args.merchantActivityId?.trim();
    const exactTerminalFailure =
      sweep.status === 'dispatched'
      && args.ambiguous === false
      && Boolean(reportedActivityId)
      && reportedActivityId === sweep.merchantActivityId;
    const reconciliationRequired =
      args.ambiguous
      || sweep.status === 'reconciliation_required'
      || (sweep.status === 'dispatched' && !exactTerminalFailure);
    await ctx.db.patch(sweep._id, {
      status: reconciliationRequired ? 'reconciliation_required' : 'failed',
      failureReason: safeReason(args.reason),
      updatedAt: Date.now(),
      leaseToken: reconciliationRequired ? sweep.leaseToken : undefined,
      leaseExpiresAt: reconciliationRequired ? sweep.leaseExpiresAt : undefined,
    });
    return { failed: true, reconciliationRequired };
  },
});

export const staffOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const baseReserveSats = configuredSats('WAVELENGTH_TREASURY_RESERVE_SATS', 14_520);
    const treasuryFeeAllowanceSats = configuredSats(
      'WAVELENGTH_TREASURY_MAX_FEE_SATS',
      1_000,
    );
    const rewardFeeAllowanceSats = configuredSats(
      'WAVELENGTH_REWARD_MAX_FEE_SATS',
      210,
    );
    const [health, sweeps, liabilities] = await Promise.all([
      ctx.db.query('bridgeHealth')
        .withIndex('by_service', (q) => q.eq('service', 'wavelength'))
        .unique(),
      ctx.db.query('treasurySweeps').order('desc').take(20),
      treasuryLiabilities(ctx, rewardFeeAllowanceSats),
    ]);
    const spendableSats = health?.spendableSats ?? 0;
    const requiredReserveSats =
      Math.max(baseReserveSats, liabilities.rewardLiabilitySats)
      + liabilities.refundLiabilitySats;
    return {
      enabled: process.env.WAVELENGTH_TREASURY_ENABLED === 'true',
      dryRun: process.env.WAVELENGTH_TREASURY_DRY_RUN !== 'false',
      destinationAddress: process.env.WAVELENGTH_TREASURY_ADDRESS?.trim(),
      baseReserveSats,
      requiredReserveSats,
      sweepableBalanceSats: Math.max(
        0,
        spendableSats - requiredReserveSats - treasuryFeeAllowanceSats,
      ),
      spendableSats,
      ...liabilities,
      sweeps,
    };
  },
});

export const resolveReconciliation = mutation({
  args: {
    sweepId: v.id('treasurySweeps'),
    resolution: v.union(v.literal('failed'), v.literal('completed')),
    transactionId: v.optional(v.string()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { profile } = await requireStaff(ctx);
    if (profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');
    const sweep = await ctx.db.get(args.sweepId);
    if (!sweep || sweep.status !== 'reconciliation_required') {
      throw new ConvexError('TREASURY_RECONCILIATION_NOT_FOUND');
    }
    const note = safeReason(args.note);
    const now = Date.now();
    if (args.resolution === 'completed') {
      const transactionId = args.transactionId?.trim();
      if (!transactionId) throw new ConvexError('TREASURY_TRANSACTION_ID_REQUIRED');
      if (
        !sweep.preparedAmountSats
        || sweep.preparedFeeSats === undefined
        || !sweep.preparedTotalOutflowSats
        || !sweep.merchantActivityId
      ) {
        throw new ConvexError('TREASURY_COMPLETION_EVIDENCE_REQUIRED');
      }
      await ctx.db.patch(sweep._id, {
        status: 'completed',
        actualAmountSats: sweep.preparedAmountSats,
        actualFeeSats: sweep.preparedFeeSats,
        actualTotalOutflowSats: sweep.preparedTotalOutflowSats,
        transactionId,
        completedAt: now,
        updatedAt: now,
        failureReason: `Owner reconciliation by ${profile.name}: ${note}`,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
      });
    } else {
      await ctx.db.patch(sweep._id, {
        status: 'failed',
        updatedAt: now,
        failureReason: `Owner reconciliation by ${profile.name}: ${note}`,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
      });
    }
    await writeAudit(
      ctx,
      'treasury.reconcile',
      `${args.resolution} treasury sweep ${sweep._id}`,
    );
    return { resolved: true, status: args.resolution };
  },
});
