/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const messagesApi = (api as any).messages;
const created: Array<ReturnType<typeof convexTest>> = [];
function makeT() {
  const t = convexTest(schema, modules);
  created.push(t);
  return t;
}
afterEach(async () => {
  for (const t of created) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
  created.length = 0;
});

function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
      currency: 'CAD', taxRateBps: 1300, email: 'commons@example.com', phone: '555',
      address: 'Toronto', checkInTime: '15:00', checkOutTime: '11:00', active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Node Room', slug: 'node-room', kind: 'room', bookingMode: 'nightly',
      description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
      icalExportToken: 'test-token-xxxxxxxxxxxxxxxx', icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Ada Guest', email: 'Ada@Example.com', phone: '555',
      normalizedEmail: 'ada@example.com', normalizedPhone: '555', marketingOptIn: false, notes: [],
    });
    const booking = (code: string) => ({
      propertyId, unitId, unitTypeId, guestId, checkIn: '2026-07-23', checkOut: '2026-07-24',
      nights: 1, adults: 1, children: 0, status: 'confirmed' as const, source: 'demo',
      confirmationCode: code, statusHistory: [{ status: 'confirmed', ts: 1 }], notes: [], createdAt: 1, updatedAt: 1,
    });
    const bookingId = await ctx.db.insert('bookings', booking('OS-ADA123'));
    const otherBookingId = await ctx.db.insert('bookings', booking('OS-OTHER1'));
    const userId = await ctx.db.insert('users', { email: 'staff@example.com', name: 'Satoshi Staff' });
    await ctx.db.insert('staffProfiles', { userId, name: 'Satoshi Staff', role: 'staff', active: true, createdAt: 1 });
    return { bookingId, otherBookingId, userId };
  });
}

describe('booking messages', () => {
  it('normalizes guest credentials and keeps threads isolated and ordered', async () => {
    const t = makeT();
    const fx = await seed(t);
    await t.mutation(messagesApi.postGuest, { confirmationCode: ' os-ada123 ', email: ' ADA@example.com ', text: ' First ' });
    await t.mutation(messagesApi.postGuest, { confirmationCode: 'OS-ADA123', email: 'ada@example.com', text: 'Second' });
    const thread = await t.query(messagesApi.listGuest, { confirmationCode: 'OS-ADA123', email: 'ada@example.com' });
    expect(thread.map((message: any) => message.text)).toEqual(['First', 'Second']);
    const other = await t.query(messagesApi.listGuest, { confirmationCode: 'OS-OTHER1', email: 'ada@example.com' });
    expect(other).toEqual([]);
    expect(fx.otherBookingId).toBeTruthy();
  });

  it('rejects unauthorized, empty, and oversized guest messages', async () => {
    const t = makeT();
    await seed(t);
    await expect(t.mutation(messagesApi.postGuest, { confirmationCode: 'OS-ADA123', email: 'wrong@example.com', text: 'Hi' })).rejects.toThrow();
    await expect(t.mutation(messagesApi.postGuest, { confirmationCode: 'OS-ADA123', email: 'ada@example.com', text: '   ' })).rejects.toThrow();
    await expect(t.mutation(messagesApi.postGuest, { confirmationCode: 'OS-ADA123', email: 'ada@example.com', text: 'x'.repeat(2001) })).rejects.toThrow();
  });

  it('requires staff and records staff identity', async () => {
    const t = makeT();
    const fx = await seed(t);
    await expect(t.mutation(messagesApi.postStaff, { bookingId: fx.bookingId, text: 'Welcome' })).rejects.toThrow();
    const asStaff = t.withIdentity(identityFor(fx.userId));
    await asStaff.mutation(messagesApi.postStaff, { bookingId: fx.bookingId, text: ' Welcome ' });
    const thread = await asStaff.query(messagesApi.listStaff, { bookingId: fx.bookingId });
    expect(thread[0]).toMatchObject({ authorRole: 'staff', authorName: 'Satoshi Staff', text: 'Welcome' });
  });

  it('deduplicates opposite-party email alerts by message id', async () => {
    const t = makeT();
    const fx = await seed(t);
    const messageId = await t.withIdentity(identityFor(fx.userId)).mutation(messagesApi.postStaff, {
      bookingId: fx.bookingId,
      text: 'Your room is ready',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
    await t.action((internal as any).email.sendBookingMessageAlert, { messageId });
    const logs = await t.run(async (ctx) => ctx.db.query('emailLog').collect());
    expect(logs.filter((log) => log.templateKey.includes(String(messageId)))).toHaveLength(1);
  });
});
