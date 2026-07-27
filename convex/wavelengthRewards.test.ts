/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { CONSENSUS_REWARD_SATS, LEGACY_CONSENSUS_REWARD_SATS } from './rewardPolicy';
import schema from './schema';
import {
  eligibilityEmailDigest,
  signEligibilityToken,
} from './publicPolicy';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

const created: Array<ReturnType<typeof convexTest>> = [];

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 50; i += 1) {
    const pending = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.filter((job) => job.state.kind === 'pending' || job.state.kind === 'inProgress').length;
    });
    if (pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

afterEach(async () => {
  for (const t of created) await drainScheduled(t);
  created.length = 0;
  vi.unstubAllEnvs();
});

async function eligibleReward() {
  const t = convexTest(schema, modules);
  created.push(t);
  const bookingId = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
      timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 1300, taxLabel: 'HST', email: 'staff@example.test',
      phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
    const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room',
      bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
    const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: '210', slug: '210', status: 'active',
      icalExportToken: 'x', icalImports: [], sortOrder: 1 });
    const guestId = await ctx.db.insert('guests', { propertyId, name: 'Guest', email: 'guest@example.test', phone: '',
      normalizedEmail: 'guest@example.test', normalizedPhone: '', marketingOptIn: false, notes: [] });
    const now = Date.now();
    const id = await ctx.db.insert('bookings', { propertyId, unitId, unitTypeId, guestId, checkIn: '2026-07-23',
      checkOut: '2026-07-24', nights: 1, adults: 1, children: 0, status: 'confirmed', source: 'demo',
      confirmationCode: 'OS-REWARD', priceBreakdown: { nightlySubtotalCents: 2100, addOnSubtotalCents: 0,
        promoDiscountCents: 0, taxableSubtotalCents: 2100, gstCents: 0, totalCents: 2100, giftCertAppliedCents: 0,
        depositDueCents: 2100, balanceDueCents: 0 }, statusHistory: [{ status: 'confirmed', ts: now }], notes: [],
      createdAt: now, updatedAt: now });
    await ctx.db.insert('payments', { propertyId, bookingId: id, provider: 'wavelength', amountCents: 2100,
      gstCents: 0, currency: 'CAD', status: 'paid', refunds: [], createdAt: now, paidAt: now });
    return id;
  });
  await t.mutation((internal as any).consensusReceipts.ensureForBooking, { bookingId });
  const [receipt] = await t.mutation((internal as any).consensusReceipts.claimPending, { limit: 1 });
  await t.mutation((internal as any).consensusReceipts.publishProof, { receiptId: receipt._id,
    leaseToken: receipt.leaseToken, sha256: receipt.sha256, proofBase64: btoa('proof'), calendarCount: 1 });
  await drainScheduled(t);
  return { t, bookingId };
}

