import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requirePropertyCapability, requirePropertyFeature } from './staff';

const MAX_DOCUMENTS_PER_TYPE = 1_000;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchable(...values: Array<string | undefined>): string {
  return normalize(values.filter(Boolean).join(' '));
}

export const rebuild = mutation({
  args: {
    propertyId: v.id('properties'),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.configure');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');

    const replay = await ctx.db
      .query('operationRequests')
      .withIndex('by_property_request', (q) =>
        q.eq('propertyId', args.propertyId).eq('requestId', args.requestId),
      )
      .unique();
    if (replay) {
      if (replay.action !== 'operational_search.rebuild') {
        throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
      }
      return { ...(JSON.parse(replay.resultJson) as { indexed: number }), replayed: true };
    }

    const existing = await ctx.db
      .query('operationalSearchDocuments')
      .withIndex('by_property_updatedAt', (q) => q.eq('propertyId', args.propertyId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const [bookings, quotes, waitlist, tasks, maintenance, folios, groups, contracts, units] =
      await Promise.all([
        ctx.db.query('bookings').withIndex('by_property_checkIn', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('quotes').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('waitlistEntries').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('staffTasks').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('maintenanceTasks').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('folios').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('groupReservations').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('seasonalContracts').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
        ctx.db.query('units').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).take(MAX_DOCUMENTS_PER_TYPE),
      ]);
    const unitById = new Map(units.map((unit) => [unit._id, unit]));
    const guestIds = new Set<Id<'guests'>>();
    for (const row of bookings) if (row.guestId) guestIds.add(row.guestId);
    for (const row of [...quotes, ...waitlist, ...contracts]) guestIds.add(row.guestId);
    for (const row of folios) if (row.guestId) guestIds.add(row.guestId);
    for (const row of groups) guestIds.add(row.contactGuestId);
    const guests = new Map(
      (await Promise.all([...guestIds].map(async (id) => [id, await ctx.db.get(id)] as const)))
        .filter((entry): entry is readonly [Id<'guests'>, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
        .filter(([, guest]) => guest.propertyId === args.propertyId),
    );

    const documents: Array<{
      recordType: string;
      recordId: string;
      title: string;
      subtitle: string;
      normalizedText: string;
      status: string;
      source?: string;
      dateStart?: string;
      dateEnd?: string;
      updatedAt: number;
    }> = [];
    for (const booking of bookings) {
      const guest = booking.guestId ? guests.get(booking.guestId) : undefined;
      const unit = unitById.get(booking.unitId);
      const title = guest?.name ?? unit?.name ?? booking.confirmationCode;
      const subtitle = `${booking.confirmationCode} · ${unit?.name ?? 'Unassigned unit'} · ${booking.checkIn}–${booking.checkOut}`;
      documents.push({
        recordType: 'booking', recordId: booking._id, title, subtitle,
        normalizedText: searchable(title, subtitle, guest?.email, guest?.phone, booking.confirmationCode, unit?.slug),
        status: booking.status, source: booking.source, dateStart: booking.checkIn, dateEnd: booking.checkOut, updatedAt: booking.updatedAt,
      });
    }
    for (const quote of quotes) {
      const guest = guests.get(quote.guestId);
      const title = guest?.name ?? 'Guest quote';
      const subtitle = `${quote.currency} ${(quote.amountCents / 100).toFixed(2)} · ${quote.checkIn}–${quote.checkOut}`;
      documents.push({ recordType: 'quote', recordId: quote._id, title, subtitle, normalizedText: searchable(title, subtitle, guest?.email, guest?.phone), status: quote.status, dateStart: quote.checkIn, dateEnd: quote.checkOut, updatedAt: quote.updatedAt });
    }
    for (const entry of waitlist) {
      const guest = guests.get(entry.guestId);
      const title = guest?.name ?? 'Waitlist guest';
      const subtitle = `${entry.desiredCheckIn}–${entry.desiredCheckOut} · ${entry.flexibility}`;
      documents.push({ recordType: 'waitlist', recordId: entry._id, title, subtitle, normalizedText: searchable(title, subtitle, guest?.email, guest?.phone), status: entry.status, dateStart: entry.desiredCheckIn, dateEnd: entry.desiredCheckOut, updatedAt: entry.updatedAt });
    }
    for (const task of tasks) {
      documents.push({ recordType: 'task', recordId: task._id, title: task.title, subtitle: task.detail, normalizedText: searchable(task.title, task.detail, task.kind), status: task.status, updatedAt: task.updatedAt });
    }
    for (const task of maintenance) {
      const unit = unitById.get(task.unitId);
      const subtitle = `${unit?.name ?? 'Unit'} · ${task.priority} priority`;
      documents.push({ recordType: 'maintenance', recordId: task._id, title: task.title, subtitle, normalizedText: searchable(task.title, task.description, subtitle), status: task.status, updatedAt: task.updatedAt });
    }
    for (const folio of folios) {
      const guest = folio.guestId ? guests.get(folio.guestId) : undefined;
      const title = guest?.name ?? `${folio.kind === 'retail' ? 'Retail' : 'Booking'} folio`;
      const subtitle = `${folio.currency} · ${folio.kind}`;
      documents.push({ recordType: 'folio', recordId: folio._id, title, subtitle, normalizedText: searchable(title, subtitle, guest?.email, guest?.phone), status: folio.status, updatedAt: folio.updatedAt });
    }
    for (const group of groups) {
      const guest = guests.get(group.contactGuestId);
      documents.push({ recordType: 'group', recordId: group._id, title: group.name, subtitle: `${guest?.name ?? 'Group contact'} · ${group.arrivalDate}–${group.departureDate}`, normalizedText: searchable(group.name, guest?.name, guest?.email), status: group.status, dateStart: group.arrivalDate, dateEnd: group.departureDate, updatedAt: group.updatedAt });
    }
    for (const contract of contracts) {
      const guest = guests.get(contract.guestId);
      const unit = unitById.get(contract.unitId);
      const title = `${contract.seasonLabel} · ${guest?.name ?? 'Seasonal guest'}`;
      const subtitle = `${unit?.name ?? 'Unit'} · ${contract.startDate}–${contract.endDate}`;
      documents.push({ recordType: 'contract', recordId: contract._id, title, subtitle, normalizedText: searchable(title, subtitle, guest?.email, guest?.phone), status: contract.status, dateStart: contract.startDate, dateEnd: contract.endDate, updatedAt: contract.statusHistory.at(-1)?.ts ?? 0 });
    }

    const now = Date.now();
    for (const document of documents) {
      await ctx.db.insert('operationalSearchDocuments', { propertyId: args.propertyId, ...document });
    }
    const result = { indexed: documents.length };
    await ctx.db.insert('operationRequests', { propertyId: args.propertyId, requestId: args.requestId, action: 'operational_search.rebuild', actorUserId: access.userId, resultJson: JSON.stringify(result), createdAt: now });
    await ctx.db.insert('auditLog', { actorUserId: access.userId, actorName: access.profile.name, propertyId: args.propertyId, action: 'operational_search.rebuild', detail: `rebuilt ${documents.length} staff search records`, entityType: 'operational_search', entityId: args.propertyId, requestId: args.requestId, ts: now });
    return { ...result, replayed: false };
  },
});

export const search = query({
  args: {
    propertyId: v.id('properties'),
    text: v.string(),
    recordType: v.optional(v.string()),
    status: v.optional(v.string()),
    source: v.optional(v.string()),
    dateStart: v.optional(v.string()),
    dateEnd: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const terms = normalize(args.text).split(' ').filter(Boolean);
    if (terms.length === 0) return [];
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
    const rows = await ctx.db
      .query('operationalSearchDocuments')
      .withIndex('by_property_updatedAt', (q) => q.eq('propertyId', args.propertyId))
      .order('desc')
      .take(500);
    return rows
      .filter((row) => terms.every((term) => row.normalizedText.includes(term)))
      .filter((row) => !args.recordType || row.recordType === args.recordType)
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.source || row.source === args.source)
      .filter((row) => !args.dateStart || !row.dateEnd || row.dateEnd >= args.dateStart)
      .filter((row) => !args.dateEnd || !row.dateStart || row.dateStart <= args.dateEnd)
      .slice(0, limit)
      .map(({ _id, _creationTime, normalizedText, propertyId, ...row }) => row);
  },
});
