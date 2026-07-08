/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const modules = import.meta.glob('/convex/**/!(*.*.*)*.*s');

// syncNow schedules internal.channel.ari.pushAriForProperty (a fire-and-forget
// action). Drain scheduled functions in afterEach so they never leak across
// tests / surface as unhandled errors on a disposed fake DB (same pattern as
// bookings.test.ts).
const created: Array<ReturnType<typeof convexTest>> = [];
function makeT() {
  const t = convexTest(schema, modules);
  created.push(t);
  return t;
}
async function drainAll() {
  for (const t of created) {
    for (let i = 0; i < 50; i += 1) {
      const pending = await t.run(async (ctx) => {
        const jobs = await ctx.db.system.query('_scheduled_functions').collect();
        return jobs.filter((j) => j.state.kind === 'pending' || j.state.kind === 'inProgress').length;
      });
      if (pending === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }
  }
  created.length = 0;
}

afterEach(async () => {
  await drainAll();
  vi.unstubAllEnvs();
});

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seedUser(t: ReturnType<typeof convexTest>, email: string, name = 'Test User') {
  return await t.run(async (ctx) => ctx.db.insert('users', { email, name }));
}

async function seedOwner(t: ReturnType<typeof convexTest>, email = 'owner@example.com') {
  const userId = await seedUser(t, email, 'Owner');
  await t.run(async (ctx) =>
    ctx.db.insert('staffProfiles', {
      userId,
      name: 'Owner',
      role: 'owner',
      active: true,
      createdAt: Date.now(),
    }),
  );
  return userId;
}

async function seedStaff(t: ReturnType<typeof convexTest>, email = 'staffer@example.com') {
  const userId = await seedUser(t, email, 'Staffer');
  await t.run(async (ctx) =>
    ctx.db.insert('staffProfiles', {
      userId,
      name: 'Staffer',
      role: 'staff',
      active: true,
      createdAt: Date.now(),
    }),
  );
  return userId;
}

async function seedFixture(t: ReturnType<typeof convexTest>) {
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
    const ratePlanId = await ctx.db.insert('ratePlans', {
      propertyId,
      unitTypeId,
      name: 'Standard',
      active: true,
      currency: 'CAD',
      baseNightlyCents: 10_000,
      seasons: [],
      minStayNights: 1,
      maxStayNights: 28,
      minLeadTimeHours: 0,
      maxAdvanceDays: 365,
      prepBufferNights: 0,
      depositPolicy: { type: 'full', value: 0 },
      cancellationPolicy: [{ daysBefore: 0, refundPercent: 0 }],
    });
    return { propertyId, unitTypeId, ratePlanId };
  });
}

describe('channel.admin.getChannelConfig', () => {
  it('reports configured:false with no CHANNEX_API_KEY set', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.query(api.channel.admin.getChannelConfig, {});
    expect(result.configured).toBe(false);
  });

  it('reports configured:true once CHANNEX_API_KEY is set', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    const t = makeT();
    const ownerId = await seedOwner(t);
    await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.query(api.channel.admin.getChannelConfig, {});
    expect(result.configured).toBe(true);
    expect(typeof result.baseUrl).toBe('string');
  });

  it('shapes properties with unitTypes/ratePlans and a default-false enabled with no channelSync row', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.query(api.channel.admin.getChannelConfig, {});
    const property = result.properties.find((p) => p.propertyId === fx.propertyId);
    expect(property).toBeDefined();
    expect(property?.enabled).toBe(false);
    expect(property?.channexPropertyId).toBeUndefined();
    expect(property?.unitTypes).toEqual([
      { unitTypeId: fx.unitTypeId, name: 'Cabin', channexRoomTypeId: undefined },
    ]);
    expect(property?.ratePlans).toEqual([
      { ratePlanId: fx.ratePlanId, name: 'Standard', channexRatePlanId: undefined },
    ]);
  });

  it('reflects channelSync fields once connected', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: true,
    });

    const result = await asOwner.query(api.channel.admin.getChannelConfig, {});
    const property = result.properties.find((p) => p.propertyId === fx.propertyId);
    expect(property?.channexPropertyId).toBe('prop-uuid-1');
    expect(property?.enabled).toBe(true);
  });

  it('works under DEMO_MODE without any signed-in identity', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    await seedFixture(t);

    const result = await t.query(api.channel.admin.getChannelConfig, {});
    expect(result.properties.length).toBe(1);
  });
});

