/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });
const flagsApi = (api as any).operationalFlags;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'test@example.test', phone: '555', address: '1 Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const otherPropertyId = await ctx.db.insert('properties', {
      name: 'Other Resort', slug: 'other', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'other@example.test', phone: '555', address: '2 Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const roles = [
      ['owner@example.test', 'Owner', 'owner'],
      ['manager@example.test', 'Manager', 'manager'],
      ['desk@example.test', 'Front Desk', 'front_desk'],
      ['other@example.test', 'Other Staff', 'front_desk'],
    ] as const;
    const staff = [];
    for (const [email, name, role] of roles) {
      const userId = await ctx.db.insert('users', { email, name });
      const profileId = await ctx.db.insert('staffProfiles', {
        userId, name, role: role === 'owner' ? 'owner' : 'staff', active: true, createdAt: 1,
      });
      await ctx.db.insert('staffPropertyAssignments', {
        staffProfileId: profileId,
        userId,
        propertyId: name === 'Other Staff' ? otherPropertyId : propertyId,
        role,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      staff.push({ userId, profileId, role });
    }
    for (const feature of ['front_desk', 'front_desk_exceptions']) {
      await ctx.db.insert('propertyFeatures', {
        propertyId, feature, enabled: true, version: 1, updatedBy: staff[0].userId, updatedAt: 1,
      });
    }
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly',
      description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active',
      icalExportToken: 'flags', icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Sample Guest', email: 'guest@example.test', phone: '555',
      normalizedEmail: 'guest@example.test', normalizedPhone: '555', marketingOptIn: false, notes: [],
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitId, unitTypeId, guestId, checkIn: '2030-05-01', checkOut: '2030-05-03',
      nights: 2, adults: 2, children: 0, status: 'confirmed', source: 'phone',
      confirmationCode: 'OS-FLAG01', statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [],
      createdAt: 1, updatedAt: 1, version: 0,
    });
    for (const date of ['2030-05-01', '2030-05-02']) {
      await ctx.db.insert('unitNights', { unitId, date, bookingId, kind: 'stay' });
    }
    return {
      propertyId, otherPropertyId, unitId, bookingId,
      owner: staff[0], manager: staff[1], desk: staff[2], other: staff[3],
    };
  });
}

describe('booking operational flags', () => {
  it('allows an ordinary desk flag and suppresses a second open flag of the same kind', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asDesk = t.withIdentity(identityFor(f.desk.userId));
    const first = await asDesk.mutation(flagsApi.create, {
      propertyId: f.propertyId,
      bookingId: f.bookingId,
      kind: 'late_checkout',
      severity: 'attention',
      summary: 'Approved until 13:00',
      expectedBookingVersion: 0,
      requestId: 'flag-1',
    });
    const duplicate = await asDesk.mutation(flagsApi.create, {
      propertyId: f.propertyId,
      bookingId: f.bookingId,
      kind: 'late_checkout',
      severity: 'attention',
      summary: 'Approved until 13:00',
      expectedBookingVersion: 0,
      requestId: 'flag-2',
    });
    expect(duplicate).toMatchObject({ flagId: first.flagId, existingOpen: true });
    expect(await t.run(async (ctx) => ctx.db.query('bookingOperationalFlags').collect())).toHaveLength(1);
  });

  it('requires restricted authority for lockout and payment-concern flags', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const input = {
      propertyId: f.propertyId,
      bookingId: f.bookingId,
      kind: 'lockout' as const,
      severity: 'urgent' as const,
      summary: 'Manager review',
      expectedBookingVersion: 0,
      requestId: 'restricted-1',
    };
    await expect(t.withIdentity(identityFor(f.desk.userId)).mutation(flagsApi.create, input))
      .rejects.toThrow(/CAPABILITY_DENIED/);
    await expect(t.withIdentity(identityFor(f.manager.userId)).mutation(flagsApi.create, {
      ...input, requestId: 'restricted-2',
    })).resolves.toMatchObject({ existingOpen: false });
  });

  it('assigns and resolves by version without changing booking or occupancy', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asManager = t.withIdentity(identityFor(f.manager.userId));
    const created = await asManager.mutation(flagsApi.create, {
      propertyId: f.propertyId, bookingId: f.bookingId, kind: 'payment_concern',
      severity: 'attention', summary: 'Review balance', expectedBookingVersion: 0, requestId: 'create-1',
    });
    const before = await t.run(async (ctx) => ({
      booking: await ctx.db.get(f.bookingId),
      nights: await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).collect(),
    }));
    const assigned = await asManager.mutation(flagsApi.assign, {
      propertyId: f.propertyId, flagId: created.flagId,
      assignedStaffProfileId: f.manager.profileId, expectedVersion: 0, requestId: 'assign-1',
    });
    expect(assigned.version).toBe(1);
    const resolved = await asManager.mutation(flagsApi.resolve, {
      propertyId: f.propertyId, flagId: created.flagId,
      expectedVersion: 1, resolutionNote: 'Reviewed at desk', requestId: 'resolve-1',
    });
    expect(resolved).toMatchObject({ state: 'resolved', version: 2 });
    const after = await t.run(async (ctx) => ({
      booking: await ctx.db.get(f.bookingId),
      nights: await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', f.bookingId)).collect(),
    }));
    expect(after).toEqual(before);
  });

  it('rejects stale edits, cross-property assignees, and request-id reuse', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asManager = t.withIdentity(identityFor(f.manager.userId));
    const created = await asManager.mutation(flagsApi.create, {
      propertyId: f.propertyId, bookingId: f.bookingId, kind: 'due_out', severity: 'info',
      summary: 'Expected today', expectedBookingVersion: 0, requestId: 'create-1',
    });
    await expect(asManager.mutation(flagsApi.assign, {
      propertyId: f.propertyId, flagId: created.flagId,
      assignedStaffProfileId: f.other.profileId, expectedVersion: 0, requestId: 'assign-cross',
    })).rejects.toThrow(/ASSIGNEE_PROPERTY_MISMATCH/);
    await expect(asManager.mutation(flagsApi.resolve, {
      propertyId: f.propertyId, flagId: created.flagId,
      expectedVersion: 99, requestId: 'resolve-stale',
    })).rejects.toThrow(/VERSION_CONFLICT/);
    await expect(asManager.mutation(flagsApi.resolve, {
      propertyId: f.propertyId, flagId: created.flagId,
      expectedVersion: 0, requestId: 'create-1',
    })).rejects.toThrow(/IDEMPOTENCY_KEY_REUSED/);
  });
});
