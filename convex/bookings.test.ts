/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { addDays } from '../shared/pricing';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

// Booking mutations now fire-and-forget schedule transactional emails
// (internal.email.sendBookingEmail) via ctx.scheduler.runAfter(0, …). In
// convex-test those execute on a real setTimeout(0); if the test ends before
// they run, their internal job-state write lands "outside a transaction" on the
// disposed fake DB and surfaces as an unhandled error. Track every t created in
// this file and deterministically drain its scheduled functions in afterEach.
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

afterEach(async () => {
  await drainAll();
  vi.unstubAllEnvs();
});

describe('createHold conflict prevention', () => {
  it('rejects an overlapping second hold', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    await expect(
      t.mutation(api.bookings.createHold, holdArgs(fx, D(12), D(15), 'other@example.com')),
    ).rejects.toThrow(/DATES_UNAVAILABLE|taken/);
  });

  it('allows perfectly adjacent stays (half-open ranges)', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const second = await t.mutation(
      api.bookings.createHold,
      holdArgs(fx, D(13), D(15), 'other@example.com'),
    );
    expect(second.confirmationCode).toMatch(/^OS-/);
  });

  it('prep buffer blocks the night after checkout', async () => {
    const t = makeT();
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
    const t = makeT();
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(11)));
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(12), D(13)));
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(14), D(15)));
    await expect(
      t.mutation(api.bookings.createHold, holdArgs(fx, D(16), D(17))),
    ).rejects.toThrow(/TOO_MANY_HOLDS|Too many/);
  });
});

describe('occupancy enforcement', () => {
  it('rejects a hold that exceeds the unit type maxOccupancy', async () => {
    const t = makeT();
    const fx = await seedFixture(t); // maxOccupancy: 4
    await expect(
      t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(10), D(12)),
        adults: 3,
        children: 2, // 3 + 2 = 5 > 4
      }),
    ).rejects.toThrow(/OVER_OCCUPANCY|at most/);
  });

  it('allows a hold exactly at maxOccupancy', async () => {
    const t = makeT();
    const fx = await seedFixture(t); // maxOccupancy: 4
    const ok = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      adults: 3,
      children: 1, // 3 + 1 = 4 == 4
    });
    expect(ok.confirmationCode).toMatch(/^OS-/);
  });

  it('requires at least one adult', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await expect(
      t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(10), D(12)),
        adults: 0,
      }),
    ).rejects.toThrow(/INVALID_OCCUPANCY|adult/);
  });
});

describe('hold expiry', () => {
  it('expireHolds releases nights so the dates can be rebooked', async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
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
    const t = makeT();
    const fx = await seedFixture(t);
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const result = await t.mutation(internal.bookings.expireHolds, {});
    expect(result.expired).toBe(0);
  });
});

describe('simulated confirmation (demo path)', () => {
  it('is refused unless DEMO_MODE=true', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(12)));
    await expect(
      t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId }),
    ).rejects.toThrow(/DEMO_ONLY|demo-only/);
  });

  it('confirms a hold and records a simulated payment in DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
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

describe('public booking views', () => {
  it('keeps guest email out of confirmation pages and binds checkout access to booking id plus code', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const hold = await t.mutation(
      api.bookings.createHold,
      holdArgs(fx, D(10), D(12)),
    );

    const confirmation = await t.query(api.bookings.byConfirmationCode, {
      code: hold.confirmationCode,
    });
    expect(confirmation).not.toHaveProperty('guestEmail');

    const checkout = await t.query((api as any).bookings.forCheckout, {
      bookingId: hold.bookingId,
      code: hold.confirmationCode,
    });
    expect(checkout?.guestEmail).toBe('guest@example.com');

    expect(await t.query((api as any).bookings.forCheckout, {
      bookingId: hold.bookingId,
      code: 'OS-WRONG',
    })).toBeNull();
  });
});

