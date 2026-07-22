/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const refundsApi = (api as any).refunds;

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seedRefund(t: ReturnType<typeof convexTest>, amountCents = 10_000) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto', currency: 'CAD',
      taxRateBps: 0, email: 'staff@example.com', phone: '555', address: 'Toronto', checkInTime: '16:00',
      checkOutTime: '11:00', active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Room', slug: 'room', kind: 'room', bookingMode: 'nightly', description: '',
      photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Room 1', slug: 'room-1', status: 'active', icalExportToken: 'token',
      icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Guest', email: 'guest@example.com', phone: '555', normalizedEmail: 'guest@example.com',
      normalizedPhone: '555', marketingOptIn: false, notes: [],
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitId, unitTypeId, guestId, checkIn: '2026-07-23', checkOut: '2026-07-24', nights: 1,
      adults: 1, children: 0, status: 'cancelled', source: 'online', confirmationCode: 'OS-REFUND',
      statusHistory: [], notes: [], createdAt: Date.now(), updatedAt: Date.now(),
    });
    const paymentId = await ctx.db.insert('payments', {
      propertyId, bookingId, provider: 'zaprite', providerCheckoutId: 'order_refund', providerPaymentId: 'order_refund',
      amountCents, gstCents: 0, currency: 'CAD', status: 'paid', refunds: [], createdAt: Date.now(), paidAt: Date.now(),
    });
    const refundCaseId = await ctx.db.insert('refundCases', {
      propertyId, paymentId, bookingId, amountCents, currency: 'CAD', reason: 'guest_cancellation', status: 'open',
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const userId = await ctx.db.insert('users', { email: 'staff@example.com', name: 'Staff' });
    await ctx.db.insert('staffProfiles', {
      userId, name: 'Staff', role: 'staff', active: true, createdAt: Date.now(),
    });
    return { paymentId, refundCaseId, userId };
  });
}

describe('manual refunds', () => {
  it('requires staff to list or complete cases', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedRefund(t);
    await expect(t.query(refundsApi.listOpen, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.mutation(refundsApi.complete, {
      refundCaseId: fx.refundCaseId,
      externalReference: 'txid',
    })).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('requires an external reference and completes exactly once', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedRefund(t);
    const staff = t.withIdentity(identityFor(fx.userId));
    const open = await staff.query(refundsApi.listOpen, {});
    expect(open).toHaveLength(1);
    await expect(staff.mutation(refundsApi.complete, {
      refundCaseId: fx.refundCaseId,
      externalReference: '   ',
    })).rejects.toThrow(/EXTERNAL_REFERENCE_REQUIRED/);

    await expect(staff.mutation(refundsApi.complete, {
      refundCaseId: fx.refundCaseId,
      externalReference: 'zaprite-refund-123',
    })).resolves.toEqual({ completed: true });
    await expect(staff.mutation(refundsApi.complete, {
      refundCaseId: fx.refundCaseId,
      externalReference: 'zaprite-refund-123',
    })).resolves.toEqual({ completed: false });

    const state = await t.run(async (ctx) => ({
      payment: await ctx.db.get(fx.paymentId),
      refundCase: await ctx.db.get(fx.refundCaseId),
    }));
    expect(state.payment!.status).toBe('refunded');
    expect(state.payment!.refunds).toHaveLength(1);
    expect(state.payment!.refunds[0]).toMatchObject({
      providerRefundId: 'zaprite-refund-123',
      by: 'Staff',
    });
    expect(state.refundCase).toMatchObject({
      status: 'completed', externalReference: 'zaprite-refund-123', resolvedBy: 'Staff',
    });
  });
});
