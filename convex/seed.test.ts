/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('Consensus Commons seed migration', () => {
  it('refreshes an existing fictional rate to 19 cents plus 13% HST', async () => {
    const t = convexTest(schema, modules);
    const { propertyId, ratePlanId } = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', {
        name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
        currency: 'CAD', taxRateBps: 500, email: 'hosts@example.test', phone: '555-0210',
        address: 'Toronto', checkInTime: '15:00', checkOutTime: '11:00', active: true,
      });
      const unitTypeId = await ctx.db.insert('unitTypes', {
        propertyId, name: 'Node Room', slug: 'node-room', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
      });
      const ratePlanId = await ctx.db.insert('ratePlans', {
        propertyId, unitTypeId, name: 'Hackathon rate', active: true, currency: 'CAD',
        baseNightlyCents: 21_000, seasons: [], minStayNights: 1, maxStayNights: 7,
        minLeadTimeHours: 0, maxAdvanceDays: 365, prepBufferNights: 0,
        depositPolicy: { type: 'full', value: 0 }, cancellationPolicy: [],
      });
      return { propertyId, ratePlanId };
    });

    await t.mutation((internal as any).seed.run, {});
    const state = await t.run(async (ctx) => ({
      property: await ctx.db.get(propertyId), ratePlan: await ctx.db.get(ratePlanId),
    }));
    expect(state.property).toMatchObject({ taxRateBps: 1300, taxLabel: 'HST' });
    expect(state.ratePlan).toMatchObject({ baseNightlyCents: 19, minStayNights: 1, maxStayNights: 1 });
  });
});
