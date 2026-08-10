/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'owner@example.com', name: 'Owner' });
    await ctx.db.insert('staffProfiles', {
      userId,
      name: 'Owner',
      role: 'owner',
      active: true,
      createdAt: Date.now(),
    });
    const propertyId = await ctx.db.insert('properties', {
      name: 'Kokanee Test Grounds',
      slug: 'kokanee-test',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      email: 'stay@example.com',
      phone: '555',
      address: '1 Test Road',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'RV Site',
      slug: 'rv-site',
      kind: 'site',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 6,
      amenities: [],
      comingSoon: false,
      sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'A-01',
      slug: 'a-01',
      status: 'active',
      icalExportToken: 'foundation-test-token',
      icalImports: [],
      sortOrder: 1,
    });
    return { userId, propertyId, unitId };
  });
}

describe('operations foundation', () => {
  it('sets per-property feature flags idempotently and audits the actor once', async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const asOwner = t.withIdentity(identityFor(fixture.userId));
    const mutation = (api as any).operationsFoundation.setFeatureFlag;
    const args = {
      propertyId: fixture.propertyId,
      feature: 'command_center',
      enabled: true,
      requestId: 'req-feature-command-center',
    };

    const first = await asOwner.mutation(mutation, args);
    const replay = await asOwner.mutation(mutation, args);
    const state = await asOwner.query((api as any).operationsFoundation.snapshot, {
      propertyId: fixture.propertyId,
    });

    expect(first).toMatchObject({ enabled: true, replayed: false });
    expect(replay).toMatchObject({ enabled: true, replayed: true });
    expect(state.features).toEqual([{ feature: 'command_center', enabled: true, version: 1 }]);
    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).filter((row) => row.action === 'feature.set'),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].actorName).toBe('Owner');
  });

  it('groups units many-to-many and stores structured attributes', async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const asOwner = t.withIdentity(identityFor(fixture.userId));

    const group = await asOwner.mutation((api as any).operationsFoundation.createUnitGroup, {
      propertyId: fixture.propertyId,
      name: 'Big Rigs',
      slug: 'big-rigs',
      requestId: 'req-group-big-rigs',
    });
    await asOwner.mutation((api as any).operationsFoundation.addUnitGroupMember, {
      propertyId: fixture.propertyId,
      unitGroupId: group.unitGroupId,
      unitId: fixture.unitId,
      requestId: 'req-member-a01',
    });
    await asOwner.mutation((api as any).operationsFoundation.setUnitAttributes, {
      propertyId: fixture.propertyId,
      unitId: fixture.unitId,
      expectedVersion: 0,
      requestId: 'req-attributes-a01',
      attributes: {
        siteLengthFeet: 45,
        hookups: ['30_amp', 'water', 'sewer'],
        parkingStyle: 'pull_through',
        accessible: true,
        petPolicy: 'allowed',
      },
    });

    const state = await asOwner.query((api as any).operationsFoundation.snapshot, {
      propertyId: fixture.propertyId,
    });
    expect(state.unitGroups).toHaveLength(1);
    expect(state.unitGroups[0].unitIds).toEqual([fixture.unitId]);
    expect(state.units[0].attributes).toMatchObject({
      siteLengthFeet: 45,
      parkingStyle: 'pull_through',
      accessible: true,
    });
    expect(state.units[0].attributesVersion).toBe(1);
  });

  it('rejects stale attribute writes without changing the current server state', async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    const asOwner = t.withIdentity(identityFor(fixture.userId));
    const mutation = (api as any).operationsFoundation.setUnitAttributes;
    const base = {
      propertyId: fixture.propertyId,
      unitId: fixture.unitId,
      attributes: { accessible: false },
    };
    await asOwner.mutation(mutation, {
      ...base,
      expectedVersion: 0,
      requestId: 'req-attributes-first',
    });
    await expect(
      asOwner.mutation(mutation, {
        ...base,
        expectedVersion: 0,
        requestId: 'req-attributes-stale',
      }),
    ).rejects.toThrow(/VERSION_CONFLICT/);
  });
});
