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
    const profileId = await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: 1 });
    const propertyId = await ctx.db.insert('properties', { name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500, email: 'x@y.ca', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true });
    for (const feature of ['housekeeping', 'maintenance']) await ctx.db.insert('propertyFeatures', { propertyId, feature, enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
    const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1 });
    const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active', icalExportToken: 'hk', icalImports: [], sortOrder: 1 });
    await ctx.db.insert('unitServiceStates', { propertyId, unitId, state: 'dirty', version: 0, updatedBy: userId, updatedAt: 1 });
    return { userId, profileId, propertyId, unitTypeId, unitId };
  });
}

describe('housekeeping and maintenance', () => {
  it('assigns work and enforces the cleaning-inspection-ready sequence', async () => {
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    const assignment = await asOwner.mutation((api as any).housekeeping.assign, { propertyId: f.propertyId, unitId: f.unitId, serviceDate: '2030-05-03', assignedStaffProfileId: f.profileId, priority: 1, requestId: 'req-assign' });
    expect(assignment.replayed).toBe(false);
    await expect(asOwner.mutation((api as any).housekeeping.transitionState, { propertyId: f.propertyId, unitId: f.unitId, state: 'ready', expectedVersion: 0, requestId: 'req-skip' })).rejects.toThrow(/INVALID_SERVICE_TRANSITION/);
    await asOwner.mutation((api as any).housekeeping.transitionState, { propertyId: f.propertyId, unitId: f.unitId, state: 'cleaning', expectedVersion: 0, requestId: 'req-clean' });
    await asOwner.mutation((api as any).housekeeping.transitionState, { propertyId: f.propertyId, unitId: f.unitId, state: 'inspection', expectedVersion: 1, requestId: 'req-inspect' });
    await asOwner.mutation((api as any).housekeeping.transitionState, { propertyId: f.propertyId, unitId: f.unitId, state: 'ready', expectedVersion: 2, requestId: 'req-ready' });
    const board = await asOwner.query((api as any).housekeeping.board, { propertyId: f.propertyId, serviceDate: '2030-05-03' });
    expect(board.units[0]).toMatchObject({ state: 'ready', assignedStaffProfileId: f.profileId });
  });

  it('resolving maintenance releases only its linked inventory block', async () => {
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    const created = await asOwner.mutation((api as any).operations.createMaintenanceTask, { propertyId: f.propertyId, unitId: f.unitId, title: 'Repair deck', description: '', priority: 'high', removesInventory: true, checkIn: '2030-06-01', checkOut: '2030-06-03', requestId: 'req-maint' });
    await asOwner.mutation((api as any).housekeeping.resolveMaintenance, { propertyId: f.propertyId, maintenanceTaskId: created.maintenanceTaskId, expectedVersion: 0, requestId: 'req-resolve' });
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(0);
    const block = await t.run(async (ctx) => ctx.db.get(created.blockBookingId!));
    expect(block).toMatchObject({ status: 'cancelled' });
  });
});
