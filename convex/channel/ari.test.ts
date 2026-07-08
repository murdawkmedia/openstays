/// <reference types="vite/client" />
// Tests for computeAriForProperty (the free-count + rate computation) and the
// dirty/flush plumbing. computeAriForProperty is an internalQuery — invoked
// directly via t.query(internal.channel.ari.computeAriForProperty).
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { addDays, todayInTimezone } from '../../shared/pricing';

// Absolute-from-project-root glob: from a nested test dir, a `../**` relative
// glob does NOT re-capture sibling channel modules in Vite, so convex-test
// can't resolve `channel/*`. Rooting at `/convex/**` captures every module
// (incl. _generated), which is what convex-test needs.
const modules = import.meta.glob('/convex/**/!(*.*.*)*.*s');

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
  vi.unstubAllGlobals();
});

const TZ = 'America/Edmonton';
const todayIso = todayInTimezone(TZ);
const D = (offset: number) => addDays(todayIso, offset);

/**
 * Seed a property with:
 *  - a mapped nightly unitType 'Cabin' (channexRoomTypeId) with 2 active units
 *  - a mapped rate plan (channexRatePlanId) at $100/night, minStay 2
 *  - an UNMAPPED nightly unitType 'Tent' (no channexRoomTypeId) — must be excluded
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { mapped?: boolean; minStay?: number } = {},
) {
  const mapped = opts.mapped ?? true;
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: TZ,
      currency: 'CAD',
      taxRateBps: 500,
      email: 't@example.com',
      phone: '555',
      address: '1 Test Rd',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
      channexPropertyId: mapped ? 'chx-prop-1' : undefined,
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
      channexRoomTypeId: 'chx-rt-cabin',
    });
    const unitAId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'Cabin 1',
      slug: 'cabin-1',
      status: 'active',
      icalExportToken: 'tok-cabin-1-aaaaaaaaaaaa',
      icalImports: [],
      sortOrder: 1,
    });
    const unitBId = await ctx.db.insert('units', {
      propertyId,
      unitTypeId,
      name: 'Cabin 2',
      slug: 'cabin-2',
      status: 'active',
      icalExportToken: 'tok-cabin-2-bbbbbbbbbbbb',
      icalImports: [],
      sortOrder: 2,
    });
    const ratePlanId = await ctx.db.insert('ratePlans', {
      propertyId,
      unitTypeId,
      name: 'Standard',
      active: true,
      currency: 'CAD',
      baseNightlyCents: 10_000,
      seasons: [],
      minStayNights: opts.minStay ?? 2,
      maxStayNights: 28,
      minLeadTimeHours: 0,
      maxAdvanceDays: 365,
      prepBufferNights: 0,
      depositPolicy: { type: 'full', value: 0 },
      cancellationPolicy: [],
      channexRatePlanId: 'chx-rp-standard',
    });

    // An UNMAPPED unit type — must be excluded from availability rows.
    const tentTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'Tent',
      slug: 'tent',
      kind: 'site',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 2,
      amenities: [],
      comingSoon: false,
      sortOrder: 3,
      // no channexRoomTypeId
    });
    await ctx.db.insert('units', {
      propertyId,
      unitTypeId: tentTypeId,
      name: 'Tent 1',
      slug: 'tent-1',
      status: 'active',
      icalExportToken: 'tok-tent-1-cccccccccccc',
      icalImports: [],
      sortOrder: 1,
    });

    return { propertyId, unitTypeId, unitAId, unitBId, ratePlanId, tentTypeId };
  });
}

/** Insert a booking + one unitNights row per night [checkIn, checkOut). */
async function book(
  t: ReturnType<typeof convexTest>,
  fx: { propertyId: Id<'properties'>; unitTypeId: Id<'unitTypes'> },
  unitId: Id<'units'>,
  checkIn: string,
  checkOut: string,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const bookingId = await ctx.db.insert('bookings', {
      propertyId: fx.propertyId,
      unitId,
      unitTypeId: fx.unitTypeId,
      status: 'confirmed',
      checkIn,
      checkOut,
      nights: 1,
      adults: 2,
      children: 0,
      source: 'front_desk',
      confirmationCode: `OS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      statusHistory: [{ status: 'confirmed', ts: now }],
      notes: [],
      createdAt: now,
      updatedAt: now,
    });
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      await ctx.db.insert('unitNights', { unitId, date: d, bookingId, kind: 'stay' });
    }
  });
}

describe('computeAriForProperty', () => {
  it('returns null when the property has no channexPropertyId', async () => {
    const t = makeT();
    const fx = await seed(t, { mapped: false });
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: fx.propertyId,
      horizonDays: 5,
    });
    expect(ari).toBeNull();
  });

  it('computes free counts: 2 units → 2 free normally, 1 free on a night with one booked', async () => {
    const t = makeT();
    const fx = await seed(t);
    // Book unit A for the night D(2) only.
    await book(t, fx, fx.unitAId, D(2), D(3));

    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: fx.propertyId,
      horizonDays: 5,
    });
    expect(ari).not.toBeNull();
    expect(ari!.channexPropertyId).toBe('chx-prop-1');

    // Availability rows exist for the mapped Cabin type only (Tent excluded).
    const cabinRows = ari!.availability.filter((r) => r.roomTypeId === 'chx-rt-cabin');
    const tentRows = ari!.availability.filter((r) => r.roomTypeId !== 'chx-rt-cabin');
    expect(tentRows).toHaveLength(0);
    expect(cabinRows).toHaveLength(5); // 5 nights in the horizon

    const byDate = new Map(cabinRows.map((r) => [r.date, r.availability]));
    // D(2) has one unit booked → availability 1; every other night → 2.
    expect(byDate.get(D(2))).toBe(1);
    expect(byDate.get(D(0))).toBe(2);
    expect(byDate.get(D(1))).toBe(2);
    expect(byDate.get(D(3))).toBe(2);
    expect(byDate.get(D(4))).toBe(2);
  });

  it('drops availability to 0 when every unit is booked for a night (no negative counts)', async () => {
    const t = makeT();
    const fx = await seed(t);
    await book(t, fx, fx.unitAId, D(1), D(2));
    await book(t, fx, fx.unitBId, D(1), D(2));
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: fx.propertyId,
      horizonDays: 3,
    });
    const byDate = new Map(
      ari!.availability
        .filter((r) => r.roomTypeId === 'chx-rt-cabin')
        .map((r) => [r.date, r.availability]),
    );
    expect(byDate.get(D(1))).toBe(0);
    expect(byDate.get(D(0))).toBe(2);
  });

  it('emits restriction rows with decimal rate strings + minStayArrival when > 1', async () => {
    const t = makeT();
    const fx = await seed(t, { minStay: 2 });
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: fx.propertyId,
      horizonDays: 2,
    });
    const rows = ari!.restrictions.filter((r) => r.ratePlanId === 'chx-rp-standard');
    expect(rows).toHaveLength(2);
    // $100.00 as a decimal string, not cents, not a float.
    expect(rows[0].rate).toBe('100.00');
    expect(rows[0].minStayArrival).toBe(2);
  });

  it('omits minStayArrival when the plan minStay is 1', async () => {
    const t = makeT();
    const fx = await seed(t, { minStay: 1 });
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: fx.propertyId,
      horizonDays: 1,
    });
    const rows = ari!.restrictions.filter((r) => r.ratePlanId === 'chx-rp-standard');
    expect(rows[0].rate).toBe('100.00');
    expect(rows[0].minStayArrival).toBeUndefined();
  });
});

describe('markDirty / flushDirty plumbing', () => {
  it('markDirty sets dirtySince only on an enabled channelSync row', async () => {
    const t = makeT();
    const fx = await seed(t);
    // No channelSync row yet → markDirty is a no-op.
    await t.mutation(internal.channel.ari.markDirty, { propertyId: fx.propertyId });
    let sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync).toBeNull();

    // Add an enabled row → markDirty stamps dirtySince.
    await t.run(async (ctx) => {
      await ctx.db.insert('channelSync', {
        propertyId: fx.propertyId,
        provider: 'channex',
        enabled: true,
      });
    });
    await t.mutation(internal.channel.ari.markDirty, { propertyId: fx.propertyId });
    sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync?.dirtySince).toBeGreaterThan(0);
  });

  it('listSyncTargets returns enabled+dirty properties (and all enabled on fullResync)', async () => {
    const t = makeT();
    const fx = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('channelSync', {
        propertyId: fx.propertyId,
        provider: 'channex',
        enabled: true,
        // not dirty
      });
    });
    // Not dirty → excluded from a normal flush.
    const dirtyTargets = await t.query(internal.channel.ari.listSyncTargets, {});
    expect(dirtyTargets).toHaveLength(0);
    // fullResync → included regardless of dirty.
    const fullTargets = await t.query(internal.channel.ari.listSyncTargets, { fullResync: true });
    expect(fullTargets).toContain(fx.propertyId);
  });
});
