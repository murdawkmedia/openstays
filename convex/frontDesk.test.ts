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
    const propertyId = await ctx.db.insert('properties', { name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500, email: 'x@y.ca', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true });
    await ctx.db.insert('propertyFeatures', { propertyId, feature: 'front_desk', enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
    const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1 });
    const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active', icalExportToken: 'fd', icalImports: [], sortOrder: 1 });
    await ctx.db.insert('unitServiceStates', { propertyId, unitId, state: 'ready', version: 0, updatedBy: userId, updatedAt: 1 });
    const guestId = await ctx.db.insert('guests', { propertyId, name: 'Guest One', email: 'guest@example.com', phone: '555', normalizedEmail: 'guest@example.com', normalizedPhone: '555', marketingOptIn: false, notes: [] });
    const bookingId = await ctx.db.insert('bookings', { propertyId, unitId, unitTypeId, guestId, checkIn: '2030-05-01', checkOut: '2030-05-03', nights: 2, adults: 2, children: 0, status: 'confirmed', source: 'phone', confirmationCode: 'OS-FD0001', statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [], createdAt: 1, updatedAt: 1, version: 0 });
    for (const date of ['2030-05-01', '2030-05-02']) await ctx.db.insert('unitNights', { unitId, date, bookingId, kind: 'stay' });
    return { userId, propertyId, unitId, bookingId };
  });
}

describe('front desk', () => {
  it('builds arrival and stay-over queues with readiness and balance context', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    const arrival = await asOwner.query((api as any).frontDesk.queues, { propertyId: f.propertyId, businessDate: '2030-05-01' });
    expect(arrival.arriving).toHaveLength(1);
    expect(arrival.arriving[0]).toMatchObject({ guestName: 'Guest One', unitName: 'Cabin 1', readiness: 'ready', balanceCents: 0 });
    const stayOver = await asOwner.query((api as any).frontDesk.queues, { propertyId: f.propertyId, businessDate: '2030-05-02' });
    expect(stayOver.stayingOver).toHaveLength(1);
  });

  it('checks in, checks out, releases occupancy, and marks the unit dirty', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_in', expectedVersion: 0, requestId: 'req-checkin' });
    const checkedOut = await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_out', expectedVersion: 1, requestId: 'req-checkout' });
    expect(checkedOut).toMatchObject({ status: 'checked_out', version: 2 });
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).collect())).toHaveLength(0);
    const service = await t.run(async (ctx) => ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', f.unitId)).unique());
    expect(service).toMatchObject({ state: 'dirty', version: 1 });
  });

  it('marks a no-show only from confirmed and keeps stale retries from changing state', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'no_show', expectedVersion: 0, requestId: 'req-no-show' });
    await expect(asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_in', expectedVersion: 0, requestId: 'req-stale-checkin' })).rejects.toThrow(/VERSION_CONFLICT/);
    const booking = await t.run(async (ctx) => ctx.db.get(f.bookingId));
    expect(booking).toMatchObject({ status: 'no_show', version: 1 });
  });
});
