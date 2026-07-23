/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const created: Array<ReturnType<typeof convexTest>> = [];

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 50; i += 1) {
    const pending = await t.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending' || job.state.kind === 'inProgress').length);
    if (pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

afterEach(async () => {
  for (const t of created) await drainScheduled(t);
  created.length = 0;
});

async function confirmedBooking() {
  const t = convexTest(schema, modules);
  created.push(t);
  const ids = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto', currency: 'CAD',
      taxRateBps: 1300, taxLabel: 'HST', email: 'staff@example.test', phone: '416-555-0210', address: 'Toronto',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Node Room', slug: 'node-room', kind: 'room', bookingMode: 'nightly', description: '',
      photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Secret Unit', slug: 'secret-unit', status: 'active',
      icalExportToken: 'secret-token', icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Satoshi Guest', email: 'satoshi@example.test', phone: '416-555-1212',
      normalizedEmail: 'satoshi@example.test', normalizedPhone: '4165551212', marketingOptIn: false, notes: [],
    });
    const now = 1_721_667_600_000;
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitId, unitTypeId, guestId, checkIn: '2026-07-23', checkOut: '2026-07-24', nights: 1,
      adults: 1, children: 0, status: 'confirmed', source: 'demo', confirmationCode: 'OS-SECRET',
      priceBreakdown: { nightlySubtotalCents: 2100, addOnSubtotalCents: 0, promoDiscountCents: 0,
        taxableSubtotalCents: 2100, gstCents: 0, totalCents: 2100, giftCertAppliedCents: 0,
        depositDueCents: 2100, balanceDueCents: 0 },
      statusHistory: [{ status: 'hold', ts: now - 1000 }, { status: 'confirmed', ts: now }],
      notes: [], createdAt: now - 1000, updatedAt: now,
    });
    await ctx.db.insert('payments', {
      propertyId, bookingId, provider: 'wavelength', amountCents: 2100, gstCents: 0, currency: 'CAD',
      status: 'paid', refunds: [], providerPaymentId: 'secret-payment-hash', createdAt: now, paidAt: now,
    });
    return { bookingId };
  });
  return { t, ...ids };
}

describe('consensus receipts', () => {
  it('creates one immutable privacy-safe receipt per confirmed booking', async () => {
    const { t, bookingId } = await confirmedBooking();
    const first = await t.mutation((internal as any).consensusReceipts.ensureForBooking, { bookingId });
    const second = await t.mutation((internal as any).consensusReceipts.ensureForBooking, { bookingId });
    expect(second._id).toBe(first._id);
    expect(first.status).toBe('queued');
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(first.canonicalJson)).toMatchObject({
      schema: 'openstays.consensus-receipt.v1', property: { slug: 'consensus-commons' },
      economic: { amountCents: 2100, currency: 'CAD', paymentProvider: 'wavelength', paymentStatus: 'paid' },
    });
    for (const secret of ['satoshi@example.test', 'OS-SECRET', '2026-07-23', 'secret-unit', 'secret-payment-hash']) {
      expect(first.canonicalJson).not.toContain(secret);
    }
    expect(await t.run((ctx) => ctx.db.query('consensusReceipts').collect())).toHaveLength(1);
  });

  it('publishes a bounded proof once and exposes it only to the matching guest', async () => {
    const { t, bookingId } = await confirmedBooking();
    await t.mutation((internal as any).consensusReceipts.ensureForBooking, { bookingId });
    const [claimed] = await t.mutation((internal as any).consensusReceipts.claimPending, { limit: 10 });
    const proofBase64 = btoa('OpenTimestamps proof');
    await expect(t.mutation((internal as any).consensusReceipts.publishProof, {
      receiptId: claimed._id, leaseToken: 'stale', sha256: claimed.sha256, proofBase64, calendarCount: 2,
    })).rejects.toThrow('STALE_OTS_LEASE');
    await expect(t.mutation((internal as any).consensusReceipts.publishProof, {
      receiptId: claimed._id, leaseToken: claimed.leaseToken, sha256: '0'.repeat(64), proofBase64, calendarCount: 2,
    })).rejects.toThrow('INVALID_OTS_PROOF');
    await expect(t.mutation((internal as any).consensusReceipts.publishProof, {
      receiptId: claimed._id, leaseToken: claimed.leaseToken, sha256: claimed.sha256,
      proofBase64: Buffer.alloc(256 * 1024 + 1).toString('base64'), calendarCount: 2,
    })).rejects.toThrow('INVALID_OTS_PROOF');
    await t.mutation((internal as any).consensusReceipts.publishProof, {
      receiptId: claimed._id, leaseToken: claimed.leaseToken, sha256: claimed.sha256, proofBase64, calendarCount: 2,
    });
    expect(await t.mutation((internal as any).consensusReceipts.publishProof, {
      receiptId: claimed._id, leaseToken: claimed.leaseToken, sha256: claimed.sha256, proofBase64, calendarCount: 2,
    })).toEqual({ published: false });
    expect(await t.query((api as any).consensusReceipts.forGuest, {
      confirmationCode: 'os-secret', email: 'SATOSHI@example.test',
    })).toMatchObject({ status: 'submitted', proofBase64, calendarCount: 2 });
    expect(await t.query((api as any).consensusReceipts.forGuest, {
      confirmationCode: 'OS-SECRET', email: 'other@example.test',
    })).toBeNull();
    const previousDemoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'true';
    try {
      const [staffReceipt] = await t.query((api as any).consensusReceipts.staffOverview, {});
      expect(staffReceipt).toMatchObject({ rewardStatus: 'eligible', rewardSatsAmount: 1_000 });
    } finally {
      if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousDemoMode;
    }
  });

  it('advances only proof attestation fields and never rewrites canonical bytes', async () => {
    const { t, bookingId } = await confirmedBooking();
    const original = await t.mutation((internal as any).consensusReceipts.ensureForBooking, { bookingId });
    const [claimed] = await t.mutation((internal as any).consensusReceipts.claimPending, { limit: 1 });
    await t.mutation((internal as any).consensusReceipts.publishProof, { receiptId: claimed._id,
      leaseToken: claimed.leaseToken, sha256: claimed.sha256, proofBase64: btoa('pending-proof'), calendarCount: 1 });
    await t.mutation((internal as any).consensusReceipts.markAnchored, { receiptId: claimed._id,
      sha256: claimed.sha256, proofBase64: btoa('upgraded-proof'), bitcoinBlockHeight: 900_000,
      bitcoinBlockTime: 1_750_000_000_000 });
    const anchored = await t.run((ctx) => ctx.db.get(claimed._id));
    expect(anchored).toMatchObject({ status: 'bitcoin_anchored', canonicalJson: original.canonicalJson,
      sha256: original.sha256, bitcoinBlockHeight: 900_000 });
  });
});
