/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'owner@example.com', name: 'Owner' });
    await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: 1 });
    const propertyId = await ctx.db.insert('properties', { name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500, email: 'x@y.ca', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true });
    for (const feature of ['groups', 'long_term', 'commerce']) await ctx.db.insert('propertyFeatures', { propertyId, feature, enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
    const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Seasonal Site', slug: 'seasonal', kind: 'site', bookingMode: 'seasonal', description: '', photoUrls: [], maxOccupancy: 6, amenities: [], comingSoon: false, sortOrder: 1 });
    const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'S-01', slug: 's-01', status: 'active', icalExportToken: 'group', icalImports: [], sortOrder: 1 });
    const guestId = await ctx.db.insert('guests', { propertyId, name: 'Group Lead', email: 'lead@example.com', phone: '555', normalizedEmail: 'lead@example.com', normalizedPhone: '555', marketingOptIn: false, notes: [] });
    return { userId, propertyId, unitId, guestId };
  });
}

describe('groups and long-term operations', () => {
  it('creates non-occupying group and seasonal records with reminders', async () => {
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    const group = await asOwner.mutation((api as any).groups.createGroup, { propertyId: f.propertyId, name: 'Family Reunion', contactGuestId: f.guestId, arrivalDate: '2030-07-01', departureDate: '2030-07-05', requestId: 'req-group' });
    const contract = await asOwner.mutation((api as any).groups.createSeasonalContract, { propertyId: f.propertyId, unitId: f.unitId, guestId: f.guestId, seasonLabel: '2030', startDate: '2030-05-01', endDate: '2030-10-01', totalCents: 300000, gstCents: 15000, schedule: [{ dueDate: '2030-04-01', amountCents: 315000 }], requestId: 'req-contract' });
    await asOwner.mutation((api as any).groups.createReminder, { propertyId: f.propertyId, title: 'Group deposit due', detail: 'Call the group lead', dueAt: Date.now() + 1000, requestId: 'req-reminder' });
    expect(group.replayed).toBe(false); expect(contract.replayed).toBe(false);
    expect(await t.run(async (ctx) => ctx.db.query('unitNights').collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query('staffTasks').collect())).toHaveLength(1);
  });

  it('issues a gift certificate as a post-tax payment instrument', async () => {
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    const issued = await asOwner.mutation((api as any).groups.issueGiftCertificate, { propertyId: f.propertyId, amountCents: 10000, recipientName: 'Camper', requestId: 'req-gift' });
    const certificate = await t.run(async (ctx) => ctx.db.get(issued.giftCertificateId));
    expect(certificate).toMatchObject({ initialCents: 10000, balanceCents: 10000, status: 'active', source: 'issued' });
    expect((certificate as any).ledger).toHaveLength(1);
  });
});
