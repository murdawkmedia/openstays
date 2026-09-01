import { ConvexError, v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { requireAutomationPropertyCapability } from './staff';
import type { OperationalCapability } from '../shared/operations';

const ACTION_CAPABILITIES: Record<string, OperationalCapability> = {
  'booking.block': 'booking.write',
  'booking.move': 'booking.write',
  'quote.create': 'quote.write',
  'quote.accept': 'quote.write',
  'waitlist.create': 'quote.write',
  'maintenance.create': 'maintenance.write',
  'task.call.create': 'booking.write',
  'task.call.complete': 'booking.write',
  'complimentary.approve': 'complimentary.approve',
  'rate.adjust': 'rate.adjust',
  'front_desk.check_in': 'booking.check_in_out',
  'front_desk.check_out': 'booking.check_in_out',
  'front_desk.no_show': 'booking.check_in_out',
  'front_desk.flag.create': 'front_desk.flag.write',
  'front_desk.flag.assign': 'front_desk.flag.write',
  'front_desk.flag.resolve': 'front_desk.flag.write',
  'housekeeping.assign': 'housekeeping.assign',
  'housekeeping.state.transition': 'housekeeping.update',
  'housekeeping.assignment.update': 'housekeeping.verify',
  'housekeeping.assignment.start': 'housekeeping.checklist.update',
  'housekeeping.checklist.item': 'housekeeping.checklist.update',
  'housekeeping.inspection.submit': 'housekeeping.checklist.update',
  'housekeeping.inspection.review': 'housekeeping.verify',
  'housekeeping.assignment.cancel': 'housekeeping.verify',
  'maintenance.resolve': 'maintenance.write',
  'folio.retail.create': 'folio.post',
  'folio.entry.post': 'folio.post',
  'folio.entry.reverse': 'folio.post',
  'folio.payment.record': 'folio.post',
  'night_audit.close': 'night_audit.close',
  'group.create': 'booking.write',
  'seasonal_contract.create': 'booking.write',
  'reminder.create': 'booking.write',
  'gift_certificate.issue': 'folio.post',
};

export const issueClaim = internalMutation({
  args: {
    apiKeyId: v.id('apiKeys'),
    actorUserId: v.id('users'),
    propertyId: v.id('properties'),
    action: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('automationClaims')
      .withIndex('by_expiry', (q) => q.lte('expiresAt', now))
      .take(100);
    for (const claim of expired) await ctx.db.delete(claim._id);

    const key = await ctx.db.get(args.apiKeyId);
    if (!key?.active || key.scope !== 'write' || key.createdBy !== args.actorUserId) {
      throw new ConvexError('AUTOMATION_KEY_INVALID');
    }
    const capability = ACTION_CAPABILITIES[args.action];
    if (!capability) throw new ConvexError('AUTOMATION_ACTION_UNKNOWN');
    await requireAutomationPropertyCapability(ctx, args.actorUserId, args.propertyId, capability);
    const activeClaims = await ctx.db
      .query('automationClaims')
      .withIndex('by_apiKey_expiry', (q) =>
        q.eq('apiKeyId', args.apiKeyId).gt('expiresAt', now),
      )
      .take(100);
    if (activeClaims.length >= 100) throw new ConvexError('AUTOMATION_CLAIM_LIMIT');
    await ctx.db.insert('automationClaims', {
      token: args.token,
      apiKeyId: args.apiKeyId,
      actorUserId: args.actorUserId,
      propertyId: args.propertyId,
      action: args.action,
      expiresAt: now + 60_000,
    });
    return { issued: true };
  },
});
