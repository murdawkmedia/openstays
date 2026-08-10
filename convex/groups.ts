import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireMutationPropertyCapability, requirePropertyCapability, requirePropertyFeature } from './staff';

async function replay<T>(ctx: MutationCtx, propertyId: Id<'properties'>, requestId: string, action: string): Promise<T | null> {
  const row = await ctx.db.query('operationRequests').withIndex('by_property_request', (q) => q.eq('propertyId', propertyId).eq('requestId', requestId)).unique();
  if (!row) return null;
  if (row.action !== action) throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
  return JSON.parse(row.resultJson) as T;
}

async function finish(ctx: MutationCtx, args: { propertyId: Id<'properties'>; requestId: string; action: string; userId: Id<'users'>; name: string; entityType: string; entityId: string; detail: string; result: unknown }) {
  const now = Date.now();
  await ctx.db.insert('operationRequests', { propertyId: args.propertyId, requestId: args.requestId, action: args.action, actorUserId: args.userId, resultJson: JSON.stringify(args.result), createdAt: now });
  await ctx.db.insert('auditLog', { actorUserId: args.userId, actorName: args.name, propertyId: args.propertyId, action: args.action, detail: args.detail, entityType: args.entityType, entityId: args.entityId, requestId: args.requestId, ts: now });
}

export const createGroup = mutation({
  args: { propertyId: v.id('properties'), name: v.string(), contactGuestId: v.id('guests'), arrivalDate: v.string(), departureDate: v.string(), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'booking.write', 'group.create', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'groups');
    const prior = await replay<{ groupReservationId: Id<'groupReservations'> }>(ctx, args.propertyId, args.requestId, 'group.create');
    if (prior) return { ...prior, replayed: true };
    const guest = await ctx.db.get(args.contactGuestId);
    if (!guest || guest.propertyId !== args.propertyId || args.departureDate <= args.arrivalDate || !args.name.trim()) throw new ConvexError('INVALID_GROUP');
    const now = Date.now();
    const groupReservationId = await ctx.db.insert('groupReservations', { propertyId: args.propertyId, name: args.name.trim(), contactGuestId: guest._id, arrivalDate: args.arrivalDate, departureDate: args.departureDate, status: 'prospect', bookingIds: [], version: 0, createdBy: access.userId, createdAt: now, updatedAt: now });
    const result = { groupReservationId };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'group.create', userId: access.userId, name: access.profile.name, entityType: 'group_reservation', entityId: groupReservationId, detail: `created group ${args.name.trim()}`, result });
    return { ...result, replayed: false };
  },
});

export const createSeasonalContract = mutation({
  args: {
    propertyId: v.id('properties'), unitId: v.id('units'), guestId: v.id('guests'), seasonLabel: v.string(), startDate: v.string(), endDate: v.string(), totalCents: v.number(), gstCents: v.number(),
    schedule: v.array(v.object({ dueDate: v.string(), amountCents: v.number() })), requestId: v.string(),
    automationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'booking.write', 'seasonal_contract.create', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'long_term');
    const prior = await replay<{ seasonalContractId: Id<'seasonalContracts'> }>(ctx, args.propertyId, args.requestId, 'seasonal_contract.create');
    if (prior) return { ...prior, replayed: true };
    const [unit, guest] = await Promise.all([ctx.db.get(args.unitId), ctx.db.get(args.guestId)]);
    if (!unit || !guest || unit.propertyId !== args.propertyId || guest.propertyId !== args.propertyId || args.endDate <= args.startDate || args.totalCents < 0 || args.gstCents < 0 || !args.seasonLabel.trim()) throw new ConvexError('INVALID_SEASONAL_CONTRACT');
    if (args.schedule.reduce((sum, item) => sum + item.amountCents, 0) !== args.totalCents + args.gstCents) throw new ConvexError('SCHEDULE_NOT_BALANCED');
    const seasonalContractId = await ctx.db.insert('seasonalContracts', {
      propertyId: args.propertyId, unitId: unit._id, guestId: guest._id, seasonLabel: args.seasonLabel.trim(), startDate: args.startDate, endDate: args.endDate,
      totalCents: args.totalCents, gstCents: args.gstCents, schedule: args.schedule.map((item) => ({ ...item, status: 'due' as const })),
      status: 'draft', renewal: { status: 'none' }, statusHistory: [{ status: 'draft', ts: Date.now() }], notes: [],
    });
    const result = { seasonalContractId };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'seasonal_contract.create', userId: access.userId, name: access.profile.name, entityType: 'seasonal_contract', entityId: seasonalContractId, detail: `created ${args.seasonLabel} contract for ${unit.name}`, result });
    return { ...result, replayed: false };
  },
});

