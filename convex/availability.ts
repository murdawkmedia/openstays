import { v } from 'convex/values';
import { query } from './_generated/server';
import { addDays } from '../shared/pricing';
import { requirePropertyCapability } from './staff';

/**
 * Public availability for one unit type over a date window: which nights are
 * blocked on each unit. Powers the public date picker (disabled dates) and
 * search. Reads only the derived unitNights table — one indexed range scan
 * per unit.
 */
export const forUnitType = query({
  args: {
    unitTypeId: v.id('unitTypes'),
    startDate: v.string(), // 'YYYY-MM-DD'
    days: v.number(), // window length, 1..120
  },
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(120, Math.floor(args.days)));
    const endDate = addDays(args.startDate, days);
    const unitType = await ctx.db.get(args.unitTypeId);
    if (!unitType || unitType.bookingMode !== 'nightly') return { units: [] };

    const units = await ctx.db
      .query('units')
      .withIndex('by_type', (q) => q.eq('unitTypeId', args.unitTypeId))
      .collect();

    const result = [];
    for (const unit of units.filter((u) => u.status === 'active')) {
      const nights = await ctx.db
        .query('unitNights')
        .withIndex('by_unit_date', (q) =>
          q.eq('unitId', unit._id).gte('date', args.startDate).lt('date', endDate),
        )
        .collect();
      result.push({
        unitId: unit._id,
        unitName: unit.name,
        unitSlug: unit.slug,
        bookableFrom: unit.bookableFrom,
        blockedDates: nights.map((n) => n.date),
      });
    }
    return { units: result, startDate: args.startDate, endDate };
  },
});

/**
 * Admin booking tape data: all active bookings for a property intersecting a
 * date window, grouped by unit. One windowed index read.
 *
 * STAFF-ONLY. The payload includes every booking's guest-facing confirmation
 * code and full occupancy, so it must never be wire-callable by an anonymous
 * caller (the client-side 'skip' gate is cosmetic). DEMO_MODE is exempt: the
 * public writable demo has no real auth (synthetic staff via staff.me, nightly
 * reset), mirroring staff.me / updateProperty.
 */
export const tapeForProperty = query({
  args: {
    propertyId: v.id('properties'),
    startDate: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    if (process.env.DEMO_MODE !== 'true') {
      await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    }
    const days = Math.max(1, Math.min(120, Math.floor(args.days)));
    const endDate = addDays(args.startDate, days);

    const units = await ctx.db
      .query('units')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .collect();

    // Bookings that could intersect: checkIn < endDate and checkOut > startDate.
    // Window the index scan by checkIn and filter the tail in JS.
    const candidates = await ctx.db
      .query('bookings')
      .withIndex('by_property_checkIn', (q) =>
        q.eq('propertyId', args.propertyId).lt('checkIn', endDate),
      )
      .collect();
    const active = new Set(['hold', 'confirmed', 'checked_in', 'external', 'blocked']);
    const bookings = candidates.filter((b) => active.has(b.status) && b.checkOut > args.startDate);

    const unitRows = [];
    for (const unit of units) {
      const memberships = await ctx.db
        .query('unitGroupMembers')
        .withIndex('by_unit', (q) => q.eq('unitId', unit._id))
        .collect();
      unitRows.push({
        unitId: unit._id,
        unitTypeId: unit.unitTypeId,
        name: unit.name,
        status: unit.status,
        groupIds: memberships.map((membership) => membership.unitGroupId),
        attributes: unit.attributes ?? {},
        attributesVersion: unit.attributesVersion ?? 0,
      });
    }

    const bookingRows = [];
    for (const booking of bookings) {
      const [guest, payments] = await Promise.all([
        booking.guestId ? ctx.db.get(booking.guestId) : null,
        ctx.db
          .query('payments')
          .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
          .collect(),
      ]);
      const paymentStatus = payments.some((payment) => payment.status === 'paid')
        ? 'paid'
        : payments.some((payment) => payment.status === 'partially_refunded')
          ? 'partially_refunded'
          : payments.some((payment) => payment.status === 'refunded')
            ? 'refunded'
            : payments.some((payment) => payment.status === 'failed')
              ? 'failed'
              : 'pending';
      const attention: string[] = [];
      if (booking.syncConflict) attention.push('sync_conflict');
      if (
        booking.status === 'hold' &&
        booking.holdExpiresAt !== undefined &&
        booking.holdExpiresAt - Date.now() <= 15 * 60 * 1000
      ) {
        attention.push('hold_expiring');
      }
      if (booking.status === 'confirmed' && paymentStatus !== 'paid') {
        attention.push('payment_review');
      }
      bookingRows.push({
        bookingId: booking._id,
        unitId: booking.unitId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        status: booking.status,
        confirmationCode: booking.confirmationCode,
        source: booking.source,
        guestName: guest?.name ?? (booking.status === 'blocked' ? 'Inventory block' : 'External guest'),
        adults: booking.adults,
        children: booking.children,
        paymentStatus,
        attention,
        updatedAt: booking.updatedAt,
      });
    }

    const groups = await ctx.db
      .query('unitGroups')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .collect();
    const unitTypes = await ctx.db
      .query('unitTypes')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .collect();

    return {
      startDate: args.startDate,
      endDate,
      units: unitRows,
      bookings: bookingRows,
      unitGroups: groups.filter((group) => group.active).map((group) => ({
        unitGroupId: group._id,
        name: group.name,
      })),
      unitTypes: unitTypes.map((unitType) => ({ unitTypeId: unitType._id, name: unitType.name })),
    };
  },
});