describe('guest cancellation', () => {
  it('cancels with matching code+email, frees nights, computes policy refund', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
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
    const t = makeT();
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

describe('promo code lifecycle', () => {
  async function seedPromo(
    t: ReturnType<typeof convexTest>,
    fx: { propertyId: Id<'properties'> },
    overrides: Partial<{
      kind: 'percent' | 'fixed';
      valueBps: number;
      valueCents: number;
      maxRedemptions: number;
      oncePerGuest: boolean;
      minSubtotalCents: number;
      active: boolean;
      endsAt: number;
    }> = {},
  ) {
    return await t.run(async (ctx) =>
      ctx.db.insert('promoCodes', {
        propertyId: fx.propertyId,
        code: 'WELCOME10',
        normalizedCode: 'WELCOME10',
        kind: overrides.kind ?? 'percent',
        valueBps: overrides.valueBps ?? 1_000,
        valueCents: overrides.valueCents,
        oncePerGuest: overrides.oncePerGuest ?? false,
        maxRedemptions: overrides.maxRedemptions,
        minSubtotalCents: overrides.minSubtotalCents,
        endsAt: overrides.endsAt,
        appliesToUnitTypes: [],
        active: overrides.active ?? true,
        redemptionCount: 0,
        createdAt: Date.now(),
      }),
    );
  }

  it('applies a percent promo pre-tax and snapshots it on the booking', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await seedPromo(t, fx); // 10% off
    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      promoCode: 'welcome10 ', // case/whitespace-insensitive
    });
    // 2 nights × $100 = $200; 10% off = $20; GST on $180 = $9; total $189.
    expect(hold.price.promoDiscountCents).toBe(2_000);
    expect(hold.price.gstCents).toBe(900);
    expect(hold.price.totalCents).toBe(18_900);

    const view = await t.query(api.bookings.byConfirmationCode, { code: hold.confirmationCode });
    expect(view?.promoCode).toBe('WELCOME10');
  });

  it('rejects inactive, expired, and unknown codes', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { active: false });
    await expect(
      t.mutation(api.bookings.createHold, { ...holdArgs(fx, D(10), D(12)), promoCode: 'WELCOME10' }),
    ).rejects.toThrow(/PROMO_INVALID|not valid/);
    await expect(
      t.mutation(api.bookings.createHold, { ...holdArgs(fx, D(10), D(12)), promoCode: 'NOPE' }),
    ).rejects.toThrow(/PROMO_INVALID|not valid/);
  });

  it('enforces the total-usage cap transactionally and releases slots on expiry', async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
      const fx = await seedFixture(t);
      await seedPromo(t, fx, { maxRedemptions: 1 });

      await t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(10), D(12)),
        promoCode: 'WELCOME10',
      });
      // Cap hit while the first hold reserves the slot.
      await expect(
        t.mutation(api.bookings.createHold, {
          ...holdArgs(fx, D(20), D(22), 'other@example.com'),
          promoCode: 'WELCOME10',
        }),
      ).rejects.toThrow(/PROMO_EXHAUSTED|fully redeemed/);

      // Expire the hold → slot comes back.
      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      await t.mutation(internal.bookings.expireHolds, {});
      const retry = await t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(20), D(22), 'other@example.com'),
        promoCode: 'WELCOME10',
      });
      expect(retry.price.promoDiscountCents).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces once-per-guest across reserved and applied redemptions', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { oncePerGuest: true });

    const first = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(12)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.confirmSimulated, { bookingId: first.bookingId });

    await expect(
      t.mutation(api.bookings.createHold, {
        ...holdArgs(fx, D(20), D(22)), // same guest email
        promoCode: 'WELCOME10',
      }),
    ).rejects.toThrow(/PROMO_ALREADY_USED|already used/);

    // A different guest is fine.
    const other = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(20), D(22), 'other@example.com'),
      promoCode: 'WELCOME10',
    });
    expect(other.price.promoDiscountCents).toBeGreaterThan(0);
  });

  it('enforces minimum spend against the pre-promo subtotal', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await seedPromo(t, fx, { minSubtotalCents: 25_000 });
    await expect(
      t.mutation(api.bookings.createHold, { ...holdArgs(fx, D(10), D(12)), promoCode: 'WELCOME10' }),
    ).rejects.toThrow(/PROMO_MIN_SPEND|below the minimum/);
    const ok = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(10), D(13)), // 3 nights = $300 ≥ $250
      promoCode: 'WELCOME10',
    });
    expect(ok.price.promoDiscountCents).toBe(3_000);
  });

  it('an APPLIED redemption stays consumed when the confirmed booking cancels', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 1 });

    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });

    // The discount was consumed by a confirmed booking: cancellation must NOT
    // hand the usage slot back (adversarial review findings 2 & 3).
    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo?.redemptionCount).toBe(1);
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('promoRedemptions')
        .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
        .collect(),
    );
    expect(redemptions.every((r) => r.status === 'applied')).toBe(true);
  });

  it('a RESERVED redemption is released when an unpaid hold is cancelled', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    const promoId = await seedPromo(t, fx, { maxRedemptions: 1 });

    const hold = await t.mutation(api.bookings.createHold, {
      ...holdArgs(fx, D(30), D(32)),
      promoCode: 'WELCOME10',
    });
    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });

    const promo = await t.run(async (ctx) => ctx.db.get(promoId));
    expect(promo?.redemptionCount).toBe(0);
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('promoRedemptions')
        .withIndex('by_booking', (q) => q.eq('bookingId', hold.bookingId))
        .collect(),
    );
    expect(redemptions.every((r) => r.status === 'released')).toBe(true);
  });
});

