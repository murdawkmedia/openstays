/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import { bridgeBearerAuthorized } from './wavelength';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('bridgeBearerAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(bridgeBearerAuthorized('Bearer bridge-secret', 'bridge-secret')).toBe(true);
    expect(bridgeBearerAuthorized('Bearer forged', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('bridge-secret', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized(undefined, 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('Bearer bridge-secret', '')).toBe(false);
  });

  it('drops cancelled or expired work before claiming the next payable request', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'test', icalImports: [], sortOrder: 1 });
      const now = Date.now();
      const cancelledBookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-15', checkOut: '2026-08-16',
        nights: 1, adults: 1, children: 0, status: 'cancelled', source: 'demo', confirmationCode: 'OS-CANCELLED',
        statusHistory: [{ status: 'hold', ts: now - 1_000 }, { status: 'cancelled', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const payableBookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-16', checkOut: '2026-08-17',
        nights: 1, adults: 1, children: 0, status: 'hold', source: 'demo', confirmationCode: 'OS-PAYABLE', holdExpiresAt: now + 600_000,
        statusHistory: [{ status: 'hold', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const cancelledPaymentId = await ctx.db.insert('payments', { propertyId, bookingId: cancelledBookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'pending', refunds: [], createdAt: now });
      const payablePaymentId = await ctx.db.insert('payments', { propertyId, bookingId: payableBookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'pending', refunds: [], createdAt: now });
      const cancelledRequestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId: cancelledBookingId, paymentId: cancelledPaymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 210, expiresAt: now + 600_000, status: 'claimed', createdAt: now - 1_000,
        updatedAt: now, claimedAt: now });
      const payableRequestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId: payableBookingId, paymentId: payablePaymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 1_000, expiresAt: now + 600_000, status: 'requested', createdAt: now,
        updatedAt: now });
      return { cancelledRequestId, payableRequestId };
    });

    const claimed = await t.mutation((internal as any).wavelength.claimPending, { limit: 10 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ _id: ids.payableRequestId, status: 'claimed', satsAmount: 1_000 });
    const cancelled = await t.run((ctx) => ctx.db.get(ids.cancelledRequestId));
    expect(cancelled).toMatchObject({ status: 'failed', failureReason: 'BOOKING_NOT_PAYABLE' });
  });
});
