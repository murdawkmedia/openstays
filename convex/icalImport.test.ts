/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

async function seedUnit(t: ReturnType<typeof convexTest>) {
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
      icalImports: [
        { url: 'https://airbnb.example.com/cabin-1.ics', label: 'Airbnb' },
        { url: 'https://vrbo.example.com/cabin-1.ics', label: 'VRBO' },
      ],
      sortOrder: 1,
    });
    return { propertyId, unitTypeId, unitId };
  });
}

function nightsOf(rows: Array<{ date: string; kind: string }>): string[] {
  return rows.map((r) => r.date).sort();
}

describe('listImportTargets', () => {
  it('returns active units with non-empty icalImports', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    await t.run(async (ctx) => {
      // Offline unit with imports should be excluded.
      await ctx.db.insert('units', {
        propertyId: fx.propertyId,
        unitTypeId: fx.unitTypeId,
        name: 'Cabin 2',
        slug: 'cabin-2',
        status: 'offline',
        icalExportToken: 'test-token-cabin-2',
        icalImports: [{ url: 'https://x.example.com/cabin-2.ics', label: 'Airbnb' }],
        sortOrder: 2,
      });
      // Active unit with no imports should be excluded.
      await ctx.db.insert('units', {
        propertyId: fx.propertyId,
        unitTypeId: fx.unitTypeId,
        name: 'Cabin 3',
        slug: 'cabin-3',
        status: 'active',
        icalExportToken: 'test-token-cabin-3',
        icalImports: [],
        sortOrder: 3,
      });
    });

    const targets = await t.query(internal.icalImport.listImportTargets, {});
    expect(targets).toHaveLength(1);
    expect(targets[0].unitId).toBe(fx.unitId);
    expect(targets[0].imports).toEqual([
      { url: 'https://airbnb.example.com/cabin-1.ics', label: 'Airbnb' },
      { url: 'https://vrbo.example.com/cabin-1.ics', label: 'VRBO' },
    ]);
  });
});

