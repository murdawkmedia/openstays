import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { markPropertyDirtyInline } from './channel/ari';
import { requireMutationPropertyCapability, requirePropertyCapability, requirePropertyFeature } from './staff';

async function replay<T>(ctx: MutationCtx, propertyId: Id<'properties'>, requestId: string, action: string): Promise<T | null> {
  const row = await ctx.db.query('operationRequests').withIndex('by_property_request', (q) => q.eq('propertyId', propertyId).eq('requestId', requestId)).unique();
  if (!row) return null;
  if (row.action !== action) throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
  return JSON.parse(row.resultJson) as T;
}

export const queues = query({
  args: { propertyId: v.id('properties'), businessDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk');
    const candidates = await ctx.db.query('bookings').withIndex('by_property_checkIn', (q) => q.eq('propertyId', args.propertyId)).collect();
    const relevant = candidates.filter((booking) =>
      booking.checkIn === args.businessDate ||
      booking.checkOut === args.businessDate ||
      (booking.checkIn < args.businessDate && booking.checkOut > args.businessDate) ||
      ((booking.status === 'no_show' || booking.status === 'checked_out') && booking.statusHistory.at(-1)?.ts),
    );
    const rows = [];
    for (const booking of relevant) {
      const [guest, unit, payments, service] = await Promise.all([
        booking.guestId ? ctx.db.get(booking.guestId) : null,
        ctx.db.get(booking.unitId),
        ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
        ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', booking.unitId)).unique(),
      ]);
      const paidCents = payments
        .filter((payment) => ['paid', 'partially_refunded'].includes(payment.status))
        .reduce((sum, payment) => sum + payment.amountCents - payment.refunds.reduce((refundSum, refund) => refundSum + refund.amountCents, 0), 0);
      rows.push({
        bookingId: booking._id,
        confirmationCode: booking.confirmationCode,
        guestName: guest?.name ?? 'External guest',
        unitName: unit?.name ?? 'Unknown unit',
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        status: booking.status,
        partySize: booking.adults + booking.children,
        readiness: service?.state ?? 'ready',
        balanceCents: Math.max(0, (booking.priceBreakdown?.totalCents ?? 0) - paidCents),
        version: booking.version ?? 0,
      });
    }
    return {
      arriving: rows.filter((row) => row.checkIn === args.businessDate && ['hold', 'confirmed'].includes(row.status)),
      departing: rows.filter((row) => row.checkOut === args.businessDate && ['confirmed', 'checked_in'].includes(row.status)),
      stayingOver: rows.filter((row) => row.checkIn < args.businessDate && row.checkOut > args.businessDate && ['confirmed', 'checked_in'].includes(row.status)),
      checkedIn: rows.filter((row) => row.status === 'checked_in'),
      noShow: rows.filter((row) => row.status === 'no_show' && row.checkIn === args.businessDate),
      checkedOut: rows.filter((row) => row.status === 'checked_out' && row.checkOut === args.businessDate),
    };
  },
});

export const transition = mutation({
  args: {
    propertyId: v.id('properties'), bookingId: v.id('bookings'),
    transition: v.union(v.literal('check_in'), v.literal('check_out'), v.literal('no_show')),
    expectedVersion: v.number(), requestId: v.string(), overrideNotReady: v.optional(v.boolean()),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const action = `front_desk.${args.transition}`;
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'booking.check_in_out', action, args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk');
    const previous = await replay<{ bookingId: Id<'bookings'>; status: string; version: number }>(ctx, args.propertyId, args.requestId, action);
    if (previous) return { ...previous, replayed: true };
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const version = booking.version ?? 0;
    if (version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${version}`);
    const expectedStatus = args.transition === 'check_in' ? 'confirmed' : args.transition === 'check_out' ? 'checked_in' : 'confirmed';
    if (booking.status !== expectedStatus) throw new ConvexError(`INVALID_BOOKING_TRANSITION:${booking.status}`);
    if (args.transition === 'check_in') {
      const service = await ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', booking.unitId)).unique();
      if (service && service.state !== 'ready' && !args.overrideNotReady) throw new ConvexError(`UNIT_NOT_READY:${service.state}`);
      if (service && service.state !== 'ready' && args.overrideNotReady && !['owner', 'manager'].includes(access.role)) throw new ConvexError('MANAGER_OVERRIDE_REQUIRED');
    }
    const status = args.transition === 'check_in' ? 'checked_in' : args.transition === 'check_out' ? 'checked_out' : 'no_show';
    const now = Date.now();
    const nextVersion = version + 1;
    await ctx.db.patch(booking._id, {
      status,
      statusHistory: [...booking.statusHistory, { status, ts: now }],
      updatedAt: now,
      version: nextVersion,
    });
    if (args.transition !== 'check_in') {
      const nights = await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect();
      for (const night of nights) await ctx.db.delete(night._id);
      await markPropertyDirtyInline(ctx, args.propertyId);
    }
    if (args.transition === 'check_out') {
      const service = await ctx.db.query('unitServiceStates').withIndex('by_unit', (q) => q.eq('unitId', booking.unitId)).unique();
      if (service) await ctx.db.patch(service._id, { state: 'dirty', version: service.version + 1, updatedBy: access.userId, updatedAt: now });
      else await ctx.db.insert('unitServiceStates', { propertyId: args.propertyId, unitId: booking.unitId, state: 'dirty', version: 0, updatedBy: access.userId, updatedAt: now });
    }
    const result = { bookingId: booking._id, status, version: nextVersion };
    await ctx.db.insert('operationRequests', { propertyId: args.propertyId, requestId: args.requestId, action, actorUserId: access.userId, resultJson: JSON.stringify(result), createdAt: now });
    await ctx.db.insert('auditLog', { actorUserId: access.userId, actorName: access.profile.name, propertyId: args.propertyId, action, detail: `${args.transition.replace('_', ' ')} ${booking.confirmationCode}`, entityType: 'booking', entityId: booking._id, requestId: args.requestId, metadataJson: JSON.stringify({ from: booking.status, to: status }), ts: now });
    return { ...result, replayed: false };
  },
});
