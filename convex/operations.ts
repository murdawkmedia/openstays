import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { markPropertyDirtyInline } from './channel/ari';
import { HOLD_TTL_MS } from './bookings';
import { requirePropertyCapability, requirePropertyFeature } from './staff';
import {
  addDays,
  computePrice,
  enumerateNights,
  generateConfirmationCode,
} from '../shared/pricing';

async function replayResult<T>(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  requestId: string,
  action: string,
): Promise<T | null> {
  if (!requestId.trim()) throw new ConvexError('REQUEST_ID_REQUIRED');
  const row = await ctx.db
    .query('operationRequests')
    .withIndex('by_property_request', (q) =>
      q.eq('propertyId', propertyId).eq('requestId', requestId),
    )
    .unique();
  if (!row) return null;
  if (row.action !== action) throw new ConvexError('IDEMPOTENCY_KEY_REUSED');
  return JSON.parse(row.resultJson) as T;
}

async function finishOperation(
  ctx: MutationCtx,
  args: {
    propertyId: Id<'properties'>;
    requestId: string;
    action: string;
    actorUserId: Id<'users'>;
    actorName: string;
    entityType: string;
    entityId: string;
    detail: string;
    result: unknown;
    metadata?: unknown;
  },
) {
  const now = Date.now();
  await ctx.db.insert('operationRequests', {
    propertyId: args.propertyId,
    requestId: args.requestId,
    action: args.action,
    actorUserId: args.actorUserId,
    resultJson: JSON.stringify(args.result),
    createdAt: now,
  });
  await ctx.db.insert('auditLog', {
    actorUserId: args.actorUserId,
    actorName: args.actorName,
    propertyId: args.propertyId,
    action: args.action,
    detail: args.detail,
    entityType: args.entityType,
    entityId: args.entityId,
    requestId: args.requestId,
    metadataJson: args.metadata === undefined ? undefined : JSON.stringify(args.metadata),
    ts: now,
  });
}

function assertDates(checkIn: string, checkOut: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) {
    throw new ConvexError('INVALID_STAY_DATES');
  }
  const nights = enumerateNights(checkIn, checkOut);
  if (nights.length < 1 || nights.length > 366) throw new ConvexError('INVALID_STAY_DATES');
  return nights;
}

async function findConflict(
  ctx: MutationCtx,
  unitId: Id<'units'>,
  checkIn: string,
  blockedUntil: string,
  excludingBookingId?: Id<'bookings'>,
) {
  const rows = await ctx.db
    .query('unitNights')
    .withIndex('by_unit_date', (q) =>
      q.eq('unitId', unitId).gte('date', checkIn).lt('date', blockedUntil),
    )
    .collect();
  return rows.find((row) => row.bookingId !== excludingBookingId);
}

async function insertOccupancy(
  ctx: MutationCtx,
  args: {
    bookingId: Id<'bookings'>;
    unitId: Id<'units'>;
    checkIn: string;
    checkOut: string;
    prepBufferNights: number;
    block?: boolean;
  },
) {
  const blockedUntil = addDays(args.checkOut, args.prepBufferNights);
  for (const date of enumerateNights(args.checkIn, blockedUntil)) {
    await ctx.db.insert('unitNights', {
      unitId: args.unitId,
      bookingId: args.bookingId,
      date,
      kind: args.block ? 'block' : date < args.checkOut ? 'stay' : 'prep',
    });
  }
}

