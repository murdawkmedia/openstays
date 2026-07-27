import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';

type TimelineInput = {
  statusHistory: string[];
  paymentCount: number;
  paid: boolean;
  paymentPending?: boolean;
  paymentFailed?: boolean;
  paymentRefunded?: boolean;
  emailDelivered: boolean;
  messageCount: number;
  openRefundCount: number;
  channelMapped: boolean;
  channelDirty: boolean;
  receiptStatus?: string;
  rewardStatus?: string;
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
  const paymentDetail = input.openRefundCount > 0
    ? `${input.openRefundCount} manual refund case${input.openRefundCount === 1 ? '' : 's'} requires resolution.`
    : input.paymentRefunded
      ? 'The authoritative payment rail reports the payment as refunded.'
      : input.paid
        ? 'The authoritative payment rail reported settlement.'
        : input.paymentFailed
          ? 'The payment request failed without authoritative settlement.'
          : input.paymentPending
            ? 'The payment request is pending authoritative settlement.'
            : 'Waiting for authoritative settlement.';
  return [
    { key: 'availability', label: 'Availability agreed', state: held ? 'reached' : 'pending', detail: held ? 'The requested nights were atomically reserved.' : 'Waiting for an availability hold.' },
    { key: 'requested', label: 'Payment requested', state: input.paymentCount > 0 ? 'reached' : 'pending', detail: input.paymentCount > 0 ? 'A payment request is recorded against this booking.' : 'No payment request yet.' },
    { key: 'observed', label: 'Payment observed', state: input.openRefundCount > 0 || input.paymentFailed ? 'attention' : input.paid || input.paymentRefunded ? 'reached' : 'pending', detail: paymentDetail },
    { key: 'confirmed', label: 'Booking confirmed', state: confirmed ? 'reached' : 'pending', detail: confirmed ? 'Payment and availability agree on one booking state.' : 'Confirmation waits for payment and availability consensus.' },
    { key: 'notified', label: 'Notification sent', state: input.emailDelivered ? 'reached' : 'pending', detail: `${input.emailDelivered ? 'Reservation email recorded' : 'Reservation email queued'} · ${input.messageCount} message${input.messageCount === 1 ? '' : 's'} in the booking thread.` },
    { key: 'timestamped', label: 'Consensus receipt timestamped', state: input.receiptStatus === 'submitted' || input.receiptStatus === 'bitcoin_anchored' ? 'reached' : input.receiptStatus === 'failed' ? 'attention' : 'pending', detail: input.receiptStatus === 'bitcoin_anchored' ? 'OpenTimestamps proof is independently anchored to Bitcoin.' : input.receiptStatus === 'submitted' ? 'OpenTimestamps calendars accepted the privacy-safe receipt commitment.' : input.receiptStatus === 'failed' ? 'Timestamp submission needs staff attention.' : 'Waiting for the canonical receipt and calendar proof.' },
    { key: 'rewarded', label: 'Guest consensus reward', state: input.rewardStatus === 'paid' ? 'reached' : input.rewardStatus === 'failed' ? 'attention' : 'pending', detail: input.rewardStatus === 'paid' ? 'The guest wallet received exactly 1,000 signet sats.' : input.rewardStatus === 'paying' || input.rewardStatus === 'invoice_ready' ? 'The merchant bridge is reconciling the 1,000-sat payout.' : 'A one-time 1,000 signet sats reward unlocks after timestamp submission.' },
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
    const [payments, emails, refunds, messages, property, channel, receipt, reward] = await Promise.all([
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('emailLog').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('refundCases').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('bookingMessages').withIndex('by_booking_createdAt', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.get(booking.propertyId),
      ctx.db.query('channelSync').withIndex('by_property', (q) => q.eq('propertyId', booking.propertyId)).first(),
      ctx.db.query('consensusReceipts').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique(),
      ctx.db.query('wavelengthRewards').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).unique(),
    ]);
    return buildConsensusTimeline({
      statusHistory: booking.statusHistory.map((entry) => entry.status),
      paymentCount: payments.length,
      paid: payments.some((payment) => ['paid', 'partially_refunded', 'refunded'].includes(payment.status)),
      paymentPending: payments.some((payment) => payment.status === 'pending'),
      paymentFailed: payments.some((payment) => payment.status === 'failed'),
      paymentRefunded: payments.some((payment) =>
        payment.status === 'partially_refunded' || payment.status === 'refunded'),
      emailDelivered: emails.some((email) => ['sent', 'logged'].includes(email.status)),
      messageCount: messages.length,
      openRefundCount: refunds.filter((refund) => refund.status === 'open').length,
      channelMapped: Boolean(property?.channexPropertyId),
      channelDirty: Boolean(channel?.dirtySince),
      receiptStatus: receipt?.status,
      rewardStatus: reward?.status,
    });
  },
});
