/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

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
      email: 'guest@example.test', bolt11: 'lntbs2100n1guest', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('CONSENSUS_RECEIPT_NOT_SUBMITTED');
  });

  it('accepts one exact guest signet invoice only after receipt submission', async () => {
    const { t } = await eligibleReward();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'forged@example.test', bolt11: 'lntbs2100n1guest', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('BOOKING_NOT_FOUND');
    const reward = await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'os-reward',
      email: 'GUEST@example.test', bolt11: 'lntbs2100n1guest', expiresAt: Date.now() + 600_000 });
    expect(reward).toMatchObject({ network: 'signet', satsAmount: 210, status: 'invoice_ready', attemptCount: 1 });
  });

  it('leases a payout and records an exact settlement once', async () => {
    const { t } = await eligibleReward();
    await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', bolt11: 'lntbs2100n1guest', expiresAt: Date.now() + 600_000 });
    const [claimed] = await t.mutation((internal as any).wavelengthRewards.claimPending, { limit: 10 });
    expect(claimed).toMatchObject({ status: 'paying', satsAmount: 210 });
    const args = { rewardId: claimed._id, leaseToken: claimed.leaseToken, network: 'signet', satsAmount: 210,
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
      email: 'guest@example.test', bolt11: 'lntbs2100n1first', expiresAt: Date.now() + 600_000 });
    const [claimed] = await t.mutation((internal as any).wavelengthRewards.claimPending, { limit: 1 });
    await expect(t.mutation((internal as any).wavelengthRewards.markPaid, { rewardId: claimed._id,
      leaseToken: claimed.leaseToken, network: 'signet', satsAmount: 211, bolt11: claimed.bolt11,
      merchantActivityId: 'send', paymentHash: 'hash' })).rejects.toThrow('WAVELENGTH_REWARD_MISMATCH');
    await t.mutation((internal as any).wavelengthRewards.markFailed, { rewardId: claimed._id,
      leaseToken: claimed.leaseToken, reason: 'invoice expired', retryable: false });
    const replacement = await t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', bolt11: 'lntbs2100n1second', expiresAt: Date.now() + 600_000 });
    expect(replacement).toMatchObject({ status: 'invoice_ready', attemptCount: 2, bolt11: 'lntbs2100n1second' });
  });

  it('rejects expired and non-signet invoices at the guest boundary', async () => {
    const { t } = await eligibleReward();
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', bolt11: 'lnbc2100n1mainnet', expiresAt: Date.now() + 600_000 }))
      .rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
    await expect(t.mutation((api as any).wavelengthRewards.submitInvoice, { confirmationCode: 'OS-REWARD',
      email: 'guest@example.test', bolt11: 'lntbs2100n1expired', expiresAt: Date.now() + 1_000 }))
      .rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
  });
});
