/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const migration = (internal as any).dailyOperationsMigration;

async function seedLegacyAssignment(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      email: 'owner@example.test',
      name: 'Owner',
    });
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test',
      slug: 'test',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      email: 'test@example.test',
      phone: '555',
      address: '1 Road',
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
      icalExportToken: 'migration',
      icalImports: [],
      sortOrder: 1,
    });
    await ctx.db.insert('housekeepingAssignments', {
      propertyId,
      unitId,
      serviceDate: '2030-05-03',
      priority: 1,
      status: 'assigned',
      version: 0,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

describe('daily operations assignment migration', () => {
  it('previews without writes and patches each open legacy row once', async () => {
    const t = convexTest(schema, modules);
    await seedLegacyAssignment(t);

    expect(await t.query(migration.preview, { propertySlug: 'test' })).toEqual({
      eligible: 1,
      unchanged: 0,
    });
    expect(await t.mutation(migration.apply, {
      propertySlug: 'test',
      cleaningType: 'turnover',
      expectedMinutes: 45,
    })).toEqual({ updated: 1, unchanged: 0 });
    expect(await t.mutation(migration.apply, {
      propertySlug: 'test',
      cleaningType: 'turnover',
      expectedMinutes: 45,
    })).toEqual({ updated: 0, unchanged: 1 });
  });

  it('does not invent defaults for completed assignment history', async () => {
    const t = convexTest(schema, modules);
    await seedLegacyAssignment(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query('housekeepingAssignments').first();
      if (!row) throw new Error('missing fixture');
      await ctx.db.patch(row._id, { status: 'verified' });
    });

    expect(await t.mutation(migration.apply, {
      propertySlug: 'test',
      cleaningType: 'turnover',
      expectedMinutes: 45,
    })).toEqual({ updated: 0, unchanged: 0 });
  });
});
