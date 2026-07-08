/// <reference types="vite/client" />
// Auth-surface tests for availability.tapeForProperty: the admin booking tape
// leaks every booking's confirmation code + full occupancy, so it must be
// staff-gated on real deployments (DEMO_MODE stays open for the public demo).
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seedTapeFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      email: 't@example.com',
      phone: '555',
      address: '1 Test Rd',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'Cabin',
      slug: 'cabin',
      kind: 'cabin',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 4,
      amenities: [],
      comingSoon: false,
      sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'Cabin 1',
      slug: 'cabin-1',
      status: 'active',
      icalExportToken: 'test-token-cabin-1-xxxxxxxxxxxx',
      icalImports: [],
      sortOrder: 1,
    });
    const now = Date.now();
    await ctx.db.insert('bookings', {
      propertyId,
      unitId,
      unitTypeId,
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      nights: 3,
      adults: 2,
      children: 0,
      status: 'confirmed',
      source: 'online',
      confirmationCode: 'OS-TEST01',
      statusHistory: [{ status: 'confirmed', ts: now }],
      notes: [],
      createdAt: now,
      updatedAt: now,
    });
    return { propertyId };
  });
}

async function seedStaffUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'staff@example.com', name: 'Staffer' });
    await ctx.db.insert('staffProfiles', {
      userId,
      name: 'Staffer',
      role: 'staff',
      active: true,
      createdAt: Date.now(),
    });
    return userId;
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('availability.tapeForProperty auth', () => {
  it('rejects an anonymous (wire-level) call', async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedTapeFixture(t);
    await expect(
      t.query(api.availability.tapeForProperty, { propertyId, startDate: '2026-07-01', days: 30 }),
    ).rejects.toThrow(/UNAUTHENTICATED|NOT_STAFF/);
  });

  it('returns the tape (incl. confirmation codes) for an authenticated staff member', async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedTapeFixture(t);
    const staffUserId = await seedStaffUser(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));
    const result = await asStaff.query(api.availability.tapeForProperty, {
      propertyId,
      startDate: '2026-07-01',
      days: 30,
    });
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].confirmationCode).toBe('OS-TEST01');
  });

  it('DEMO_MODE keeps the public demo tape open (no auth required)', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const { propertyId } = await seedTapeFixture(t);
    const result = await t.query(api.availability.tapeForProperty, {
      propertyId,
      startDate: '2026-07-01',
      days: 30,
    });
    expect(result.bookings).toHaveLength(1);
  });
});
