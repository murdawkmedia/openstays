/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const DESTINATION = 'tb1pytpd7rg5nf08ty0mn7wscvplgztnggzhz4kgr7c32dy2cs9r6mqst883u6';

const config = {
  enabled: true,
  dryRun: false,
  network: 'signet',
  destinationAddress: DESTINATION,
  spendableSats: 40_000,
  baseReserveSats: 14_520,
  minSweepSats: 5_000,
  cooldownMs: 86_400_000,
  treasuryFeeAllowanceSats: 1_000,
  rewardFeeAllowanceSats: 210,
};

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|treasury-test-session` };
}

afterEach(() => vi.unstubAllEnvs());

async function seedLiabilities(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons',
      slug: 'consensus-commons',
      timezone: 'America/Toronto',
      currency: 'CAD',
      taxRateBps: 0,
      taxLabel: 'HST',
      email: 'staff@example.test',
      phone: '',
      address: 'Toronto',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'Node',
      slug: 'node',
      kind: 'room',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 2,
      amenities: [],
      comingSoon: false,
      sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'Node 1',
      slug: 'node-1',
      status: 'active',
      icalExportToken: 'treasury-test',
      icalImports: [],
      sortOrder: 1,
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId,
      unitTypeId,
      unitId,
      checkIn: '2026-08-20',
      checkOut: '2026-08-21',
      nights: 1,
      adults: 1,
      children: 0,
      status: 'confirmed',
      source: 'demo',
      confirmationCode: 'OS-TREASURY',
      statusHistory: [{ status: 'confirmed', ts: now }],
      notes: [],
      createdAt: now,
      updatedAt: now,
    });
    const paymentId = await ctx.db.insert('payments', {
      propertyId,
      bookingId,
      provider: 'wavelength',
      amountCents: 100,
      gstCents: 0,
      currency: 'CAD',
      status: 'paid',
      providerPaymentId: 'treasury_payment',
      refunds: [],
      createdAt: now,
      paidAt: now,
    });
    await ctx.db.insert('wavelengthRequests', {
      propertyId,
      bookingId,
      paymentId,
      quotedAmountCents: 100,
      currency: 'CAD',
      network: 'signet',
      satsAmount: 1_000,
      expiresAt: now + 600_000,
      status: 'settled',
      createdAt: now,
      updatedAt: now,
      settledAt: now,
      paymentHash: 'treasury_payment',
    });
    await ctx.db.insert('refundCases', {
      propertyId,
      paymentId,
      bookingId,
      amountCents: 50,
      currency: 'CAD',
      reason: 'guest_requested_public_contribution_refund',
      status: 'open',
      createdAt: now,
      updatedAt: now,
    });
    const receiptId = await ctx.db.insert('consensusReceipts', {
      propertyId,
      bookingId,
      publicId: 'receipt-treasury',
      schemaVersion: 'openstays.consensus-receipt.v1',
      canonicalJson: '{}',
      sha256: 'a'.repeat(64),
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
    });
    await ctx.db.insert('wavelengthRewards', {
      propertyId,
      bookingId,
      receiptId,
      network: 'signet',
      satsAmount: 1_000,
      status: 'eligible',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { propertyId, bookingId };
  });
}

describe('Signet treasury state machine', () => {
  it('snapshots reward and refund liabilities before creating one leased transfer', async () => {
    const t = convexTest(schema, modules);
    await seedLiabilities(t);

    const preview = await t.query((internal as any).treasury.preview, config);
    expect(preview).toMatchObject({
      status: 'eligible',
      canClaim: true,
      rewardLiabilitySats: 1_210,
      refundLiabilitySats: 500,
      requiredReserveSats: 15_020,
      authorizedAmountSats: 23_980,
    });

    const claimed = await t.mutation((internal as any).treasury.claim, config);
    expect(claimed.claimed).toBe(true);
    expect(claimed.sweep).toMatchObject({
      network: 'signet',
      destinationAddress: DESTINATION,
      balanceSnapshotSats: 40_000,
      baseReserveSats: 14_520,
      rewardLiabilitySats: 1_210,
      refundLiabilitySats: 500,
      requiredReserveSats: 15_020,
      authorizedAmountSats: 23_980,
      status: 'prepared',
    });
    expect(claimed.sweep.leaseToken).toBeTruthy();

    const concurrent = await t.mutation((internal as any).treasury.claim, config);
    expect(concurrent).toMatchObject({ claimed: false, reason: 'lease_active' });
    expect(await t.run((ctx) => ctx.db.query('treasurySweeps').collect())).toHaveLength(1);
  });

  it('does not create rows while disabled, dry-running, below threshold, or cooling down', async () => {
    const t = convexTest(schema, modules);
    await seedLiabilities(t);
    await expect(t.mutation((internal as any).treasury.claim, {
      ...config,
      enabled: false,
    })).resolves.toMatchObject({ claimed: false, reason: 'disabled' });
    await expect(t.mutation((internal as any).treasury.claim, {
      ...config,
      dryRun: true,
    })).resolves.toMatchObject({ claimed: false, reason: 'dry_run' });
    await expect(t.mutation((internal as any).treasury.claim, {
      ...config,
      spendableSats: 20_000,
    })).resolves.toMatchObject({ claimed: false, reason: 'below_minimum' });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('treasurySweeps', {
        network: 'signet',
        destinationAddress: DESTINATION,
        balanceSnapshotSats: 30_000,
        baseReserveSats: 14_520,
        rewardLiabilitySats: 0,
        refundLiabilitySats: 0,
        requiredReserveSats: 14_520,
        feeAllowanceSats: 1_000,
        authorizedAmountSats: 10_000,
        status: 'completed',
        actualAmountSats: 10_000,
        actualFeeSats: 100,
        actualTotalOutflowSats: 10_100,
        merchantActivityId: 'activity_previous',
        transactionId: 'tx_previous',
        createdAt: now - 1_000,
        updatedAt: now,
        completedAt: now,
      });
    });
    await expect(t.mutation((internal as any).treasury.claim, config))
      .resolves.toMatchObject({ claimed: false, reason: 'cooldown' });
    expect(await t.run((ctx) => ctx.db.query('treasurySweeps').collect())).toHaveLength(1);
  });

  it('validates dispatch, requires exact completion, and makes replays no-ops', async () => {
    const t = convexTest(schema, modules);
    await seedLiabilities(t);
    const { sweep } = await t.mutation((internal as any).treasury.claim, config);
    const dispatch = {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      network: 'signet',
      destinationAddress: DESTINATION,
      rail: 'onchain',
      spendableSats: 40_000,
      preparedAmountSats: 23_980,
      preparedFeeSats: 300,
      preparedTotalOutflowSats: 24_280,
      maxFeeSats: 1_000,
      expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
      sendIntentId: 'intent_treasury_1',
      merchantActivityId: 'activity_treasury_1',
    };
    await expect(t.mutation((internal as any).treasury.markDispatched, {
      ...dispatch,
      destinationAddress: `${DESTINATION}x`,
    })).rejects.toThrow('TREASURY_DESTINATION_MISMATCH');
    await expect(t.mutation((internal as any).treasury.markDispatched, {
      ...dispatch,
      preparedFeeSats: 1_001,
      preparedTotalOutflowSats: 24_981,
    })).rejects.toThrow('TREASURY_FEE_MISMATCH');

    await expect(t.mutation((internal as any).treasury.markDispatched, dispatch))
      .resolves.toEqual({ dispatched: true, duplicate: false });
    await expect(t.mutation((internal as any).treasury.markDispatched, dispatch))
      .resolves.toEqual({ dispatched: false, duplicate: true });

    const completion = {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      network: 'signet',
      destinationAddress: DESTINATION,
      merchantActivityId: 'activity_treasury_1',
      sendIntentId: 'intent_treasury_1',
      actualAmountSats: 23_980,
      actualFeeSats: 300,
      actualTotalOutflowSats: 24_280,
      transactionId: 'signet_tx_1',
    };
    await expect(t.mutation((internal as any).treasury.markCompleted, {
      ...completion,
      actualAmountSats: 23_979,
    })).rejects.toThrow('TREASURY_COMPLETION_MISMATCH');
    await expect(t.mutation((internal as any).treasury.markCompleted, completion))
      .resolves.toEqual({ completed: true, duplicate: false });
    await expect(t.mutation((internal as any).treasury.markCompleted, completion))
      .resolves.toEqual({ completed: false, duplicate: true });
  });

  it('turns ambiguous post-dispatch failures into a reconciliation block', async () => {
    const t = convexTest(schema, modules);
    await seedLiabilities(t);
    const { sweep } = await t.mutation((internal as any).treasury.claim, config);
    await t.mutation((internal as any).treasury.markDispatched, {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      network: 'signet',
      destinationAddress: DESTINATION,
      rail: 'onchain',
      spendableSats: 40_000,
      preparedAmountSats: 23_980,
      preparedFeeSats: 300,
      preparedTotalOutflowSats: 24_280,
      maxFeeSats: 1_000,
      expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
      sendIntentId: 'intent_ambiguous',
      merchantActivityId: 'activity_ambiguous',
    });
    await expect(t.mutation((internal as any).treasury.markFailed, {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      reason: 'network failed after dispatch',
      ambiguous: true,
    })).resolves.toEqual({ failed: true, reconciliationRequired: true });
    expect(await t.run((ctx) => ctx.db.get(sweep._id))).toMatchObject({
      status: 'reconciliation_required',
      failureReason: 'network failed after dispatch',
    });
    await expect(t.mutation((internal as any).treasury.claim, config))
      .resolves.toMatchObject({ claimed: false, reason: 'reconciliation_required' });
  });

  it('accepts an exact terminal failed activity without creating an ambiguity block', async () => {
    const t = convexTest(schema, modules);
    await seedLiabilities(t);
    const { sweep } = await t.mutation((internal as any).treasury.claim, config);
    await t.mutation((internal as any).treasury.markDispatched, {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      network: 'signet',
      destinationAddress: DESTINATION,
      rail: 'onchain',
      spendableSats: 40_000,
      preparedAmountSats: 23_980,
      preparedFeeSats: 300,
      preparedTotalOutflowSats: 24_280,
      maxFeeSats: 1_000,
      expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
      sendIntentId: 'intent_failed',
      merchantActivityId: 'activity_failed',
    });
    await expect(t.mutation((internal as any).treasury.markFailed, {
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      reason: 'authoritative activity failed',
      ambiguous: false,
      merchantActivityId: 'activity_failed',
    })).resolves.toEqual({ failed: true, reconciliationRequired: false });
    expect(await t.run((ctx) => ctx.db.get(sweep._id))).toMatchObject({
      status: 'failed',
      failureReason: 'authoritative activity failed',
    });
  });
});

describe('private treasury operations', () => {
  it('keeps the overview staff-only and reconciliation owner-only', async () => {
    const t = convexTest(schema, modules);
    await expect(t.query((api as any).treasury.staffOverview, {}))
      .rejects.toThrow('UNAUTHENTICATED');
    const { ownerId, staffId, sweepId } = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert('users', { email: 'owner@example.test', name: 'Owner' });
      const staffId = await ctx.db.insert('users', { email: 'staff@example.test', name: 'Staff' });
      await ctx.db.insert('staffProfiles', {
        userId: ownerId,
        name: 'Owner',
        role: 'owner',
        active: true,
        createdAt: now,
      });
      await ctx.db.insert('staffProfiles', {
        userId: staffId,
        name: 'Staff',
        role: 'staff',
        active: true,
        createdAt: now,
      });
      const sweepId = await ctx.db.insert('treasurySweeps', {
        network: 'signet',
        destinationAddress: DESTINATION,
        balanceSnapshotSats: 40_000,
        baseReserveSats: 14_520,
        rewardLiabilitySats: 0,
        refundLiabilitySats: 0,
        requiredReserveSats: 14_520,
        feeAllowanceSats: 1_000,
        authorizedAmountSats: 24_480,
        preparedAmountSats: 24_480,
        preparedFeeSats: 300,
        preparedTotalOutflowSats: 24_780,
        sendIntentId: 'intent_owner_review',
        merchantActivityId: 'activity_owner_review',
        status: 'reconciliation_required',
        leaseToken: 'lease_owner_review',
        leaseExpiresAt: now + 60_000,
        failureReason: 'ambiguous dispatch',
        createdAt: now,
        updatedAt: now,
      });
      return { ownerId, staffId, sweepId };
    });

    const asStaff = t.withIdentity(identityFor(staffId));
    await expect(asStaff.query((api as any).treasury.staffOverview, {}))
      .resolves.toMatchObject({
        baseReserveSats: 14_520,
        requiredReserveSats: 14_520,
        sweepableBalanceSats: 0,
        enabled: false,
        dryRun: true,
        sweeps: [{ status: 'reconciliation_required' }],
      });
    await expect(asStaff.mutation((api as any).treasury.resolveReconciliation, {
      sweepId,
      resolution: 'failed',
      note: 'Reviewed daemon activity and confirmed no transfer.',
    })).rejects.toThrow('OWNER_ONLY');

    const asOwner = t.withIdentity(identityFor(ownerId));
    await expect(asOwner.mutation(
      (api as any).treasury.resolveReconciliation,
      {
        sweepId,
        resolution: 'completed',
        note: 'Outgoing activity completed.',
      },
    )).rejects.toThrow('TREASURY_TRANSACTION_ID_REQUIRED');

    await expect(asOwner.mutation(
      (api as any).treasury.resolveReconciliation,
      {
        sweepId,
        resolution: 'failed',
        note: 'Reviewed daemon activity and confirmed no transfer.',
      },
    )).resolves.toEqual({ resolved: true, status: 'failed' });
  });
});

describe('Signet treasury HTTP bridge', () => {
  it('protects preview and every mutation with the Wavelength bridge token', async () => {
    vi.stubEnv('WAVELENGTH_BRIDGE_TOKEN', 'treasury-secret');
    const t = convexTest(schema, modules);
    const query = new URLSearchParams({
      enabled: 'true',
      dryRun: 'true',
      network: 'signet',
      destinationAddress: DESTINATION,
      spendableSats: '40000',
      baseReserveSats: '14520',
      minSweepSats: '5000',
      cooldownMs: '86400000',
      treasuryFeeAllowanceSats: '1000',
      rewardFeeAllowanceSats: '210',
    });
    const path = `/wavelength-bridge/treasury/preview?${query}`;
    expect((await t.fetch(path)).status).toBe(401);
    expect((await t.fetch(path, {
      headers: { Authorization: 'Bearer forged' },
    })).status).toBe(401);
    const authorized = await t.fetch(path, {
      headers: { Authorization: 'Bearer treasury-secret' },
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      status: 'dry_run',
      canClaim: false,
      requiredReserveSats: 14_520,
    });

    for (const endpoint of ['claim', 'dispatched', 'completed', 'failed']) {
      const response = await t.fetch(`/wavelength-bridge/treasury/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
    }
  });

  it('claims through the authenticated endpoint and rejects invalid bridge input', async () => {
    vi.stubEnv('WAVELENGTH_BRIDGE_TOKEN', 'treasury-secret');
    const t = convexTest(schema, modules);
    const bad = await t.fetch('/wavelength-bridge/treasury/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer treasury-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...config, network: 'mainnet' }),
    });
    expect(bad.status).toBe(200);
    await expect(bad.json()).resolves.toMatchObject({
      claimed: false,
      reason: 'invalid_network',
    });

    const claimed = await t.fetch('/wavelength-bridge/treasury/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer treasury-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    expect(claimed.status).toBe(200);
    await expect(claimed.json()).resolves.toMatchObject({
      claimed: true,
      sweep: {
        network: 'signet',
        destinationAddress: DESTINATION,
        status: 'prepared',
      },
    });
  });
});
