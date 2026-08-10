/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'owner@example.com', name: 'Owner' });
    await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: 1 });
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Resort', slug: 'test-resort', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500,
      email: 'stay@example.com', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    for (const feature of ['command_center', 'maintenance', 'commerce']) await ctx.db.insert('propertyFeatures', { propertyId, feature, enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Site', slug: 'site', kind: 'site', bookingMode: 'nightly', description: '', photoUrls: [],
      maxOccupancy: 6, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'A-01', slug: 'a-01', status: 'active', icalExportToken: 'ops', icalImports: [], sortOrder: 1 });
    const guestId = await ctx.db.insert('guests', { propertyId, name: 'Guest', email: 'guest@example.com', phone: '555', normalizedEmail: 'guest@example.com', normalizedPhone: '555', marketingOptIn: false, notes: [] });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitId, unitTypeId, guestId, checkIn: '2030-01-01', checkOut: '2030-01-03', nights: 2,
      adults: 2, children: 0, status: 'confirmed', source: 'front_desk', confirmationCode: 'OS-OPS001',
      priceBreakdown: { nightlySubtotalCents: 20_000, addOnSubtotalCents: 0, promoDiscountCents: 0, taxableSubtotalCents: 20_000, gstCents: 1_000, totalCents: 21_000, giftCertAppliedCents: 0, depositDueCents: 21_000, balanceDueCents: 21_000 },
      statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [], createdAt: 1, updatedAt: 1, version: 0,
    });
    return { userId, propertyId, unitId, bookingId };
  });
}

describe('audited command-center workflows', () => {
  it('keeps maintenance readiness separate from inventory until an explicit block is requested', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    await asOwner.mutation((api as any).operations.createMaintenanceTask, {
      propertyId: f.propertyId, unitId: f.unitId, title: 'Replace tap', description: 'Slow leak', priority: 'normal',
      removesInventory: false, requestId: 'req-maintenance-minor',
    });
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(0);

    const blocked = await asOwner.mutation((api as any).operations.createMaintenanceTask, {
      propertyId: f.propertyId, unitId: f.unitId, title: 'Water shutoff', description: 'Line replacement', priority: 'urgent',
      removesInventory: true, checkIn: '2030-02-01', checkOut: '2030-02-03', requestId: 'req-maintenance-block',
    });
    const task = await t.run(async (ctx) => ctx.db.get(blocked.maintenanceTaskId));
    expect(task).toMatchObject({ removesInventory: true });
    expect((task as any).linkedBlockBookingId).toBeDefined();
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(2);
  });

  it('preserves original value when a manager authorizes a complimentary stay', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const result = await t.withIdentity(identityFor(f.userId)).mutation((api as any).operations.authorizeComplimentary, {
      propertyId: f.propertyId, bookingId: f.bookingId, reason: 'Service recovery', requestId: 'req-complimentary',
    });
    const authorization = await t.run(async (ctx) => ctx.db.get(result.authorizationId));
    const adjustment = await t.run(async (ctx) => ctx.db.query('rateAdjustments').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).unique());
    const booking = await t.run(async (ctx) => ctx.db.get(f.bookingId));
    expect(authorization).toMatchObject({ originalValueCents: 21_000, status: 'approved' });
    expect(adjustment).toMatchObject({ originalTotalCents: 21_000, adjustedTotalCents: 0 });
    expect((booking as any).priceBreakdown.totalCents).toBe(21_000);
  });

  it('posts immutable retail entries and corrects them with a balancing reversal', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    const folio = await asOwner.mutation((api as any).commerce.createRetailFolio, {
      propertyId: f.propertyId, description: 'Camp store', requestId: 'req-retail-folio',
    });
    const charge = await asOwner.mutation((api as any).commerce.postEntry, {
      propertyId: f.propertyId, folioId: folio.folioId, kind: 'charge', description: 'Firewood',
      amountCents: 1200, taxCents: 60, expectedVersion: 0, requestId: 'req-firewood',
    });
    await asOwner.mutation((api as any).commerce.reverseEntry, {
      propertyId: f.propertyId, folioId: folio.folioId, entryId: charge.entryId,
      reason: 'Entered twice', expectedVersion: 1, requestId: 'req-firewood-reverse',
    });
    const entries = await t.run(async (ctx) => ctx.db.query('folioEntries').withIndex('by_folio_postedAt', (q) => q.eq('folioId', folio.folioId)).collect());
    expect(entries.map((entry) => entry.amountCents)).toEqual([1200, -1200]);
    expect(entries[1]).toMatchObject({ kind: 'reversal', reversesEntryId: charge.entryId });
    expect(entries.reduce((sum, entry) => sum + entry.amountCents + entry.taxCents, 0)).toBe(0);
  });
});
