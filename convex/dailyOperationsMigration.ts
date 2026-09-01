import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';

const cleaningType = v.union(
  v.literal('turnover'),
  v.literal('stayover'),
  v.literal('inspection'),
  v.literal('deep_clean'),
  v.literal('custom'),
);

export const preview = internalQuery({
  args: { propertySlug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .unique();
    if (!property) throw new ConvexError('PROPERTY_NOT_FOUND');

    const rows = await ctx.db
      .query('housekeepingAssignments')
      .withIndex('by_property_date', (q) => q.eq('propertyId', property._id))
      .collect();
    const open = rows.filter((row) => row.status !== 'verified' && row.status !== 'cancelled');
    return {
      eligible: open.filter(
        (row) => row.cleaningType === undefined || row.expectedMinutes === undefined,
      ).length,
      unchanged: open.filter(
        (row) => row.cleaningType !== undefined && row.expectedMinutes !== undefined,
      ).length,
    };
  },
});

export const apply = internalMutation({
  args: {
    propertySlug: v.string(),
    cleaningType,
    expectedMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.expectedMinutes) ||
      args.expectedMinutes < 5 ||
      args.expectedMinutes > 480
    ) {
      throw new ConvexError('INVALID_EXPECTED_MINUTES');
    }
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .unique();
    if (!property) throw new ConvexError('PROPERTY_NOT_FOUND');

    const rows = await ctx.db
      .query('housekeepingAssignments')
      .withIndex('by_property_date', (q) => q.eq('propertyId', property._id))
      .collect();
    let updated = 0;
    let unchanged = 0;
    const now = Date.now();
    for (const row of rows) {
      if (row.status === 'verified' || row.status === 'cancelled') continue;
      if (row.cleaningType !== undefined && row.expectedMinutes !== undefined) {
        unchanged += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        cleaningType: row.cleaningType ?? args.cleaningType,
        expectedMinutes: row.expectedMinutes ?? args.expectedMinutes,
        version: row.version + 1,
        updatedAt: now,
      });
      updated += 1;
    }
    return { updated, unchanged };
  },
});
