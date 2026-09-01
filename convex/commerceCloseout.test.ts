/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });

afterEach(() => {
  vi.useRealTimers();
});

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'owner@example.com', name: 'Owner' });
    await ctx.db.insert('staffProfiles', { userId, name: 'Owner', role: 'owner', active: true, createdAt: 1 });
    const propertyId = await ctx.db.insert('properties', { name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500, email: 'x@y.ca', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true });
    for (const feature of ['commerce', 'night_audit']) await ctx.db.insert('propertyFeatures', { propertyId, feature, enabled: true, version: 1, updatedBy: userId, updatedAt: 1 });
    const folioId = await ctx.db.insert('folios', { propertyId, kind: 'retail', status: 'open', currency: 'CAD', version: 0, createdBy: userId, createdAt: 1, updatedAt: 1 });
    return { userId, propertyId, folioId };
  });
}

describe('commerce closeout', () => {
  it('records manual settlement once and keeps the payment row authoritative', async () => {
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    await asOwner.mutation((api as any).commerce.postEntry, { propertyId: f.propertyId, folioId: f.folioId, kind: 'charge', description: 'Firewood', amountCents: 1000, taxCents: 50, expectedVersion: 0, requestId: 'req-charge' });
    const args = { propertyId: f.propertyId, folioId: f.folioId, method: 'cash', amountCents: 1050, expectedVersion: 1, requestId: 'req-cash-payment' };
    const first = await asOwner.mutation((api as any).commerce.recordManualPayment, args);
    const replay = await asOwner.mutation((api as any).commerce.recordManualPayment, args);
    expect(replay).toMatchObject({ paymentId: first.paymentId, replayed: true });
    expect(await t.run(async (ctx) => ctx.db.query('payments').collect())).toHaveLength(1);
    const detail = await asOwner.query((api as any).commerce.folioDetail, { propertyId: f.propertyId, folioId: f.folioId });
    expect(detail.balanceCents).toBe(0);
  });

  it('closes a date into one immutable, replay-safe night-audit snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:42:00.000Z'));
    const t = convexTest(schema, modules); const f = await seed(t); const asOwner = t.withIdentity(identityFor(f.userId));
    const businessDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    await asOwner.mutation((api as any).commerce.postEntry, { propertyId: f.propertyId, folioId: f.folioId, kind: 'charge', description: 'Store sale', amountCents: 2000, taxCents: 100, expectedVersion: 0, requestId: 'req-sale' });
    const preview = await asOwner.query((api as any).closeout.preview, { propertyId: f.propertyId, businessDate });
    expect(preview).toMatchObject({ postedRevenueCents: 2100, openFolios: 1 });
    const first = await asOwner.mutation((api as any).closeout.closeNight, { propertyId: f.propertyId, businessDate, requestId: 'req-night-close' });
    const replay = await asOwner.mutation((api as any).closeout.closeNight, { propertyId: f.propertyId, businessDate, requestId: 'req-night-close' });
    expect(replay).toMatchObject({ snapshotId: first.snapshotId, replayed: true });
    expect(await t.run(async (ctx) => ctx.db.query('nightAuditSnapshots').collect())).toHaveLength(1);
  });
});
