/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

async function seedUnit(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
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
      icalExportToken: 'schema',
      icalImports: [],
      sortOrder: 1,
    });
    return { userId, propertyId, unitId };
  });
}

describe('daily operations schema', () => {
  it('keeps legacy housekeeping assignments valid', async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedUnit(t);
    const result = await t.run(async (ctx) => {
      const assignmentId = await ctx.db.insert('housekeepingAssignments', {
        propertyId: fixture.propertyId,
        unitId: fixture.unitId,
        serviceDate: '2030-05-03',
        priority: 1,
        status: 'assigned',
        version: 0,
        createdBy: fixture.userId,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.get(assignmentId);
    });
    expect(result?.cleaningType).toBeUndefined();
  });

  it('registers property-scoped flag and checklist snapshot tables', async () => {
    const tables = (schema as unknown as { tables: Record<string, unknown> }).tables;
    expect(Object.keys(tables)).toEqual(expect.arrayContaining([
      'bookingOperationalFlags',
      'housekeepingChecklistTemplates',
      'housekeepingChecklistItems',
    ]));
  });
});
