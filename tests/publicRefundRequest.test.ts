/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/!(*.*.*)*.*s');
const created: Array<ReturnType<typeof convexTest>> = [];

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 50; i += 1) {
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect())
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

async function seededBooking() {
  const t = convexTest(schema, modules);
  created.push(t);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
      currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
      phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Node Room', slug: 'node-room', kind: 'room', bookingMode: 'nightly',
      description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
      icalExportToken: 'test', icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Guest', email: 'Guest@Example.test',
      normalizedEmail: 'guest@example.test', phone: '', normalizedPhone: '',
      marketingOptIn: false, notes: [],
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitTypeId, unitId, guestId,
      checkIn: '2026-08-16', checkOut: '2026-08-17', nights: 1,
      adults: 1, children: 0, status: 'confirmed', source: 'direct',
      confirmationCode: 'OS-PUBLIC-REFUND',
      priceBreakdown: {
        nightlySubtotalCents: 100, addOnSubtotalCents: 0, promoDiscountCents: 0,
        taxableSubtotalCents: 100, gstCents: 0, totalCents: 100,
        giftCertAppliedCents: 0, depositDueCents: 100, balanceDueCents: 0,
      },
      statusHistory: [{ status: 'hold', ts: now - 1_000 }, { status: 'confirmed', ts: now }],
      notes: [], createdAt: now, updatedAt: now,
    });
    const zapritePaymentId = await ctx.db.insert('payments', {
      propertyId, bookingId, provider: 'zaprite', providerPaymentId: 'zap-paid',
      amountCents: 100, gstCents: 0, currency: 'CAD', status: 'paid', refunds: [],
      createdAt: now, paidAt: now,
    });
    await ctx.db.insert('payments', {
      propertyId, bookingId, provider: 'stripe', providerPaymentId: 'stripe-paid',
      amountCents: 100, gstCents: 0, currency: 'CAD', status: 'paid', refunds: [],
      createdAt: now, paidAt: now,
    });
    return { bookingId, zapritePaymentId };
  });
  return { t, ...ids };
}

describe('public contribution refund request', () => {
  it('authenticates the guest and creates one manual case for a paid public rail', async () => {
    const { t, zapritePaymentId } = await seededBooking();
    const refunds = (api as any).refunds;

    await expect(t.mutation(refunds.requestForGuest, {
      confirmationCode: 'OS-PUBLIC-REFUND',
      email: 'wrong@example.test',
    })).rejects.toThrow('Booking not found');

    const first = await t.mutation(refunds.requestForGuest, {
      confirmationCode: 'os-public-refund',
      email: ' GUEST@example.test ',
    });
    const replay = await t.mutation(refunds.requestForGuest, {
      confirmationCode: 'OS-PUBLIC-REFUND',
      email: 'guest@example.test',
    });
    expect(first).toEqual({ requested: true, caseCount: 1, amountCents: 100 });
    expect(replay).toEqual({ requested: false, caseCount: 1, amountCents: 100 });

    const rows = await t.run((ctx) => ctx.db.query('refundCases').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paymentId: zapritePaymentId,
      status: 'open',
      reason: 'guest_requested_public_contribution_refund',
      amountCents: 100,
    });
  });

  it('exposes only authenticated, booking-scoped refund state', async () => {
    const { t } = await seededBooking();
    const refunds = (api as any).refunds;
    await t.mutation(refunds.requestForGuest, {
      confirmationCode: 'OS-PUBLIC-REFUND',
      email: 'guest@example.test',
    });
    await expect(t.query(refunds.forGuest, {
      confirmationCode: 'OS-PUBLIC-REFUND',
      email: 'guest@example.test',
    })).resolves.toEqual({
      refundablePaymentCount: 1,
      requestedCaseCount: 1,
      completedCaseCount: 0,
      refundableAmountCents: 100,
    });
    await expect(t.query(refunds.forGuest, {
      confirmationCode: 'OS-PUBLIC-REFUND',
      email: 'other@example.test',
    })).rejects.toThrow('Booking not found');
  });
});
