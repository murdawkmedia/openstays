import { internalMutation } from './_generated/server';

export const PII_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
const BATCH_LIMIT = 100;

export const runNightly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - PII_RETENTION_MS;
    let deletedDisposableBookings = 0;
    let deletedMessages = 0;
    let purgedGuests = 0;
    let purgedEmails = 0;

    const disposableBookings = (await ctx.db.query('bookings').collect())
      .filter((booking) =>
        booking.source === 'demo'
        && booking.status === 'expired'
        && booking.createdAt <= cutoff)
      .slice(0, BATCH_LIMIT);
    for (const booking of disposableBookings) {
      const payments = await ctx.db.query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect();
      if (payments.length > 0) continue;
      for (const row of await ctx.db.query('bookingAddOns')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query('unitNights')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query('promoRedemptions')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect()) await ctx.db.delete(row._id);
      for (const row of await ctx.db.query('bookingMessages')
        .withIndex('by_booking_createdAt', (q) => q.eq('bookingId', booking._id))
        .collect()) {
        await ctx.db.delete(row._id);
        deletedMessages += 1;
      }
      for (const row of await ctx.db.query('emailLog')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect()) await ctx.db.delete(row._id);
      await ctx.db.delete(booking._id);
      deletedDisposableBookings += 1;
    }

    const messages = (await ctx.db.query('bookingMessages').collect())
      .filter((message) => message.createdAt <= cutoff)
      .slice(0, BATCH_LIMIT);
    for (const message of messages) {
      await ctx.db.delete(message._id);
      deletedMessages += 1;
    }

    const guests = (await ctx.db.query('guests').collect()).slice(0, BATCH_LIMIT);
    for (const guest of guests) {
      if (guest.normalizedEmail.startsWith('purged:')) continue;
      const bookings = await ctx.db.query('bookings')
        .withIndex('by_guest', (q) => q.eq('guestId', guest._id))
        .collect();
      if (
        bookings.length === 0
        || bookings.some((booking) => booking.createdAt > cutoff)
      ) continue;
      await ctx.db.patch(guest._id, {
        name: 'Purged guest',
        email: '',
        phone: '',
        normalizedEmail: `purged:${guest._id}`,
        normalizedPhone: `purged:${guest._id}`,
        marketingOptIn: false,
        notes: [],
      });
      purgedGuests += 1;
    }

    const emailLogs = (await ctx.db.query('emailLog')
      .withIndex('by_ts', (q) => q.lte('ts', cutoff))
      .take(BATCH_LIMIT))
      .filter((email) => email.retentionPurgedAt === undefined);
    for (const email of emailLogs) {
      await ctx.db.patch(email._id, {
        to: '',
        from: undefined,
        subject: '',
        html: undefined,
        text: undefined,
        providerMessageId: undefined,
        error: undefined,
        leaseToken: undefined,
        retentionPurgedAt: now,
      });
      purgedEmails += 1;
    }

    return {
      deletedDisposableBookings,
      deletedMessages,
      purgedGuests,
      purgedEmails,
    };
  },
});
