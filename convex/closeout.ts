import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireMutationPropertyCapability, requirePropertyCapability, requirePropertyFeature } from './staff';

function localDate(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

async function buildSummary(ctx: QueryCtx | MutationCtx, propertyId: Id<'properties'>, businessDate: string) {
  const property = await ctx.db.get(propertyId);
  if (!property) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
  const [entries, folios, bookings, refunds] = await Promise.all([
    ctx.db.query('folioEntries').withIndex('by_property_postedAt', (q) => q.eq('propertyId', propertyId)).collect(),
    ctx.db.query('folios').withIndex('by_property_status', (q) => q.eq('propertyId', propertyId)).collect(),
    ctx.db.query('bookings').withIndex('by_property_checkIn', (q) => q.eq('propertyId', propertyId)).collect(),
    ctx.db.query('refundCases').withIndex('by_status_createdAt', (q) => q.eq('status', 'open')).collect(),
  ]);
  const dayEntries = entries.filter((entry) => localDate(entry.postedAt, property.timezone) === businessDate);
  const postedRevenueCents = dayEntries.filter((entry) => entry.kind !== 'payment').reduce((sum, entry) => sum + entry.amountCents + entry.taxCents, 0);
  const paymentsCents = -dayEntries.filter((entry) => entry.kind === 'payment').reduce((sum, entry) => sum + entry.amountCents, 0);
  const occupied = bookings.filter((booking) => ['confirmed', 'checked_in', 'external'].includes(booking.status) && booking.checkIn <= businessDate && booking.checkOut > businessDate).length;
  return {
    businessDate,
    postedRevenueCents,
    paymentsCents,
    openFolios: folios.filter((folio) => folio.status === 'open').length,
    occupiedUnits: occupied,
    openRefundCases: refunds.filter((refund) => refund.propertyId === propertyId).length,
    channelConflicts: bookings.filter((booking) => booking.syncConflict).length,
  };
}

export const preview = query({
  args: { propertyId: v.id('properties'), businessDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'reports.read');
    await requirePropertyFeature(ctx, args.propertyId, 'night_audit');
    return await buildSummary(ctx, args.propertyId, args.businessDate);
  },
});

export const closeNight = mutation({
  args: { propertyId: v.id('properties'), businessDate: v.string(), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'night_audit.close', 'night_audit.close', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'night_audit');
    const priorRequest = await ctx.db.query('operationRequests').withIndex('by_property_request', (q) => q.eq('propertyId', args.propertyId).eq('requestId', args.requestId)).unique();
    if (priorRequest) {
      if (priorRequest.action !== 'night_audit.close') throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
      return { ...(JSON.parse(priorRequest.resultJson) as { snapshotId: Id<'nightAuditSnapshots'> }), replayed: true };
    }
    const existing = await ctx.db.query('nightAuditSnapshots').withIndex('by_property_date', (q) => q.eq('propertyId', args.propertyId).eq('businessDate', args.businessDate)).unique();
    if (existing?.status === 'closed') throw new ConvexError('NIGHT_ALREADY_CLOSED');
    const summary = await buildSummary(ctx, args.propertyId, args.businessDate);
    const now = Date.now();
    const snapshotId = existing?._id ?? await ctx.db.insert('nightAuditSnapshots', { propertyId: args.propertyId, businessDate: args.businessDate, status: 'closed', summaryJson: JSON.stringify(summary), closedBy: access.userId, createdAt: now, updatedAt: now, closedAt: now });
    if (existing) await ctx.db.patch(existing._id, { status: 'closed', summaryJson: JSON.stringify(summary), closedBy: access.userId, updatedAt: now, closedAt: now });
    const result = { snapshotId };
    await ctx.db.insert('operationRequests', { propertyId: args.propertyId, requestId: args.requestId, action: 'night_audit.close', actorUserId: access.userId, resultJson: JSON.stringify(result), createdAt: now });
    await ctx.db.insert('auditLog', { actorUserId: access.userId, actorName: access.profile.name, propertyId: args.propertyId, action: 'night_audit.close', detail: `closed business date ${args.businessDate}`, entityType: 'night_audit', entityId: snapshotId, requestId: args.requestId, metadataJson: JSON.stringify(summary), ts: now });
    return { ...result, replayed: false };
  },
});

export const report = query({
  args: { propertyId: v.id('properties'), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'reports.read');
    const snapshots = await ctx.db.query('nightAuditSnapshots').withIndex('by_property_date', (q) => q.eq('propertyId', args.propertyId).gte('businessDate', args.startDate).lte('businessDate', args.endDate)).collect();
    return snapshots.map((snapshot) => ({ snapshotId: snapshot._id, businessDate: snapshot.businessDate, status: snapshot.status, summary: JSON.parse(snapshot.summaryJson) }));
  },
});
