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

  it('returns open flags, housekeeping progress, and a needs-attention queue', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    await t.run(async (ctx) => {
      await ctx.db.insert('propertyFeatures', { propertyId: f.propertyId, feature: 'front_desk_exceptions', enabled: true, version: 1, updatedBy: f.userId, updatedAt: 1 });
      await ctx.db.insert('propertyFeatures', { propertyId: f.propertyId, feature: 'housekeeping_checklists', enabled: true, version: 1, updatedBy: f.userId, updatedAt: 1 });
      await ctx.db.insert('bookingOperationalFlags', {
        propertyId: f.propertyId, bookingId: f.bookingId, unitId: f.unitId,
        kind: 'departure_overdue', severity: 'urgent', state: 'open', summary: 'Guest has not departed',
        version: 0, createdBy: f.userId, createdAt: 1, updatedBy: f.userId, updatedAt: 1,
      });
      const assignmentId = await ctx.db.insert('housekeepingAssignments', {
        propertyId: f.propertyId, unitId: f.unitId, serviceDate: '2030-05-03', priority: 1,
        status: 'in_progress', cleaningType: 'turnover', expectedMinutes: 45,
        version: 1, createdBy: f.userId, createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert('housekeepingChecklistItems', {
        propertyId: f.propertyId, assignmentId, itemKey: 'linen', label: 'Replace linen', required: true,
        sortOrder: 1, status: 'completed', version: 1, updatedBy: f.userId, updatedAt: 1, completedAt: 1,
      });
      await ctx.db.insert('housekeepingChecklistItems', {
        propertyId: f.propertyId, assignmentId, itemKey: 'bath', label: 'Clean bath', required: true,
        sortOrder: 2, status: 'pending', version: 0, updatedBy: f.userId, updatedAt: 1,
      });
    });
    const queues = await asOwner.query((api as any).frontDesk.queues, { propertyId: f.propertyId, businessDate: '2030-05-03' });
    expect(queues.needsAttention).toHaveLength(1);
    expect(queues.needsAttention[0]).toMatchObject({
      bookingId: f.bookingId,
      openFlags: [{ kind: 'departure_overdue', severity: 'urgent' }],
      housekeepingProgress: { status: 'in_progress', completed: 1, total: 2 },
      policySummary: { standardCheckInTime: '16:00', standardCheckOutTime: '11:00' },
    });
  });

  it('keeps exception flags operational and does not alter stay dates or inventory', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const before = await t.run(async (ctx) => ({
      booking: await ctx.db.get(f.bookingId),
      nights: await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).collect(),
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert('bookingOperationalFlags', {
        propertyId: f.propertyId, bookingId: f.bookingId, unitId: f.unitId,
        kind: 'late_checkout', severity: 'attention', state: 'open', summary: 'Approved until 1 PM',
        dueAt: Date.parse('2030-05-03T19:00:00Z'), version: 0,
        createdBy: f.userId, createdAt: 1, updatedBy: f.userId, updatedAt: 1,
      });
      await ctx.db.insert('bookingOperationalFlags', {
        propertyId: f.propertyId, bookingId: f.bookingId, unitId: f.unitId,
        kind: 'sleep_out', severity: 'info', state: 'open', summary: 'Guest away overnight', version: 0,
        createdBy: f.userId, createdAt: 1, updatedBy: f.userId, updatedAt: 1,
      });
    });
    const after = await t.run(async (ctx) => ({
      booking: await ctx.db.get(f.bookingId),
      nights: await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).collect(),
    }));
    expect(after).toEqual(before);
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

  it('creates exactly one turnover assignment when the checklist handoff is enabled', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    await t.run(async (ctx) => {
      await ctx.db.insert('propertyFeatures', { propertyId: f.propertyId, feature: 'housekeeping_checklists', enabled: true, version: 1, updatedBy: f.userId, updatedAt: 1 });
    });
    await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_in', expectedVersion: 0, requestId: 'handoff-checkin' });
    const first = await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_out', expectedVersion: 1, requestId: 'handoff-checkout' });
    const replay = await asOwner.mutation((api as any).frontDesk.transition, { propertyId: f.propertyId, bookingId: f.bookingId, transition: 'check_out', expectedVersion: 1, requestId: 'handoff-checkout' });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    const assignments = await t.run(async (ctx) => ctx.db.query('housekeepingAssignments')
      .withIndex('by_unit_date', (q) => q.eq('unitId', f.unitId).eq('serviceDate', '2030-05-03')).collect());
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ cleaningType: 'turnover', sourceCheckoutRequestId: 'handoff-checkout' });
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
