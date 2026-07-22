import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';

type TimelineInput = {
  statusHistory: string[];
  paymentCount: number;
  paid: boolean;
  emailDelivered: boolean;
  messageCount: number;
  openRefundCount: number;
  channelMapped: boolean;
  channelDirty: boolean;
};

export type ConsensusStep = {
  key: string;
  label: string;
  state: 'reached' | 'pending' | 'attention' | 'ready';
  detail: string;
};

export function buildConsensusTimeline(input: TimelineInput): ConsensusStep[] {
  const held = input.statusHistory.some((status) => status === 'hold' || status === 'confirmed');
  const confirmed = input.statusHistory.includes('confirmed');
  return [
    { key: 'availability', label: 'Availability agreed', state: held ? 'reached' : 'pending', detail: held ? 'The requested nights were atomically reserved.' : 'Waiting for an availability hold.' },
    { key: 'requested', label: 'Payment requested', state: input.paymentCount > 0 ? 'reached' : 'pending', detail: input.paymentCount > 0 ? 'A payment request is recorded against this booking.' : 'No payment request yet.' },
    { key: 'observed', label: 'Payment observed', state: input.openRefundCount > 0 ? 'attention' : input.paid ? 'reached' : 'pending', detail: input.openRefundCount > 0 ? `${input.openRefundCount} manual refund case${input.openRefundCount === 1 ? '' : 's'} requires resolution.` : input.paid ? 'The authoritative payment rail reported settlement.' : 'Waiting for authoritative settlement.' },
    { key: 'confirmed', label: 'Booking confirmed', state: confirmed ? 'reached' : 'pending', detail: confirmed ? 'Payment and availability agree on one booking state.' : 'Confirmation waits for payment and availability consensus.' },
    { key: 'notified', label: 'Notification sent', state: input.emailDelivered ? 'reached' : 'pending', detail: `${input.emailDelivered ? 'Reservation email recorded' : 'Reservation email queued'} · ${input.messageCount} message${input.messageCount === 1 ? '' : 's'} in the booking thread.` },
    { key: 'channel', label: 'Channel synchronization ready', state: input.channelMapped && !input.channelDirty ? 'reached' : 'ready', detail: !input.channelMapped ? 'Channex adapter ready, not connected.' : input.channelDirty ? 'Availability changed; adapter has a pending synchronization.' : 'Connected channel state is clean.' },
  ];
}

export const forGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.query('bookings')
      .withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', args.confirmationCode.trim().toUpperCase()))
      .first();
    const guest = booking?.guestId ? await ctx.db.get(booking.guestId) : null;
    if (!booking || !guest || guest.normalizedEmail !== args.email.trim().toLowerCase()) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    const [payments, emails, refunds, messages, property, channel] = await Promise.all([
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('emailLog').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('refundCases').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('bookingMessages').withIndex('by_booking_createdAt', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.get(booking.propertyId),
      ctx.db.query('channelSync').withIndex('by_property', (q) => q.eq('propertyId', booking.propertyId)).first(),
    ]);
    return buildConsensusTimeline({
      statusHistory: booking.statusHistory.map((entry) => entry.status),
      paymentCount: payments.length,
      paid: payments.some((payment) => ['paid', 'partially_refunded', 'refunded'].includes(payment.status)),
      emailDelivered: emails.some((email) => ['sent', 'logged'].includes(email.status)),
      messageCount: messages.length,
      openRefundCount: refunds.filter((refund) => refund.status === 'open').length,
      channelMapped: Boolean(property?.channexPropertyId),
      channelDirty: Boolean(channel?.dirtySince),
    });
  },
});
