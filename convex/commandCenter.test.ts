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
    await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: Date.now() });
    const propertyId = await ctx.db.insert('properties', {
      name: 'Kokanee Test', slug: 'kokanee-test', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'stay@example.com', phone: '555', address: '1 Test Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    await ctx.db.insert('propertyFeatures', {
      propertyId, feature: 'command_center', enabled: true, version: 1,
      updatedBy: userId, updatedAt: Date.now(),
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Site', slug: 'site', kind: 'site', bookingMode: 'nightly', description: '',
      photoUrls: [], maxOccupancy: 6, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitAId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'A-01', slug: 'a-01', status: 'active',
      icalExportToken: 'command-a', icalImports: [], sortOrder: 1,
    });
    const unitBId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'A-02', slug: 'a-02', status: 'active',
      icalExportToken: 'command-b', icalImports: [], sortOrder: 2,
    });
    const ratePlanId = await ctx.db.insert('ratePlans', {
      propertyId, unitTypeId, name: 'Standard', active: true, currency: 'CAD', baseNightlyCents: 10_000,
      seasons: [], minStayNights: 1, maxStayNights: 30, minLeadTimeHours: 0, maxAdvanceDays: 3650,
      prepBufferNights: 0, depositPolicy: { type: 'full', value: 0 },
      cancellationPolicy: [{ daysBefore: 0, refundPercent: 0 }],
    });
    return { userId, propertyId, unitTypeId, unitAId, unitBId, ratePlanId };
  });
}

describe('command-center reservation workflows', () => {
  it('creates an audited inventory block idempotently', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    const mutation = (api as any).operations.createBlock;
    const args = {
      propertyId: f.propertyId,
      unitId: f.unitAId,
      checkIn: '2030-06-01',
      checkOut: '2030-06-03',
      reason: 'Water-line repair',
      requestId: 'req-block-a01',
    };
    const first = await asOwner.mutation(mutation, args);
    const replay = await asOwner.mutation(mutation, args);
    const state = await t.run(async (ctx) => ({
      bookings: await ctx.db.query('bookings').collect(),
      nights: await ctx.db.query('unitNights').collect(),
      audits: (await ctx.db.query('auditLog').collect()).filter((row) => row.action === 'booking.block'),
    }));
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ bookingId: first.bookingId, replayed: true });
    expect(state.bookings).toHaveLength(1);
    expect(state.bookings[0].status).toBe('blocked');
    expect(state.nights.map((night) => night.date)).toEqual(['2030-06-01', '2030-06-02']);
    expect(state.audits).toHaveLength(1);
  });

  it('rolls back a conflicted move and atomically reacquires nights on success', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const bookingId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('bookings', {
        propertyId: f.propertyId, unitId: f.unitAId, unitTypeId: f.unitTypeId,
        checkIn: '2030-07-01', checkOut: '2030-07-03', nights: 2, adults: 2, children: 0,
        status: 'confirmed', source: 'front_desk', confirmationCode: 'OS-MOVE01',
        statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [], createdAt: 1, updatedAt: 1, version: 0,
      });
      for (const date of ['2030-07-01', '2030-07-02']) await ctx.db.insert('unitNights', { unitId: f.unitAId, date, bookingId: id, kind: 'stay' });
      const conflictId = await ctx.db.insert('bookings', {
        propertyId: f.propertyId, unitId: f.unitBId, unitTypeId: f.unitTypeId,
        checkIn: '2030-07-01', checkOut: '2030-07-03', nights: 2, adults: 1, children: 0,
        status: 'confirmed', source: 'front_desk', confirmationCode: 'OS-CONFLICT',
        statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [], createdAt: 1, updatedAt: 1, version: 0,
      });
      for (const date of ['2030-07-01', '2030-07-02']) await ctx.db.insert('unitNights', { unitId: f.unitBId, date, bookingId: conflictId, kind: 'stay' });
      return id;
    });
    const asOwner = t.withIdentity(identityFor(f.userId));
    const mutation = (api as any).operations.moveBooking;
    await expect(asOwner.mutation(mutation, {
      propertyId: f.propertyId, bookingId, targetUnitId: f.unitBId,
      checkIn: '2030-07-01', checkOut: '2030-07-03', expectedVersion: 0, requestId: 'req-move-conflict',
    })).rejects.toThrow(/DATES_UNAVAILABLE/);
    const unchanged = await t.run(async (ctx) => ctx.db.get(bookingId));
    expect(unchanged).toMatchObject({ unitId: f.unitAId, checkIn: '2030-07-01', version: 0 });

    const moved = await asOwner.mutation(mutation, {
      propertyId: f.propertyId, bookingId, targetUnitId: f.unitBId,
      checkIn: '2030-07-05', checkOut: '2030-07-07', expectedVersion: 0, requestId: 'req-move-success',
    });
    expect(moved).toMatchObject({ version: 1, replayed: false });
    const nights = await t.run(async (ctx) =>
      ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', bookingId)).collect(),
    );
    expect(nights.map((night) => `${night.unitId}:${night.date}`)).toEqual([
      `${f.unitBId}:2030-07-05`, `${f.unitBId}:2030-07-06`,
    ]);
  });

  it('keeps quotes non-blocking and creates the normal hold only on acceptance', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asOwner = t.withIdentity(identityFor(f.userId));
    const quote = await asOwner.mutation((api as any).operations.createQuote, {
      propertyId: f.propertyId, unitId: f.unitAId, ratePlanId: f.ratePlanId,
      checkIn: '2030-08-01', checkOut: '2030-08-03', adults: 2, children: 1,
      guest: { name: 'Guest One', email: 'guest@example.com', phone: '555-0100' },
      expiresAt: Date.now() + 86_400_000, requestId: 'req-quote-one',
    });
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(0);

    const accepted = await asOwner.mutation((api as any).operations.acceptQuote, {
      propertyId: f.propertyId, quoteId: quote.quoteId, expectedVersion: 0, requestId: 'req-quote-accept',
    });
    const booking = await t.run(async (ctx) => ctx.db.get(accepted.bookingId));
    expect(booking).toMatchObject({ status: 'hold', unitId: f.unitAId, nights: 2 });
    expect((booking as any)?.holdExpiresAt).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(2);
    const storedQuote = await t.run(async (ctx) => ctx.db.get(quote.quoteId));
    expect(storedQuote).toMatchObject({ status: 'accepted', convertedBookingId: accepted.bookingId, version: 1 });
  });
});
