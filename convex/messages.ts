import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireStaff } from './staff';

const MAX_MESSAGE_LENGTH = 2_000;

function normalizeText(value: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) throw new ConvexError({ code: 'EMPTY_MESSAGE', message: 'Enter a message.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ConvexError({ code: 'MESSAGE_TOO_LONG', message: 'Messages are limited to 2,000 characters.' });
  }
  return text;
}

async function requireGuestBooking(
  ctx: QueryCtx | MutationCtx,
  confirmationCode: string,
  email: string,
): Promise<Doc<'bookings'>> {
  const booking = await ctx.db
    .query('bookings')
    .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', confirmationCode.trim().toUpperCase()))
    .first();
  const guest = booking?.guestId ? await ctx.db.get(booking.guestId) : null;
  if (!booking || !guest || guest.normalizedEmail !== email.trim().toLowerCase()) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
  }
  return booking;
}

async function thread(ctx: QueryCtx, bookingId: Doc<'bookings'>['_id']) {
  return await ctx.db
    .query('bookingMessages')
    .withIndex('by_booking_createdAt', (q) => q.eq('bookingId', bookingId))
    .order('asc')
    .collect();
}

export const listGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => thread(ctx, (await requireGuestBooking(ctx, args.confirmationCode, args.email))._id),
});

export const postGuest = mutation({
  args: { confirmationCode: v.string(), email: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const booking = await requireGuestBooking(ctx, args.confirmationCode, args.email);
    const guest = await ctx.db.get(booking.guestId!);
    const messageId = await ctx.db.insert('bookingMessages', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      authorRole: 'guest',
      authorName: guest?.name ?? 'Guest',
      text: normalizeText(args.text),
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, (internal as any).email.sendBookingMessageAlert, { messageId });
    return messageId;
  },
});

export const listStaff = query({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    if (!(await ctx.db.get(args.bookingId))) throw new ConvexError('BOOKING_NOT_FOUND');
    return thread(ctx, args.bookingId);
  },
});

export const postStaff = mutation({
  args: { bookingId: v.id('bookings'), text: v.string() },
  handler: async (ctx, args) => {
    const { profile } = await requireStaff(ctx);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new ConvexError('BOOKING_NOT_FOUND');
    const messageId = await ctx.db.insert('bookingMessages', {
      propertyId: booking.propertyId,
      bookingId: booking._id,
      authorRole: 'staff',
      authorName: profile.name,
      text: normalizeText(args.text),
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, (internal as any).email.sendBookingMessageAlert, { messageId });
    return messageId;
  },
});

export const staffThreads = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const messages = await ctx.db.query('bookingMessages').order('desc').take(200);
    const latest = new Map<string, Doc<'bookingMessages'>>();
    for (const message of messages) if (!latest.has(message.bookingId)) latest.set(message.bookingId, message);
    return await Promise.all(Array.from(latest.values()).map(async (message) => {
      const booking = await ctx.db.get(message.bookingId);
      const guest = booking?.guestId ? await ctx.db.get(booking.guestId) : null;
      return {
        bookingId: message.bookingId,
        confirmationCode: booking?.confirmationCode ?? 'Unknown',
        guestName: guest?.name ?? 'Guest',
        lastMessage: message.text,
        lastMessageAt: message.createdAt,
      };
    }));
  },
});