describe('applyUnitImport', () => {
  it('a fresh import inserts an external booking + unitNights', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);

    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }],
    });
    expect(result).toEqual({ inserted: 1, updated: 0, removed: 0, conflicts: 0 });

    const booking = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .first(),
    );
    expect(booking?.status).toBe('external');
    expect(booking?.source).toBe('ical:Airbnb');
    expect(booking?.externalUid).toBe('evt-1@airbnb.com');
    expect(booking?.guestId).toBeUndefined();
    expect(booking?.confirmationCode).toMatch(/^EXT-/);
    expect(booking?.syncConflict).toBe(false);

    const nights = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking!._id))
        .collect(),
    );
    expect(nightsOf(nights)).toEqual(['2026-07-15', '2026-07-16', '2026-07-17']);
    expect(nights.every((n) => n.kind === 'external')).toBe(true);
  });

  it('re-importing the same events is idempotent (no duplicate bookings/nights)', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    const events = [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }];

    await t.mutation(internal.icalImport.applyUnitImport, { unitId: fx.unitId, label: 'Airbnb', events });
    const result2 = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events,
    });
    expect(result2).toEqual({ inserted: 0, updated: 0, removed: 0, conflicts: 0 });

    const bookings = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .collect(),
    );
    expect(bookings).toHaveLength(1);

    const allNights = await t.run(async (ctx) => ctx.db.query('unitNights').collect());
    expect(allNights).toHaveLength(3);
  });

  it('a date change rewrites the booking + unitNights', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }],
    });

    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-20', endDate: '2026-07-23' }],
    });
    expect(result).toEqual({ inserted: 0, updated: 1, removed: 0, conflicts: 0 });

    const booking = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .first(),
    );
    expect(booking?.checkIn).toBe('2026-07-20');
    expect(booking?.checkOut).toBe('2026-07-23');

    const nights = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking!._id))
        .collect(),
    );
    expect(nightsOf(nights)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
  });

  it('a UID that vanishes from the feed cancels the booking and frees its nights', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }],
    });

    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [],
    });
    expect(result).toEqual({ inserted: 0, updated: 0, removed: 1, conflicts: 0 });

    const booking = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .first(),
    );
    expect(booking?.status).toBe('cancelled');

    const nights = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking!._id))
        .collect(),
    );
    expect(nights).toHaveLength(0);
  });

  it('overlap with an internal confirmed booking sets syncConflict and never touches internal nights', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);

    // Seed an internal 'confirmed' booking with its own unitNights, exactly
    // like bookings.ts would (unitNights rows written in the same mutation
    // that creates the booking — here simulated directly via t.run since
    // this test only needs the invariant, not the full booking flow).
    const internalBookingId: Id<'bookings'> = await t.run(async (ctx) => {
      const bookingId = await ctx.db.insert('bookings', {
        propertyId: fx.propertyId,
        unitId: fx.unitId,
        unitTypeId: fx.unitTypeId,
        checkIn: '2026-07-16',
        checkOut: '2026-07-19',
        nights: 3,
        adults: 2,
        children: 0,
        status: 'confirmed',
        source: 'online',
        confirmationCode: 'OS-INTRNL',
        statusHistory: [{ status: 'confirmed', ts: Date.now() }],
        notes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      for (const date of ['2026-07-16', '2026-07-17', '2026-07-18']) {
        await ctx.db.insert('unitNights', { unitId: fx.unitId, date, bookingId, kind: 'stay' });
      }
      return bookingId;
    });

    // External event overlaps: 2026-07-15..2026-07-20 vs internal 16-19.
    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-overlap@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-20' }],
    });
    expect(result.inserted).toBe(1);
    expect(result.conflicts).toBe(1);

    const externalBooking = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .filter((q) => q.eq(q.field('status'), 'external'))
        .first(),
    );
    expect(externalBooking?.syncConflict).toBe(true);

    // Internal booking + its nights are untouched.
    const internalBooking = await t.run(async (ctx) => ctx.db.get(internalBookingId));
    expect(internalBooking?.status).toBe('confirmed');
    const internalNights = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', internalBookingId))
        .collect(),
    );
    expect(nightsOf(internalNights)).toEqual(['2026-07-16', '2026-07-17', '2026-07-18']);
    expect(internalNights.every((n) => n.kind === 'stay')).toBe(true);

    // External rows exist ONLY for the free nights (15 and 19), never 16-18.
    const externalNights = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', externalBooking!._id))
        .collect(),
    );
    expect(nightsOf(externalNights)).toEqual(['2026-07-15', '2026-07-19']);
    expect(externalNights.every((n) => n.kind === 'external')).toBe(true);
  });

  it('two feeds with different labels do not interfere with each other', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);

    await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'airbnb-evt@airbnb.com', startDate: '2026-09-01', endDate: '2026-09-04' }],
    });
    await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'VRBO',
      events: [{ uid: 'vrbo-evt@vrbo.com', startDate: '2026-09-10', endDate: '2026-09-12' }],
    });

    const bookings = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .collect(),
    );
    expect(bookings).toHaveLength(2);
    expect(bookings.map((b) => b.source).sort()).toEqual(['ical:Airbnb', 'ical:VRBO']);

    // Removing the Airbnb feed's event must not touch the VRBO booking.
    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [],
    });
    expect(result.removed).toBe(1);

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .collect(),
    );
    const vrboBooking = remaining.find((b) => b.source === 'ical:VRBO');
    expect(vrboBooking?.status).toBe('external');
    const airbnbBooking = remaining.find((b) => b.source === 'ical:Airbnb');
    expect(airbnbBooking?.status).toBe('cancelled');
  });

  it('skips events for a unit that no longer exists without throwing', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    const bogusUnitId = fx.unitId; // valid id shape; simulate deletion
    await t.run(async (ctx) => ctx.db.delete(bogusUnitId));

    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: bogusUnitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }],
    });
    expect(result.inserted).toBe(0);
  });

  it('marks the property channel-dirty after occupancy changes on a connected property (CRITICAL: iCal→ARI)', async () => {
    // Regression guard for the CRITICAL cross-channel oversell: an iCal-imported
    // Airbnb booking blocks a unit-night here, so Channex MUST be told the
    // lowered count. applyUnitImport now marks the property dirty so the 1-min
    // 'channex ari flush' cron pushes the corrected availability (previously the
    // whole iCal path was invisible to Channex until the ~24h nightly resync).
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    // Connect + enable the property for channel sync.
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.propertyId, { channexPropertyId: 'chx-prop-1' });
      await ctx.db.insert('channelSync', {
        propertyId: fx.propertyId,
        provider: 'channex',
        enabled: true,
      });
    });

    await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events: [{ uid: 'evt-dirty@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }],
    });

    const sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync?.dirtySince).toBeGreaterThan(0);

    // listSyncTargets (what the flush cron consumes) now includes this property.
    const targets = await t.query(internal.channel.ari.listSyncTargets, {});
    expect(targets).toContain(fx.propertyId);
  });

  it('does NOT mark dirty when a re-import changes nothing (no redundant push)', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.propertyId, { channexPropertyId: 'chx-prop-1' });
      await ctx.db.insert('channelSync', {
        propertyId: fx.propertyId,
        provider: 'channex',
        enabled: true,
      });
    });
    const events = [{ uid: 'evt-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18' }];
    // First import marks dirty…
    await t.mutation(internal.icalImport.applyUnitImport, { unitId: fx.unitId, label: 'Airbnb', events });
    // …clear the flag as a push would…
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique();
      await ctx.db.patch(row!._id, { dirtySince: undefined });
    });
    // …then a no-op re-import must NOT re-dirty the property.
    const result = await t.mutation(internal.icalImport.applyUnitImport, {
      unitId: fx.unitId,
      label: 'Airbnb',
      events,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, removed: 0, conflicts: 0 });
    const sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync?.dirtySince).toBeUndefined();
  });
});