export const createReminder = mutation({
  args: { propertyId: v.id('properties'), title: v.string(), detail: v.string(), dueAt: v.number(), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'booking.write', 'reminder.create', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'groups');
    const prior = await replay<{ taskId: Id<'staffTasks'> }>(ctx, args.propertyId, args.requestId, 'reminder.create');
    if (prior) return { ...prior, replayed: true };
    if (!args.title.trim()) throw new ConvexError('TITLE_REQUIRED');
    const now = Date.now();
    const taskId = await ctx.db.insert('staffTasks', { propertyId: args.propertyId, kind: 'reminder', title: args.title.trim(), detail: args.detail.trim(), status: 'open', dueAt: args.dueAt, version: 0, createdBy: access.userId, createdAt: now, updatedAt: now });
    const result = { taskId };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'reminder.create', userId: access.userId, name: access.profile.name, entityType: 'staff_task', entityId: taskId, detail: `created reminder ${args.title.trim()}`, result });
    return { ...result, replayed: false };
  },
});

export const issueGiftCertificate = mutation({
  args: { propertyId: v.id('properties'), amountCents: v.number(), recipientName: v.optional(v.string()), requestId: v.string(), automationToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireMutationPropertyCapability(ctx, args.propertyId, 'folio.post', 'gift_certificate.issue', args.automationToken);
    await requirePropertyFeature(ctx, args.propertyId, 'commerce');
    const prior = await replay<{ giftCertificateId: Id<'giftCertificates'>; code: string }>(ctx, args.propertyId, args.requestId, 'gift_certificate.issue');
    if (prior) return { ...prior, replayed: true };
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw new ConvexError('INVALID_GIFT_CERTIFICATE_AMOUNT');
    const code = `OSGC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const giftCertificateId = await ctx.db.insert('giftCertificates', { propertyId: args.propertyId, code, normalizedCode: code, initialCents: args.amountCents, balanceCents: args.amountCents, status: 'active', recipientName: args.recipientName?.trim() || undefined, source: 'issued', ledger: [{ ts: Date.now(), deltaCents: args.amountCents, by: access.profile.name }] });
    const result = { giftCertificateId, code };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'gift_certificate.issue', userId: access.userId, name: access.profile.name, entityType: 'gift_certificate', entityId: giftCertificateId, detail: `issued gift certificate for ${args.amountCents} cents`, result });
    return { ...result, replayed: false };
  },
});

export const dashboard = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    const [groups, contracts, reminders] = await Promise.all([
      ctx.db.query('groupReservations').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('seasonalContracts').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('staffTasks').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId).eq('status', 'open')).collect(),
    ]);
    return { groups, contracts, reminders: reminders.filter((task) => task.kind === 'reminder') };
  },
});

export const candidates = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    const [guests, units] = await Promise.all([
      ctx.db.query('guests').collect(),
      ctx.db.query('units').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).collect(),
    ]);
    return {
      guests: guests.filter((guest) => guest.propertyId === args.propertyId).map((guest) => ({ guestId: guest._id, name: guest.name, email: guest.email })),
      units: units.map((unit) => ({ unitId: unit._id, name: unit.name })),
    };
  },
});
