import { v } from 'convex/values';
import { internalQuery } from './_generated/server';

const EXPORTABLE = new Set(['confirmed', 'checked_in', 'blocked']);

/**
 * Build the iCal feed body for a unit identified by its secret export token.
 * Returns null for unknown tokens (route responds 404, indistinguishable
 * from a bad guess). External bookings are never re-exported — that would
 * bounce Airbnb's own events back at it and create loops.
 */
export const exportFeed = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const unit = await ctx.db
      .query('units')
      .withIndex('by_icalToken', (q) => q.eq('icalExportToken', args.token))
      .first();
    if (!unit) return null;

    const bookings = await ctx.db
      .query('bookings')
      .withIndex('by_unit_checkIn', (q) => q.eq('unitId', unit._id))
      .collect();

    const events = bookings
      .filter((b) => EXPORTABLE.has(b.status))
      .map((b) =>
        [
          'BEGIN:VEVENT',
          `UID:${b._id}@openstays`,
          `DTSTART;VALUE=DATE:${b.checkIn.replaceAll('-', '')}`,
          `DTEND;VALUE=DATE:${b.checkOut.replaceAll('-', '')}`, // exclusive — matches half-open semantics
          'SUMMARY:Reserved',
          `DTSTAMP:${toIcsTimestamp(b.updatedAt)}`,
          'END:VEVENT',
        ].join('\r\n'),
      );

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenStays//EN',
      'CALSCALE:GREGORIAN',
      ...events,
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  },
});

function toIcsTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