export const createBlock = mutation({
  args: {
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    checkIn: v.string(),
    checkOut: v.string(),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'booking.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ bookingId: Id<'bookings'> }>(ctx, args.propertyId, args.requestId, 'booking.block');
    if (replay) return { ...replay, replayed: true };
    const nights = assertDates(args.checkIn, args.checkOut);
    if (!args.reason.trim()) throw new ConvexError('REASON_REQUIRED');
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (await findConflict(ctx, args.unitId, args.checkIn, args.checkOut)) throw new ConvexError('DATES_UNAVAILABLE');
    const now = Date.now();
    const bookingId = await ctx.db.insert('bookings', {
      propertyId: args.propertyId,
      unitId: args.unitId,
      unitTypeId: unit.unitTypeId,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      nights: nights.length,
      adults: 0,
      children: 0,
      status: 'blocked',
      source: 'staff:block',
      confirmationCode: `BLK-${generateConfirmationCode((max) => Math.floor(Math.random() * max)).slice(3)}`,
      statusHistory: [{ status: 'blocked', ts: now }],
      notes: [{ ts: now, text: args.reason.trim(), by: access.profile.name }],
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
    await insertOccupancy(ctx, { bookingId, unitId: args.unitId, checkIn: args.checkIn, checkOut: args.checkOut, prepBufferNights: 0, block: true });
    await markPropertyDirtyInline(ctx, args.propertyId);
    const result = { bookingId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'booking.block',
      actorUserId: access.userId, actorName: access.profile.name, entityType: 'booking', entityId: bookingId,
      detail: `blocked ${unit.name} ${args.checkIn} to ${args.checkOut}`, result,
      metadata: { reason: args.reason.trim() },
    });
    return { ...result, replayed: false };
  },
});

export const moveBooking = mutation({
  args: {
    propertyId: v.id('properties'), bookingId: v.id('bookings'), targetUnitId: v.id('units'),
    checkIn: v.string(), checkOut: v.string(), expectedVersion: v.number(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'booking.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ bookingId: Id<'bookings'>; version: number }>(ctx, args.propertyId, args.requestId, 'booking.move');
    if (replay) return { ...replay, replayed: true };
    const nights = assertDates(args.checkIn, args.checkOut);
    const [booking, targetUnit] = await Promise.all([ctx.db.get(args.bookingId), ctx.db.get(args.targetUnitId)]);
    if (!booking || booking.propertyId !== args.propertyId || !targetUnit || targetUnit.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (!['hold', 'confirmed', 'checked_in', 'blocked'].includes(booking.status)) throw new ConvexError('BOOKING_NOT_MOVABLE');
    if (targetUnit.unitTypeId !== booking.unitTypeId) throw new ConvexError('UNIT_TYPE_MISMATCH');
    const version = booking.version ?? 0;
    if (version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${version}`);
    const ratePlan = booking.ratePlanId ? await ctx.db.get(booking.ratePlanId) : null;
    const prepBufferNights = ratePlan?.prepBufferNights ?? 0;
    const blockedUntil = addDays(args.checkOut, prepBufferNights);
    if (await findConflict(ctx, args.targetUnitId, args.checkIn, blockedUntil, args.bookingId)) throw new ConvexError('DATES_UNAVAILABLE');

    const oldNights = await ctx.db.query('unitNights').withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId)).collect();
    for (const night of oldNights) await ctx.db.delete(night._id);
    await insertOccupancy(ctx, { bookingId: args.bookingId, unitId: args.targetUnitId, checkIn: args.checkIn, checkOut: args.checkOut, prepBufferNights, block: booking.status === 'blocked' });
    const nextVersion = version + 1;
    const now = Date.now();
    await ctx.db.patch(args.bookingId, {
      unitId: args.targetUnitId,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      nights: nights.length,
      updatedAt: now,
      version: nextVersion,
      notes: [...booking.notes, { ts: now, text: `Moved from ${booking.checkIn}–${booking.checkOut}`, by: access.profile.name }],
    });
    await markPropertyDirtyInline(ctx, args.propertyId);
    const result = { bookingId: args.bookingId, version: nextVersion };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'booking.move',
      actorUserId: access.userId, actorName: access.profile.name, entityType: 'booking', entityId: args.bookingId,
      detail: `moved ${booking.confirmationCode} to ${targetUnit.name} ${args.checkIn} to ${args.checkOut}`, result,
      metadata: { previousUnitId: booking.unitId, previousCheckIn: booking.checkIn, previousCheckOut: booking.checkOut },
    });
    return { ...result, replayed: false };
  },
});

const guestValidator = v.object({ name: v.string(), email: v.string(), phone: v.string() });

async function upsertQuoteGuest(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  guest: { name: string; email: string; phone: string },
) {
  const normalizedEmail = guest.email.trim().toLowerCase();
  if (!normalizedEmail.includes('@') || !guest.name.trim()) throw new ConvexError('GUEST_INVALID');
  const existing = await ctx.db.query('guests').withIndex('by_email', (q) => q.eq('propertyId', propertyId).eq('normalizedEmail', normalizedEmail)).first();
  if (existing) return existing._id;
  return await ctx.db.insert('guests', {
    propertyId, name: guest.name.trim(), email: guest.email.trim(), phone: guest.phone.trim(), normalizedEmail,
    normalizedPhone: guest.phone.replace(/\D/g, ''), marketingOptIn: false, notes: [],
  });
}

export const createQuote = mutation({
  args: {
    propertyId: v.id('properties'), unitId: v.id('units'), ratePlanId: v.id('ratePlans'),
    checkIn: v.string(), checkOut: v.string(), adults: v.number(), children: v.number(),
    guest: guestValidator, expiresAt: v.number(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'quote.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ quoteId: Id<'quotes'> }>(ctx, args.propertyId, args.requestId, 'quote.create');
    if (replay) return { ...replay, replayed: true };
    assertDates(args.checkIn, args.checkOut);
    const [property, unit, ratePlan] = await Promise.all([ctx.db.get(args.propertyId), ctx.db.get(args.unitId), ctx.db.get(args.ratePlanId)]);
    if (!property || !unit || !ratePlan || unit.propertyId !== args.propertyId || ratePlan.propertyId !== args.propertyId || ratePlan.unitTypeId !== unit.unitTypeId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (!Number.isInteger(args.adults) || args.adults < 1 || !Number.isInteger(args.children) || args.children < 0) throw new ConvexError('INVALID_OCCUPANCY');
    if (args.expiresAt <= Date.now()) throw new ConvexError('QUOTE_EXPIRY_INVALID');
    const guestId = await upsertQuoteGuest(ctx, args.propertyId, args.guest);
    const priceBreakdown = computePrice({ ratePlan, checkIn: args.checkIn, checkOut: args.checkOut, addOns: [], taxRateBps: property.taxRateBps });
    const now = Date.now();
    const quoteId = await ctx.db.insert('quotes', {
      propertyId: args.propertyId, guestId, unitTypeId: unit.unitTypeId, unitId: unit._id, ratePlanId: ratePlan._id,
      checkIn: args.checkIn, checkOut: args.checkOut, adults: args.adults, children: args.children,
      amountCents: priceBreakdown.totalCents, gstCents: priceBreakdown.gstCents, currency: ratePlan.currency,
      priceBreakdown, status: 'draft', expiresAt: args.expiresAt, version: 0, createdBy: access.userId,
      createdAt: now, updatedAt: now,
    });
    const result = { quoteId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'quote.create', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'quote', entityId: quoteId,
      detail: `created quote for ${args.guest.name.trim()} ${args.checkIn} to ${args.checkOut}`, result,
    });
    return { ...result, replayed: false };
  },
});

export const acceptQuote = mutation({
  args: { propertyId: v.id('properties'), quoteId: v.id('quotes'), expectedVersion: v.number(), requestId: v.string() },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'quote.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ bookingId: Id<'bookings'>; quoteId: Id<'quotes'>; version: number }>(ctx, args.propertyId, args.requestId, 'quote.accept');
    if (replay) return { ...replay, replayed: true };
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.propertyId !== args.propertyId || !quote.unitId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (quote.version !== args.expectedVersion) throw new ConvexError(`VERSION_CONFLICT:${quote.version}`);
    if (quote.status === 'accepted' && quote.convertedBookingId) return { bookingId: quote.convertedBookingId, quoteId: quote._id, version: quote.version, replayed: true };
    if (!['draft', 'sent'].includes(quote.status)) throw new ConvexError('QUOTE_NOT_ACCEPTABLE');
    if (quote.expiresAt <= Date.now()) throw new ConvexError('QUOTE_EXPIRED');
    const ratePlan = await ctx.db.get(quote.ratePlanId);
    if (!ratePlan?.active) throw new ConvexError('RATE_PLAN_INVALID');
    const blockedUntil = addDays(quote.checkOut, ratePlan.prepBufferNights);
    if (await findConflict(ctx, quote.unitId, quote.checkIn, blockedUntil)) throw new ConvexError('DATES_UNAVAILABLE');
    const now = Date.now();
    const bookingId = await ctx.db.insert('bookings', {
      propertyId: quote.propertyId, unitId: quote.unitId, unitTypeId: quote.unitTypeId,
      guestId: quote.guestId, ratePlanId: quote.ratePlanId, checkIn: quote.checkIn, checkOut: quote.checkOut,
      nights: enumerateNights(quote.checkIn, quote.checkOut).length, adults: quote.adults, children: quote.children,
      status: 'hold', holdExpiresAt: now + HOLD_TTL_MS, source: 'front_desk:quote',
      confirmationCode: generateConfirmationCode((max) => Math.floor(Math.random() * max)),
      priceBreakdown: quote.priceBreakdown, statusHistory: [{ status: 'hold', ts: now }], notes: [],
      createdAt: now, updatedAt: now, version: 0,
    });
    await insertOccupancy(ctx, { bookingId, unitId: quote.unitId, checkIn: quote.checkIn, checkOut: quote.checkOut, prepBufferNights: ratePlan.prepBufferNights });
    const nextVersion = quote.version + 1;
    await ctx.db.patch(quote._id, { status: 'accepted', convertedBookingId: bookingId, version: nextVersion, updatedAt: now });
    await markPropertyDirtyInline(ctx, args.propertyId);
    const result = { bookingId, quoteId: quote._id, version: nextVersion };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'quote.accept', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'quote', entityId: quote._id,
      detail: `accepted quote into hold ${bookingId}`, result,
    });
    return { ...result, replayed: false };
  },
});

export const createMaintenanceTask = mutation({
  args: {
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    title: v.string(),
    description: v.string(),
    priority: v.union(v.literal('low'), v.literal('normal'), v.literal('high'), v.literal('urgent')),
    removesInventory: v.boolean(),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'maintenance.write');
    await requirePropertyFeature(ctx, args.propertyId, 'maintenance');
    const replay = await replayResult<{ maintenanceTaskId: Id<'maintenanceTasks'>; blockBookingId?: Id<'bookings'> }>(ctx, args.propertyId, args.requestId, 'maintenance.create');
    if (replay) return { ...replay, replayed: true };
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (!args.title.trim()) throw new ConvexError('TITLE_REQUIRED');
    let blockBookingId: Id<'bookings'> | undefined;
    const now = Date.now();
    if (args.removesInventory) {
      if (!args.checkIn || !args.checkOut) throw new ConvexError('BLOCK_DATES_REQUIRED');
      const nights = assertDates(args.checkIn, args.checkOut);
      if (await findConflict(ctx, args.unitId, args.checkIn, args.checkOut)) throw new ConvexError('DATES_UNAVAILABLE');
      blockBookingId = await ctx.db.insert('bookings', {
        propertyId: args.propertyId, unitId: args.unitId, unitTypeId: unit.unitTypeId,
        checkIn: args.checkIn, checkOut: args.checkOut, nights: nights.length, adults: 0, children: 0,
        status: 'blocked', source: 'maintenance',
        confirmationCode: `BLK-${generateConfirmationCode((max) => Math.floor(Math.random() * max)).slice(3)}`,
        statusHistory: [{ status: 'blocked', ts: now }],
        notes: [{ ts: now, text: args.title.trim(), by: access.profile.name }],
        createdAt: now, updatedAt: now, version: 0,
      });
      await insertOccupancy(ctx, { bookingId: blockBookingId, unitId: args.unitId, checkIn: args.checkIn, checkOut: args.checkOut, prepBufferNights: 0, block: true });
      await markPropertyDirtyInline(ctx, args.propertyId);
    }
    const maintenanceTaskId = await ctx.db.insert('maintenanceTasks', {
      propertyId: args.propertyId, unitId: args.unitId, title: args.title.trim(), description: args.description.trim(),
      priority: args.priority, status: 'open', removesInventory: args.removesInventory,
      linkedBlockBookingId: blockBookingId, version: 0, createdBy: access.userId, createdAt: now, updatedAt: now,
    });
    const result = { maintenanceTaskId, blockBookingId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'maintenance.create', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'maintenance_task', entityId: maintenanceTaskId,
      detail: `created ${args.priority} maintenance task for ${unit.name}`, result,
      metadata: { removesInventory: args.removesInventory, blockBookingId },
    });
    return { ...result, replayed: false };
  },
});

export const createCallTask = mutation({
  args: {
    propertyId: v.id('properties'), bookingId: v.optional(v.id('bookings')),
    title: v.string(), detail: v.string(), dueAt: v.optional(v.number()), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'booking.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ taskId: Id<'staffTasks'> }>(ctx, args.propertyId, args.requestId, 'task.call.create');
    if (replay) return { ...replay, replayed: true };
    if (args.bookingId) {
      const booking = await ctx.db.get(args.bookingId);
      if (!booking || booking.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    }
    if (!args.title.trim()) throw new ConvexError('TITLE_REQUIRED');
    const now = Date.now();
    const taskId = await ctx.db.insert('staffTasks', {
      propertyId: args.propertyId, bookingId: args.bookingId, kind: 'call', title: args.title.trim(),
      detail: args.detail.trim(), status: 'open', dueAt: args.dueAt, version: 0,
      createdBy: access.userId, createdAt: now, updatedAt: now,
    });
    const result = { taskId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'task.call.create', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'staff_task', entityId: taskId,
      detail: `created call task ${args.title.trim()}`, result,
    });
    return { ...result, replayed: false };
  },
});

export const authorizeComplimentary = mutation({
  args: { propertyId: v.id('properties'), bookingId: v.id('bookings'), reason: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'complimentary.approve');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ authorizationId: Id<'complimentaryAuthorizations'> }>(ctx, args.propertyId, args.requestId, 'complimentary.approve');
    if (replay) return { ...replay, replayed: true };
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (!booking.priceBreakdown) throw new ConvexError('BOOKING_VALUE_UNAVAILABLE');
    if (!args.reason.trim()) throw new ConvexError('REASON_REQUIRED');
    const existing = await ctx.db.query('complimentaryAuthorizations').withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId)).first();
    if (existing && existing.status === 'approved') throw new ConvexError('COMPLIMENTARY_ALREADY_APPROVED');
    const now = Date.now();
    const authorizationId = await ctx.db.insert('complimentaryAuthorizations', {
      propertyId: args.propertyId, bookingId: args.bookingId,
      originalValueCents: booking.priceBreakdown.totalCents, reason: args.reason.trim(), status: 'approved',
      requestedBy: access.userId, resolvedBy: access.userId, createdAt: now, updatedAt: now, resolvedAt: now,
    });
    await ctx.db.insert('rateAdjustments', {
      propertyId: args.propertyId, bookingId: args.bookingId,
      originalTotalCents: booking.priceBreakdown.totalCents, adjustedTotalCents: 0,
      reason: `Complimentary: ${args.reason.trim()}`, authorizedBy: access.userId, createdAt: now,
    });
    const result = { authorizationId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'complimentary.approve', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'complimentary_authorization', entityId: authorizationId,
      detail: `authorized complimentary stay ${booking.confirmationCode}`, result,
      metadata: { originalValueCents: booking.priceBreakdown.totalCents },
    });
    return { ...result, replayed: false };
  },
});

export const adjustBookingRate = mutation({
  args: {
    propertyId: v.id('properties'), bookingId: v.id('bookings'), adjustedTotalCents: v.number(),
    reason: v.string(), requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'rate.adjust');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const replay = await replayResult<{ adjustmentId: Id<'rateAdjustments'> }>(ctx, args.propertyId, args.requestId, 'rate.adjust');
    if (replay) return { ...replay, replayed: true };
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.propertyId !== args.propertyId || !booking.priceBreakdown) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    if (!Number.isInteger(args.adjustedTotalCents) || args.adjustedTotalCents < 0 || !args.reason.trim()) throw new ConvexError('INVALID_RATE_ADJUSTMENT');
    const adjustmentId = await ctx.db.insert('rateAdjustments', {
      propertyId: args.propertyId, bookingId: args.bookingId,
      originalTotalCents: booking.priceBreakdown.totalCents, adjustedTotalCents: args.adjustedTotalCents,
      reason: args.reason.trim(), authorizedBy: access.userId, createdAt: Date.now(),
    });
    const result = { adjustmentId };
    await finishOperation(ctx, {
      propertyId: args.propertyId, requestId: args.requestId, action: 'rate.adjust', actorUserId: access.userId,
      actorName: access.profile.name, entityType: 'rate_adjustment', entityId: adjustmentId,
      detail: `adjusted ${booking.confirmationCode} to ${args.adjustedTotalCents} cents`, result,
      metadata: { originalTotalCents: booking.priceBreakdown.totalCents, adjustedTotalCents: args.adjustedTotalCents },
    });
    return { ...result, replayed: false };
  },
});

export const createWaitlistEntry = mutation({
  args: {
    propertyId: v.id('properties'), unitTypeId: v.id('unitTypes'), desiredCheckIn: v.string(), desiredCheckOut: v.string(),
    adults: v.number(), children: v.number(), flexibility: v.string(), guest: guestValidator, requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'quote.write');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const prior = await replayResult<{ waitlistEntryId: Id<'waitlistEntries'> }>(ctx, args.propertyId, args.requestId, 'waitlist.create');
    if (prior) return { ...prior, replayed: true };
    assertDates(args.desiredCheckIn, args.desiredCheckOut);
    const unitType = await ctx.db.get(args.unitTypeId);
    if (!unitType || unitType.propertyId !== args.propertyId) throw new ConvexError('PROPERTY_RECORD_MISMATCH');
    const guestId = await upsertQuoteGuest(ctx, args.propertyId, args.guest);
    const now = Date.now();
    const waitlistEntryId = await ctx.db.insert('waitlistEntries', {
      propertyId: args.propertyId, guestId, unitTypeId: args.unitTypeId,
      desiredCheckIn: args.desiredCheckIn, desiredCheckOut: args.desiredCheckOut,
      adults: args.adults, children: args.children, flexibility: args.flexibility.trim(), status: 'open',
      version: 0, createdBy: access.userId, createdAt: now, updatedAt: now,
    });
    const result = { waitlistEntryId };
    await finishOperation(ctx, { propertyId: args.propertyId, requestId: args.requestId, action: 'waitlist.create', actorUserId: access.userId, actorName: access.profile.name, entityType: 'waitlist_entry', entityId: waitlistEntryId, detail: `added ${args.guest.name.trim()} to waitlist`, result });
    return { ...result, replayed: false };
  },
});

export const quoteBoard = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    await requirePropertyFeature(ctx, args.propertyId, 'command_center');
    const [quotes, waitlist, units, unitTypes, ratePlans] = await Promise.all([
      ctx.db.query('quotes').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('waitlistEntries').withIndex('by_property_status', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('units').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('unitTypes').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).collect(),
      ctx.db.query('ratePlans').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).collect(),
    ]);
    const quoteRows = await Promise.all(quotes.map(async (quote) => ({
      ...quote,
      guestName: (await ctx.db.get(quote.guestId))?.name ?? 'Unknown guest',
      unitName: quote.unitId ? (await ctx.db.get(quote.unitId))?.name ?? 'Any unit' : 'Any unit',
    })));
    const waitlistRows = await Promise.all(waitlist.map(async (entry) => ({
      ...entry,
      guestName: (await ctx.db.get(entry.guestId))?.name ?? 'Unknown guest',
      unitTypeName: unitTypes.find((type) => type._id === entry.unitTypeId)?.name ?? 'Unknown type',
    })));
    return {
      quotes: quoteRows,
      waitlist: waitlistRows,
      units: units.filter((unit) => unit.status === 'active').map((unit) => ({ unitId: unit._id, unitTypeId: unit.unitTypeId, name: unit.name })),
      unitTypes: unitTypes.map((type) => ({ unitTypeId: type._id, name: type.name })),
      ratePlans: ratePlans.filter((plan) => plan.active).map((plan) => ({ ratePlanId: plan._id, unitTypeId: plan.unitTypeId, name: plan.name })),
    };
  },
});
