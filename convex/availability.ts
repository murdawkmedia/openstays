import { v } from 'convex/values';
import { query } from './_generated/server';
import { addDays } from '../shared/pricing';

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
 */
export const tapeForProperty = query({
  args: {
    propertyId: v.id('properties'),
    startDate: v.string(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
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

    return {
      startDate: args.startDate,
      endDate,
      units: units.map((u) => ({ unitId: u._id, name: u.name, status: u.status })),
      bookings: bookings.map((b) => ({
        bookingId: b._id,
        unitId: b.unitId,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        confirmationCode: b.confirmationCode,
        source: b.source,
      })),
    };
  },
});
