import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requirePropertyCapability, requirePropertyFeature } from './staff';

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

export const createRetailFolio = mutation({
  args: { propertyId: v.id('properties'), description: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'folio.post');
    await requirePropertyFeature(ctx, args.propertyId, 'commerce');
    const previous = await replay<{ folioId: Id<'folios'> }>(ctx, args.propertyId, args.requestId, 'folio.retail.create');
    if (previous) return { ...previous, replayed: true };
    const folioId = await ctx.db.insert('folios', { propertyId: args.propertyId, kind: 'retail', status: 'open', currency: access.property.currency, version: 0, createdBy: access.userId, createdAt: Date.now(), updatedAt: Date.now() });
    const result = { folioId };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'folio.retail.create', userId: access.userId, name: access.profile.name, entityType: 'folio', entityId: folioId, detail: `created retail folio ${args.description.trim() || 'Retail sale'}`, result });
    return { ...result, replayed: false };
  },
});

export const postEntry = mutation({
  args: {
    propertyId: v.id('properties'), folioId: v.id('folios'),
    kind: v.union(v.literal('charge'), v.literal('adjustment'), v.literal('payment'), v.literal('refund')),
    description: v.string(), amountCents: v.number(), taxCents: v.number(), paymentId: v.optional(v.id('payments')),
    expectedVersion: v.number(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'folio.post');
    await requirePropertyFeature(ctx, args.propertyId, 'commerce');
    const previous = await replay<{ entryId: Id<'folioEntries'>; version: number }>(ctx, args.propertyId, args.requestId, 'folio.entry.post');
    if (previous) return { ...previous, replayed: true };
    const folio = await ctx.db.get(args.folioId);
    if (!folio || folio.propertyId !== args.propertyId || folio.status !== 'open') throw new ConvexError('FOLIO_NOT_OPEN');
    if (folio.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${folio.version}`);
    if (!Number.isInteger(args.amountCents) || !Number.isInteger(args.taxCents) || args.amountCents === 0 || !args.description.trim()) throw new ConvexError('INVALID_FOLIO_ENTRY');
    if (args.paymentId) {
      const payment = await ctx.db.get(args.paymentId);
      if (!payment || payment.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    const entryId = await ctx.db.insert('folioEntries', { propertyId: args.propertyId, folioId: args.folioId, kind: args.kind, description: args.description.trim(), amountCents: args.amountCents, taxCents: args.taxCents, paymentId: args.paymentId, postedBy: access.userId, postedAt: Date.now() });
    const version = folio.version + 1;
    await ctx.db.patch(folio._id, { version, updatedAt: Date.now() });
    const result = { entryId, version };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'folio.entry.post', userId: access.userId, name: access.profile.name, entityType: 'folio_entry', entityId: entryId, detail: `posted ${args.kind} to folio ${folio._id}`, result });
    return { ...result, replayed: false };
  },
});

export const reverseEntry = mutation({
  args: { propertyId: v.id('properties'), folioId: v.id('folios'), entryId: v.id('folioEntries'), reason: v.string(), expectedVersion: v.number(), requestId: v.string() },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'folio.post');
    await requirePropertyFeature(ctx, args.propertyId, 'commerce');
    const previous = await replay<{ reversalEntryId: Id<'folioEntries'>; version: number }>(ctx, args.propertyId, args.requestId, 'folio.entry.reverse');
    if (previous) return { ...previous, replayed: true };
    const [folio, entry] = await Promise.all([ctx.db.get(args.folioId), ctx.db.get(args.entryId)]);
    if (!folio || !entry || folio.propertyId !== args.propertyId || entry.propertyId !== args.propertyId || entry.folioId !== folio._id || folio.status !== 'open') throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (folio.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${folio.version}`);
    if (entry.kind === 'reversal' || !args.reason.trim()) throw new ConvexError('ENTRY_NOT_REVERSIBLE');
    const prior = await ctx.db.query('folioEntries').withIndex('by_reversal', (q) => q.eq('reversesEntryId', entry._id)).first();
    if (prior) throw new ConvexError('ENTRY_ALREADY_REVERSED');
    const reversalEntryId = await ctx.db.insert('folioEntries', { propertyId: args.propertyId, folioId: folio._id, kind: 'reversal', description: `Reversal: ${args.reason.trim()}`, amountCents: -entry.amountCents, taxCents: -entry.taxCents, reversesEntryId: entry._id, postedBy: access.userId, postedAt: Date.now() });
    const version = folio.version + 1;
    await ctx.db.patch(folio._id, { version, updatedAt: Date.now() });
    const result = { reversalEntryId, version };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'folio.entry.reverse', userId: access.userId, name: access.profile.name, entityType: 'folio_entry', entityId: reversalEntryId, detail: `reversed entry ${entry._id}`, result });
    return { ...result, replayed: false };
  },
});

export const recordManualPayment = mutation({
  args: {
    propertyId: v.id('properties'), folioId: v.id('folios'),
    method: v.union(v.literal('cash'), v.literal('etransfer'), v.literal('cheque'), v.literal('external_terminal'), v.literal('gift_certificate')),
    amountCents: v.number(), expectedVersion: v.number(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'folio.post');
    await requirePropertyFeature(ctx, args.propertyId, 'commerce');
    const previous = await replay<{ paymentId: Id<'payments'>; entryId: Id<'folioEntries'>; version: number }>(ctx, args.propertyId, args.requestId, 'folio.payment.record');
    if (previous) return { ...previous, replayed: true };
    const folio = await ctx.db.get(args.folioId);
    if (!folio || folio.propertyId !== args.propertyId || folio.status !== 'open') throw new ConvexError('FOLIO_NOT_OPEN');
    if (folio.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${folio.version}`);
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw new ConvexError('INVALID_PAYMENT_AMOUNT');
    const now = Date.now();
    const paymentId = await ctx.db.insert('payments', {
      propertyId: args.propertyId, bookingId: folio.bookingId, provider: args.method === 'gift_certificate' ? 'gift_certificate' : 'manual',
      manualMethod: args.method, amountCents: args.amountCents, gstCents: 0, currency: folio.currency,
      status: 'paid', refunds: [], recordedBy: access.profile.name, createdAt: now, paidAt: now,
    });
    const entryId = await ctx.db.insert('folioEntries', {
      propertyId: args.propertyId, folioId: folio._id, kind: 'payment', description: `${args.method.replace('_', ' ')} payment`,
      amountCents: -args.amountCents, taxCents: 0, paymentId, postedBy: access.userId, postedAt: now,
    });
    const version = folio.version + 1;
    await ctx.db.patch(folio._id, { version, updatedAt: now });
    const result = { paymentId, entryId, version };
    await finish(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'folio.payment.record', userId: access.userId, name: access.profile.name, entityType: 'payment', entityId: paymentId, detail: `recorded ${args.method} payment on folio ${folio._id}`, result });
    return { ...result, replayed: false };
  },
});

export const folioDetail = query({
  args: { propertyId: v.id('properties'), folioId: v.id('folios') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'folio.read');
    const folio = await ctx.db.get(args.folioId);
    if (!folio || folio.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const entries = await ctx.db.query('folioEntries').withIndex('by_folio_postedAt', (q) => q.eq('folioId', folio._id)).collect();
    return { folio, entries, balanceCents: entries.reduce((sum, entry) => sum + entry.amountCents + entry.taxCents, 0) };
  },
});

export const listFolios = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'folio.read');
    return await ctx.db.query('folios').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect();
  },
});