describe('Wavelength consensus rewards', () => {
  it('keeps legacy rows readable while making 1000 sats the active policy', async () => {
    expect(CONSENSUS_REWARD_SATS).toBe(1_000);
    expect(LEGACY_CONSENSUS_REWARD_SATS).toBe(210);

    const { t, bookingId } = await eligibleReward();
    await t.run(async (ctx) => {
      const legacy = await ctx.db.query('wavelengthRewards')
        .withIndex('by_booking', (q) => q.eq('bookingId', bookingId)).unique();
      expect(legacy?.satsAmount).toBe(CONSENSUS_REWARD_SATS);
      const { _id: _activeId, _creationTime: _activeCreationTime, ...row } = legacy!;
      await ctx.db.insert('wavelengthRewards', {
        ...row,
        satsAmount: LEGACY_CONSENSUS_REWARD_SATS,
      } as any);
    });
  });

  it('rejects claims before a timestamp proof unlocks the reward', async () => {
    const t = convexTest(schema, modules);
    created.push(t);
    const { bookingId } = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Commons', slug: 'commons', timezone: 'UTC',
        currency: 'CAD', taxRateBps: 0, email: 'staff@example.test', phone: '', address: '', checkInTime: '16:00',
        checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room',
        bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'A', slug: 'a', status: 'active',
        icalExportToken: 'x', icalImports: [], sortOrder: 1 });
      const guestId = await ctx.db.insert('guests', { propertyId, name: 'Guest', email: 'guest@example.test', phone: '',
        normalizedEmail: 'guest@example.test', normalizedPhone: '', marketingOptIn: false, notes: [] });
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, guestId, checkIn: '2026-07-23', checkOut: '2026-07-24',
        nights: 1, adults: 1, children: 0, status: 'confirmed', source: 'demo', confirmationCode: 'OS-NO-PROOF',
        statusHistory: [{ status: 'confirmed', ts: Date.now() }], notes: [], createdAt: Date.now(), updatedAt: Date.now() });
      return { bookingId };
    });
    expect(bookingId).toBeTruthy();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-NO-PROOF',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1guest', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('CONSENSUS_RECEIPT_NOT_SUBMITTED');
  });

  it('accepts one exact guest signet invoice only after receipt submission', async () => {
    const { t } = await eligibleReward();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'forged@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1guest', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('BOOKING_NOT_FOUND');
    const reward = await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'os-reward',
      email: 'GUEST@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1guest', expiresAt: Date.now() + 600_000 });
    expect(reward).toMatchObject({ network: 'signet', satsAmount: 1_000, status: 'invoice_ready', attemptCount: 1 });
  });

  it.each([999, 1_001])('rejects a guest-declared reward amount of %i sats', async (satsAmount) => {
    const { t } = await eligibleReward();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount, bolt11: 'lntbs10u1guest', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
  });

  it('leases a payout and records an exact settlement once', async () => {
    const { t } = await eligibleReward();
    await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1guest', expiresAt: Date.now() + 600_000 });
    const [claimed] = await t.mutation((internal as any).wavelengthRewards.claimPending, { limit: 10 });
    expect(claimed).toMatchObject({ status: 'paying', satsAmount: 1_000 });
    const args = { rewardId: claimed._id, leaseToken: claimed.leaseToken, network: 'signet', satsAmount: 1_000,
      bolt11: claimed.bolt11, merchantActivityId: 'send-activity', paymentHash: 'reward-payment-hash' };
    expect(await t.mutation((internal as any).wavelengthRewards.markPaid, args)).toEqual({ paid: true });
    expect(await t.mutation((internal as any).wavelengthRewards.markPaid, args)).toEqual({ paid: false });
    expect(await t.query((api as any).wavelengthRewards.forGuest, {
      confirmationCode: 'OS-REWARD', email: 'guest@example.test',
    })).toMatchObject({ status: 'paid', paymentHash: 'reward-payment-hash' });
  });

  it('rejects a mismatched settlement and permits replacement after a definitive failure', async () => {
    const { t } = await eligibleReward();
    await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1first', expiresAt: Date.now() + 600_000 });
    const [claimed] = await t.mutation((internal as any).wavelengthRewards.claimPending, { limit: 1 });
    for (const satsAmount of [999, 1_001]) {
      await expect(t.mutation((internal as any).wavelengthRewards.markPaid, { rewardId: claimed._id,
        leaseToken: claimed.leaseToken, network: 'signet', satsAmount, bolt11: claimed.bolt11,
        merchantActivityId: 'send', paymentHash: 'hash' })).rejects.toThrow('WAVELENGTH_REWARD_MISMATCH');
    }
    await t.mutation((internal as any).wavelengthRewards.markFailed, { rewardId: claimed._id,
      leaseToken: claimed.leaseToken, reason: 'invoice expired', retryable: false });
    const replacement = await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1second', expiresAt: Date.now() + 600_000 });
    expect(replacement).toMatchObject({ status: 'invoice_ready', attemptCount: 2, bolt11: 'lntbs10u1second' });
  });

  it('rejects expired and non-signet invoices at the guest boundary', async () => {
    const { t } = await eligibleReward();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lnbc10u1mainnet', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', satsAmount: 1_000, bolt11: 'lntbs10u1expired', expiresAt: Date.now() + 1_000 }))
      .rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
  });

  it('requires a fresh bounded eligibility claim in public live mode', async () => {
    const signingKey = 'test-only-signing-key-with-at-least-32-bytes';
    vi.stubEnv('PUBLIC_LIVE_PAYMENTS', 'true');
    vi.stubEnv('WAVELENGTH_REWARDS_ENABLED', 'true');
    vi.stubEnv('WAVELENGTH_REWARD_DAILY_BUDGET_SATS', '1000');
    vi.stubEnv('ELIGIBILITY_HMAC_SECRET', signingKey);
    const { t, bookingId } = await eligibleReward();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('bridgeHealth', {
        service: 'wavelength', status: 'ready', release: 'test',
        lastHeartbeatAt: now, spendableSats: 2_000,
        createdAt: now, updatedAt: now,
      });
    });
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, {
      confirmationCode: 'OS-REWARD',
      email: 'guest@example.test',
      satsAmount: 1_000,
      bolt11: 'lntbs10u1guest',
      expiresAt: now + 600_000,
    })).rejects.toThrow('REWARD_ELIGIBILITY_REQUIRED');

    const eligibilityToken = await signEligibilityToken({
      v: 1,
      jti: 'reward-eligibility-1',
      action: 'reward_claim',
      bookingId: String(bookingId),
      emailDigest: await eligibilityEmailDigest('guest@example.test', signingKey),
      deviceDigest: 'device-digest-1',
      networkDigest: 'network-digest-1',
      iat: now,
      exp: now + 300_000,
    }, signingKey);
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, {
      confirmationCode: 'OS-REWARD',
      email: 'guest@example.test',
      satsAmount: 1_000,
      bolt11: 'lntbs10u1guest',
      expiresAt: now + 600_000,
      eligibilityToken,
    })).resolves.toMatchObject({ status: 'invoice_ready' });
    expect(await t.run((ctx) => ctx.db.query('publicRewardClaims').collect()))
      .toHaveLength(1);
  });

  it('upgrades only inactive unpaid legacy rewards and is idempotent', async () => {
    const { t, bookingId } = await eligibleReward();
    const ids = await t.run(async (ctx) => {
      const active = await ctx.db.query('wavelengthRewards')
        .withIndex('by_booking', (q) => q.eq('bookingId', bookingId)).unique();
      const { _id: activeId, _creationTime, ...base } = active!;
      await ctx.db.patch(activeId, { satsAmount: 210, bolt11: 'lntbs2100n1stale', invoiceExpiresAt: 1,
        leaseToken: 'stale-lease', leaseExpiresAt: 1, failureReason: 'stale', attemptCount: 4 } as any);
      const make = async (status: 'expired' | 'failed' | 'invoice_ready' | 'paying' | 'paid') => ctx.db.insert('wavelengthRewards', {
        ...base, satsAmount: 210, status, attemptCount: 3, bolt11: `lntbs2100n1${status}`,
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: status === 'paying' ? 'active-lease' : undefined,
        leaseExpiresAt: status === 'paying' ? Date.now() + 60_000 : undefined,
        merchantActivityId: status === 'paid' ? 'paid-activity' : undefined,
        paymentHash: status === 'paid' ? 'paid-hash' : undefined,
        paidAt: status === 'paid' ? Date.now() : undefined,
        failureReason: status === 'failed' ? 'definitive failure' : undefined,
      } as any);
      return { eligible: activeId, expired: await make('expired'), failed: await make('failed'),
        invoiceReady: await make('invoice_ready'), paying: await make('paying'), paid: await make('paid') };
    });

    expect(await t.mutation((internal as any).wavelengthRewards.upgradeLegacyRewards, { limit: 25 }))
      .toEqual({ scanned: 6, upgraded: 3 });
    const rows = await t.run(async (ctx) => Object.fromEntries(await Promise.all(Object.entries(ids)
      .map(async ([key, id]) => [key, await ctx.db.get(id)]))));
    for (const key of ['eligible', 'expired', 'failed'] as const) {
      expect(rows[key]).toMatchObject({ satsAmount: 1_000, status: 'eligible', attemptCount: 0 });
      expect(rows[key]).not.toHaveProperty('bolt11');
      expect(rows[key]).not.toHaveProperty('invoiceExpiresAt');
      expect(rows[key]).not.toHaveProperty('leaseToken');
      expect(rows[key]).not.toHaveProperty('leaseExpiresAt');
      expect(rows[key]).not.toHaveProperty('failureReason');
    }
    expect(rows.invoiceReady).toMatchObject({ satsAmount: 210, status: 'invoice_ready' });
    expect(rows.paying).toMatchObject({ satsAmount: 210, status: 'paying' });
    expect(rows.paid).toMatchObject({ satsAmount: 210, status: 'paid', paymentHash: 'paid-hash' });
    expect(await t.mutation((internal as any).wavelengthRewards.upgradeLegacyRewards, { limit: 25 }))
      .toEqual({ scanned: 6, upgraded: 0 });
  });
});
