/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { addDays } from '../shared/pricing';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

// Dates far enough out to satisfy lead-time rules regardless of when CI runs.
const today = new Date().toISOString().slice(0, 10);
const D = (offset: number) => addDays(today, offset);

async function seedFixture(t: ReturnType<typeof convexTest>, opts: { prepBufferNights?: number } = {}) {
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
      prepBufferNights: opts.prepBufferNights ?? 0,
      depositPolicy: { type: 'full', value: 0 },
      cancellationPolicy: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    });
    return { propertyId, unitTypeId, unitId, ratePlanId };
  });
}

const guest = (email = 'guest@example.com') => ({
  name: 'Test Guest',
  email,
  phone: '780-555-0100',
  marketingOptIn: false,
});

function holdArgs(
  fx: { unitId: Id<'units'>; ratePlanId: Id<'ratePlans'> },
  checkIn: string,
  checkOut: string,
  email?: string,
) {
  return {
    unitId: fx.unitId,
    ratePlanId: fx.ratePlanId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guest: guest(email),
    addOns: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createHold conflict prevention', () => {
  it('rejects an overlapping second hold', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    await expect(
      t.mutation(api.bookings.createHold, holdArgs(fx, D(12), D(15), 'other@example.com')),
    ).rejects.toThrow(/DATES_UNAVAILABLE|taken/);
  });

  it('allows perfectly adjacent stays (half-open ranges)', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const second = await t.mutation(
      api.bookings.createHold,
      holdArgs(fx, D(13), D(15), 'other@example.com'),
    );
    expect(second.confirmationCode).toMatch(/^OS-/);
  });

  it('prep buffer blocks the night after checkout', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t, { prepBufferNights: 1 });
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    // Checkout D(13) + 1 prep night blocks D(13); check-in D(13) must fail…
    await expect(
      t.mutation(api.bookings.createHold, holdArgs(fx, D(13), D(15), 'other@example.com')),
    ).rejects.toThrow(/DATES_UNAVAILABLE|taken/);
    // …but D(14) is free.
    const ok = await t.mutation(
      api.bookings.createHold,
      holdArgs(fx, D(14), D(16), 'third@example.com'),
    );
    expect(ok.confirmationCode).toMatch(/^OS-/);
  });

  it('caps concurrent holds per guest email', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(11)));
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(12), D(13)));
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(14), D(15)));
    await expect(
      t.mutation(api.bookings.createHold, holdArgs(fx, D(16), D(17))),
    ).rejects.toThrow(/TOO_MANY_HOLDS|Too many/);
  });
});

describe('hold expiry', () => {
  it('expireHolds releases nights so the dates can be rebooked', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fx = await seedFixture(t);
      await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));

      // Jump past the 35-minute TTL, run the cron body.
      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      const result = await t.mutation(internal.bookings.expireHolds, {});
      expect(result.expired).toBe(1);

      const rebook = await t.mutation(
        api.bookings.createHold,
        holdArgs(fx, D(10), D(13), 'other@example.com'),
      );
      expect(rebook.confirmationCode).toMatch(/^OS-/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expire fresh holds', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const result = await t.mutation(internal.bookings.expireHolds, {});
    expect(result.expired).toBe(0);
  });
});

describe('simulated confirmation (demo path)', () => {
  it('is refused unless DEMO_MODE=true', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    await expect(
      t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId }),
    ).rejects.toThrow(/DEMO_ONLY|demo-only/);
  });

  it('confirms a hold and records a simulated payment in DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    const confirmed = await t.mutation(api.bookings.confirmSimulated, {
      bookingId: hold.bookingId,
    });
    expect(confirmed.confirmationCode).toBe(hold.confirmationCode);

    const view = await t.query(api.bookings.byConfirmationCode, { code: hold.confirmationCode });
    expect(view?.status).toBe('confirmed');
  });
});

describe('guest cancellation', () => {
  it('cancels with matching code+email, frees nights, computes policy refund', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(30), D(32)));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId });

    const result = await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    // 30 days out, policy gives 100% of paid.
    expect(result.refundCents).toBe(result.paidCents);
    expect(result.paidCents).toBeGreaterThan(0);

    const rebook = await t.mutation(
      api.bookings.createHold,
      holdArgs(fx, D(30), D(32), 'other@example.com'),
    );
    expect(rebook.confirmationCode).toMatch(/^OS-/);
  });

  it('rejects a wrong email', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    await expect(
      t.mutation(api.bookings.cancelByGuest, {
        confirmationCode: hold.confirmationCode,
        email: 'wrong@example.com',
      }),
    ).rejects.toThrow(/NOT_FOUND|not found/);
  });
});

describe('unitNights invariant', () => {
  it('active bookings own exactly their stay+prep rows; released on expiry', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const fx = await seedFixture(t, { prepBufferNights: 1 });
      const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query('unitNights')
          .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
          .collect(),
      );
      expect(rows.map((r) => r.date).sort()).toEqual([D(10), D(11), D(12), D(13)]);
      expect(rows.filter((r) => r.kind === 'stay')).toHaveLength(3);
      expect(rows.filter((r) => r.kind === 'prep')).toHaveLength(1);

      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      await t.mutation(internal.bookings.expireHolds, {});
      const after = await t.run(async (ctx) =>
        ctx.db
          .query('unitNights')
          .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
          .collect(),
      );
      expect(after).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('repairUnitNights rebuilds rows exactly', async () => {
    const t = convexTest(schema, modules);
    const fx = await seedFixture(t, { prepBufferNights: 1 });
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));

    // Sabotage the derived table, then repair.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('unitNights').collect();
      for (const row of rows) await ctx.db.delete(row._id);
    });
    const repaired = await t.mutation(internal.bookings.repairUnitNights, {});
    expect(repaired.rebuilt).toBe(4); // 3 stay + 1 prep

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
        .collect(),
    );
    expect(rows).toHaveLength(4);
  });
});
