import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const created: Array<ReturnType<typeof convexTest>> = [];

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 50; i += 1) {
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect())
        .filter((job) => job.state.kind === 'pending' || job.state.kind === 'inProgress').length);
    if (pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

afterEach(async () => {
  for (const t of created) await drainScheduled(t);
  created.length = 0;
  vi.unstubAllEnvs();
});

describe('demo reset safety', () => {
  it('refuses destructive reset whenever public live mode is configured', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('PUBLIC_LIVE_PAYMENTS', 'true');
    const t = convexTest(schema, modules);
    created.push(t);
    await expect(t.mutation(internal.demo.reset, {}))
      .rejects.toThrow('LIVE_RESET_PROHIBITED');
  });

  it('keeps the public simulated tour authenticated and reward-free', async () => {
    vi.stubEnv('PUBLIC_LIVE_PAYMENTS', 'true');
    vi.stubEnv('PUBLIC_SIMULATED_PAYMENTS', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'log_only');
    const t = convexTest(schema, modules);
    created.push(t);
    const now = Date.now();
    const bookingId = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', {
        name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
        currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true,
      });
      const unitTypeId = await ctx.db.insert('unitTypes', {
        propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
      });
      const unitId = await ctx.db.insert('units', {
        propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'test', icalImports: [], sortOrder: 1,
      });
      const guestId = await ctx.db.insert('guests', {
        propertyId, name: 'Guest', email: 'guest@example.test',
        normalizedEmail: 'guest@example.test', phone: '', normalizedPhone: '',
        marketingOptIn: false, notes: [],
      });
      return await ctx.db.insert('bookings', {
        propertyId, unitTypeId, unitId, guestId,
        checkIn: '2026-08-16', checkOut: '2026-08-17', nights: 1,
        adults: 1, children: 0, status: 'hold', source: 'direct',
        confirmationCode: 'OS-PUBLIC-TOUR', holdExpiresAt: now + 600_000,
        priceBreakdown: {
          nightlySubtotalCents: 100, addOnSubtotalCents: 0, promoDiscountCents: 0,
          taxableSubtotalCents: 100, gstCents: 0, totalCents: 100,
          giftCertAppliedCents: 0, depositDueCents: 100, balanceDueCents: 0,
        },
        statusHistory: [{ status: 'hold', ts: now }],
        notes: [], createdAt: now, updatedAt: now,
      });
    });
    await expect(t.mutation(api.bookings.confirmSimulated, {
      bookingId,
      confirmationCode: 'OS-PUBLIC-TOUR',
      email: 'wrong@example.test',
    })).rejects.toThrow('Booking not found');
    await expect(t.mutation(api.bookings.confirmSimulated, {
      bookingId,
      confirmationCode: 'os-public-tour',
      email: ' GUEST@example.test ',
    })).resolves.toEqual({ confirmationCode: 'OS-PUBLIC-TOUR' });
    await drainScheduled(t);
    const result = await t.run(async (ctx) => ({
      payments: await ctx.db.query('payments').collect(),
      rewards: await ctx.db.query('wavelengthRewards').collect(),
    }));
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toMatchObject({ provider: 'simulated', status: 'paid' });
    expect(result.rewards).toHaveLength(0);
  });
});