describe('unitNights invariant', () => {
  it('active bookings own exactly their stay+prep rows; released on expiry', async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
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
    const t = makeT();
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

// ---------------------------------------------------------------------------
// Channel (Channex) dirty-marking wiring. Every mutation that changes occupancy
// on a CONNECTED + enabled property must route through markPropertyDirtyInline
// so the 1-min flush cron pushes the corrected count to OTAs. These are the
// regression guards for the CRITICAL oversell findings (occupancy changes were
// invisible to Channex until the ~24h nightly resync). CHANNEX_API_KEY is left
// unset, so the immediate pushAriForProperty action scheduled on decrements is
// a drained no-op (channelConfigured() is false) — we assert on dirtySince, the
// retry-safe correctness backbone, which is set regardless.
// ---------------------------------------------------------------------------
describe('channel dirty-marking on occupancy changes', () => {
  // Schema-typed handle so `.withIndex('by_property')` resolves the real
  // (non-system) index instead of falling back to SystemIndexes.
  type T = ReturnType<typeof makeT>;
  /** Connect + enable the fixture property for channel sync. */
  async function connectChannel(t: T, propertyId: Id<'properties'>) {
    await t.run(async (ctx) => {
      await ctx.db.patch(propertyId, { channexPropertyId: 'chx-prop-1' });
      await ctx.db.insert('channelSync', {
        propertyId,
        provider: 'channex',
        enabled: true,
      });
    });
  }
  async function dirtySinceOf(t: T, propertyId: Id<'properties'>) {
    return await t.run(async (ctx) => {
      const row = await ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
        .unique();
      return row?.dirtySince;
    });
  }

  it('createHold marks the property dirty AND schedules an immediate push (decrement)', async () => {
    const t = makeT();
    const fx = await seedFixture(t);
    await connectChannel(t, fx.propertyId);

    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));

    // dirtySince set (correctness backbone).
    expect(await dirtySinceOf(t, fx.propertyId)).toBeGreaterThan(0);
    // An immediate pushAriForProperty was scheduled (latency optimization).
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const pushes = scheduled.filter((j) => JSON.stringify(j.name ?? '').includes('pushAriForProperty'));
    expect(pushes.length).toBeGreaterThanOrEqual(1);
  });

  it('createHold on an UNconnected property is a no-op (no channelSync row created)', async () => {
    const t = makeT();
    const fx = await seedFixture(t); // no channelSync
    await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
    const sync = await t.run(async (ctx) =>
      ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique(),
    );
    expect(sync).toBeNull();
  });

  it('expireHolds marks the property dirty (increment / undersell)', async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
      const fx = await seedFixture(t);
      await connectChannel(t, fx.propertyId);
      await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
      // Clear the createHold dirty flag to isolate expiry's own mark.
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query('channelSync')
          .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
          .unique();
        await ctx.db.patch(row!._id, { dirtySince: undefined });
      });

      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      const result = await t.mutation(internal.bookings.expireHolds, {});
      expect(result.expired).toBe(1);
      expect(await dirtySinceOf(t, fx.propertyId)).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelByGuest marks the property dirty (increment / undersell)', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    const fx = await seedFixture(t);
    await connectChannel(t, fx.propertyId);
    const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(30), D(32)));
    await t.mutation(api.bookings.confirmSimulated, { bookingId: hold.bookingId });
    // Clear dirty from create/confirm to isolate cancellation's mark.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('channelSync')
        .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
        .unique();
      await ctx.db.patch(row!._id, { dirtySince: undefined });
    });

    await t.mutation(api.bookings.cancelByGuest, {
      confirmationCode: hold.confirmationCode,
      email: 'guest@example.com',
    });
    expect(await dirtySinceOf(t, fx.propertyId)).toBeGreaterThan(0);
  });

  it('confirmFromPayment expired→re-acquire marks dirty AND schedules an immediate push (re-decrement)', async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
      const fx = await seedFixture(t, { prepBufferNights: 1 });
      await connectChannel(t, fx.propertyId);
      const hold = await t.mutation(api.bookings.createHold, holdArgs(fx, D(10), D(13)));
      await t.mutation(internal.bookings.recordPendingPayment, {
        bookingId: hold.bookingId,
        provider: 'stripe',
        providerCheckoutId: 'cs_reacq',
        amountCents: hold.price.totalCents,
        currency: 'CAD',
      });

      // Expire the hold (frees nights), then clear dirty to isolate re-acquire.
      vi.setSystemTime(Date.now() + 36 * 60 * 1000);
      await t.mutation(internal.bookings.expireHolds, {});
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query('channelSync')
          .withIndex('by_property', (q) => q.eq('propertyId', fx.propertyId))
          .unique();
        await ctx.db.patch(row!._id, { dirtySince: undefined });
      });

      // Late payment re-acquires the free nights → occupancy DECREASES again.
      const res = await t.mutation(internal.bookings.confirmFromPayment, {
        provider: 'stripe',
        eventId: 'evt_reacq',
        eventType: 'payment_succeeded',
        checkoutId: 'cs_reacq',
        providerPaymentId: 'pi_reacq',
        amountCents: hold.price.totalCents,
        currency: 'CAD',
      });
      expect(res.outcome).toBe('confirmed');
      expect(await dirtySinceOf(t, fx.propertyId)).toBeGreaterThan(0);

      const scheduled = await t.run(async (ctx) =>
        ctx.db.system.query('_scheduled_functions').collect(),
      );
      const pushes = scheduled.filter((j) => JSON.stringify(j.name ?? '').includes('pushAriForProperty'));
      expect(pushes.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
