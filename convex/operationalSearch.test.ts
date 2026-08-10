/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });

describe('operational search projection', () => {
  it('rebuilds bounded staff-only documents without crossing properties', async () => {
    const t = convexTest(schema, modules);
    const { userId, propertyId, bookingId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'owner@example.com', name: 'Owner' });
      await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: 1 });
      const propertyId = await ctx.db.insert('properties', { name: 'One', slug: 'one', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500, email: 'x@y.ca', phone: '555', address: '1', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      await ctx.db.insert('propertyFeatures', { propertyId, feature: 'command_center', enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
      const typeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId: typeId, name: 'Cabin A', slug: 'a', status: 'active', icalExportToken: 'search', icalImports: [], sortOrder: 1 });
      const guestId = await ctx.db.insert('guests', { propertyId, name: 'Ada Camper', email: 'ada@example.com', phone: '555-0100', normalizedEmail: 'ada@example.com', normalizedPhone: '5550100', marketingOptIn: false, notes: [] });
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitId, unitTypeId: typeId, guestId, checkIn: '2030-01-01', checkOut: '2030-01-03', nights: 2, adults: 2, children: 0, status: 'confirmed', source: 'phone', confirmationCode: 'OS-SEARCH', statusHistory: [], notes: [], createdAt: 1, updatedAt: 1 });
      return { userId, propertyId, bookingId };
    });
    const asOwner = t.withIdentity(identityFor(userId));
    const rebuilt = await asOwner.mutation((api as any).operationalSearch.rebuild, { propertyId, requestId: 'req-search-rebuild' });
    expect(rebuilt.indexed).toBeGreaterThan(0);
    const results = await asOwner.query((api as any).operationalSearch.search, { propertyId, text: 'ada camper', limit: 20 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ recordType: 'booking', recordId: bookingId, title: 'Ada Camper' });
    await expect(t.query((api as any).operationalSearch.search, { propertyId, text: 'ada', limit: 20 })).rejects.toThrow(/UNAUTHENTICATED/);
  });
});