describe('syncAll', () => {
  it('fetches each unit+feed, applies events, and records lastSyncedAt/lastStatus', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);

    const icsBody = [
      'BEGIN:VEVENT',
      'UID:sync-evt-1@airbnb.com',
      'DTSTART;VALUE=DATE:20260715',
      'DTEND;VALUE=DATE:20260718',
      'END:VEVENT',
    ].join('\r\n');

    const originalFetch = globalThis.fetch;
    const fetchMock = async (_url: string | URL | Request) => {
      return new Response(icsBody, { status: 200 });
    };
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await t.action(internal.icalImport.syncAll, {});
    } finally {
      globalThis.fetch = originalFetch;
    }

    const unit = await t.run(async (ctx) => ctx.db.get(fx.unitId));
    expect(unit?.icalImports.every((i) => i.lastSyncedAt !== undefined)).toBe(true);
    expect(unit?.icalImports.every((i) => i.lastStatus?.startsWith('ok:'))).toBe(true);

    const bookings = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .collect(),
    );
    // Both feeds parsed the same ICS body in this test, so both produce a
    // booking for the same UID under their own label (source differs).
    expect(bookings).toHaveLength(2);
  });

  it('isolates a failing feed so the other feed still syncs', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedUnit(t);

    const icsBody = [
      'BEGIN:VEVENT',
      'UID:isolated-evt@vrbo.com',
      'DTSTART;VALUE=DATE:20260901',
      'DTEND;VALUE=DATE:20260903',
      'END:VEVENT',
    ].join('\r\n');

    const originalFetch = globalThis.fetch;
    const fetchMock = async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('airbnb')) {
        throw new Error('network unreachable');
      }
      return new Response(icsBody, { status: 200 });
    };
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await t.action(internal.icalImport.syncAll, {});
    } finally {
      globalThis.fetch = originalFetch;
    }

    const unit = await t.run(async (ctx) => ctx.db.get(fx.unitId));
    const airbnbImport = unit?.icalImports.find((i) => i.label === 'Airbnb');
    const vrboImport = unit?.icalImports.find((i) => i.label === 'VRBO');
    expect(airbnbImport?.lastStatus).toMatch(/^error:/);
    expect(vrboImport?.lastStatus).toMatch(/^ok:/);

    const bookings = await t.run(async (ctx) =>
      ctx.db
        .query('bookings')
        .withIndex('by_unit_checkIn', (q) => q.eq('unitId', fx.unitId))
        .collect(),
    );
    expect(bookings).toHaveLength(1);
    expect(bookings[0].source).toBe('ical:VRBO');
  });
});