describe('channel.admin.setPropertyChannel', () => {
  it('is owner-only: a non-owner staff member is refused', async () => {
    const t = makeT();
    const staffUserId = await seedStaff(t);
    const fx = await seedFixture(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));

    await expect(
      asStaff.mutation(api.channel.admin.setPropertyChannel, {
        propertyId: fx.propertyId,
        channexPropertyId: 'prop-uuid-1',
        enabled: true,
      }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });

  it('rejects an unauthenticated caller', async () => {
    const t = makeT();
    const fx = await seedFixture(t);

    await expect(
      t.mutation(api.channel.admin.setPropertyChannel, {
        propertyId: fx.propertyId,
        channexPropertyId: 'prop-uuid-1',
        enabled: true,
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('creates a channelSync row on first connect with provider channex', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: true,
    });
    expect(result).toEqual({ ok: true });

    const sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync).toBeDefined();
    expect(sync?.provider).toBe('channex');
    expect(sync?.enabled).toBe(true);

    const property = await t.run(async (ctx) => ctx.db.get(fx.propertyId));
    expect(property?.channexPropertyId).toBe('prop-uuid-1');
  });

  it('toggles enabled on an existing channelSync row without duplicating it', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: true,
    });
    await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: false,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].enabled).toBe(false);
  });

  it('clearing channexPropertyId (empty string) disconnects and forces enabled false', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: true,
    });
    await asOwner.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: '',
      enabled: true, // should be forced to false since we're disconnecting
    });

    const property = await t.run(async (ctx) => ctx.db.get(fx.propertyId));
    expect(property?.channexPropertyId).toBeUndefined();

    const sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync?.enabled).toBe(false);
  });

  it('bypasses auth under DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    const fx = await seedFixture(t);

    const result = await t.mutation(api.channel.admin.setPropertyChannel, {
      propertyId: fx.propertyId,
      channexPropertyId: 'prop-uuid-1',
      enabled: true,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('channel.admin.setUnitTypeChannel', () => {
  it('patches the mapping id', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.mutation(api.channel.admin.setUnitTypeChannel, {
      unitTypeId: fx.unitTypeId,
      channexRoomTypeId: 'room-type-uuid-1',
    });
    expect(result).toEqual({ ok: true });

    const unitType = await t.run(async (ctx) => ctx.db.get(fx.unitTypeId));
    expect(unitType?.channexRoomTypeId).toBe('room-type-uuid-1');
  });

  it('clears the mapping id when given undefined/empty string', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.channel.admin.setUnitTypeChannel, {
      unitTypeId: fx.unitTypeId,
      channexRoomTypeId: 'room-type-uuid-1',
    });
    await asOwner.mutation(api.channel.admin.setUnitTypeChannel, {
      unitTypeId: fx.unitTypeId,
      channexRoomTypeId: '',
    });

    const unitType = await t.run(async (ctx) => ctx.db.get(fx.unitTypeId));
    expect(unitType?.channexRoomTypeId).toBeUndefined();
  });

  it('is owner-only', async () => {
    const t = makeT();
    const staffUserId = await seedStaff(t);
    const fx = await seedFixture(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));

    await expect(
      asStaff.mutation(api.channel.admin.setUnitTypeChannel, {
        unitTypeId: fx.unitTypeId,
        channexRoomTypeId: 'room-type-uuid-1',
      }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });
});

describe('channel.admin.setRatePlanChannel', () => {
  it('patches the mapping id', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.mutation(api.channel.admin.setRatePlanChannel, {
      ratePlanId: fx.ratePlanId,
      channexRatePlanId: 'rate-plan-uuid-1',
    });
    expect(result).toEqual({ ok: true });

    const ratePlan = await t.run(async (ctx) => ctx.db.get(fx.ratePlanId));
    expect(ratePlan?.channexRatePlanId).toBe('rate-plan-uuid-1');
  });

  it('is owner-only', async () => {
    const t = makeT();
    const staffUserId = await seedStaff(t);
    const fx = await seedFixture(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));

    await expect(
      asStaff.mutation(api.channel.admin.setRatePlanChannel, {
        ratePlanId: fx.ratePlanId,
        channexRatePlanId: 'rate-plan-uuid-1',
      }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });
});

describe('channel.admin.recentSyncLog', () => {
  it('returns rows newest-first, respecting the limit', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await t.run(async (ctx) => {
      await ctx.db.insert('channelSyncLog', {
        propertyId: fx.propertyId,
        provider: 'channex',
        kind: 'ari_push',
        ok: true,
        detail: 'first',
        ts: 1,
      });
      await ctx.db.insert('channelSyncLog', {
        propertyId: fx.propertyId,
        provider: 'channex',
        kind: 'ari_push',
        ok: true,
        detail: 'second',
        ts: 2,
      });
      await ctx.db.insert('channelSyncLog', {
        propertyId: fx.propertyId,
        provider: 'channex',
        kind: 'error',
        ok: false,
        detail: 'third',
        ts: 3,
      });
    });

    const rows = await asOwner.query(api.channel.admin.recentSyncLog, { propertyId: fx.propertyId });
    expect(rows.map((r) => r.detail)).toEqual(['third', 'second', 'first']);

    const limited = await asOwner.query(api.channel.admin.recentSyncLog, {
      propertyId: fx.propertyId,
      limit: 1,
    });
    expect(limited.length).toBe(1);
    expect(limited[0].detail).toBe('third');
  });

  it('is readable by any active staff member (not owner-only)', async () => {
    const t = makeT();
    const staffUserId = await seedStaff(t);
    const fx = await seedFixture(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));

    const rows = await asStaff.query(api.channel.admin.recentSyncLog, { propertyId: fx.propertyId });
    expect(rows).toEqual([]);
  });
});

describe('channel.admin.syncNow', () => {
  it('schedules pushAriForProperty and returns scheduled:true', async () => {
    const t = makeT();
    const ownerId = await seedOwner(t);
    const fx = await seedFixture(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.mutation(api.channel.admin.syncNow, { propertyId: fx.propertyId });
    expect(result).toEqual({ scheduled: true });
  });

  it('is owner-only', async () => {
    const t = makeT();
    const staffUserId = await seedStaff(t);
    const fx = await seedFixture(t);
    const asStaff = t.withIdentity(identityFor(staffUserId));

    await expect(
      asStaff.mutation(api.channel.admin.syncNow, { propertyId: fx.propertyId }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });
});
