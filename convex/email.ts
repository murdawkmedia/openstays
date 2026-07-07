import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';

/**
 * Transactional email (M1, builder E; signatures FIXED — bookings.ts schedules
 * these, so names/args must not change).
 *
 * Provider: Resend via raw fetch (https://api.resend.com/emails, bearer
 * RESEND_API_KEY). Sender = EMAIL_FROM env (e.g. 'Pinewood Flats
 * <stays@pinewood.example>'). NO key configured (or DEMO_MODE=true) → the send
 * degrades to an emailLog row with status 'logged' — demo and fresh
 * self-hosts work with zero email setup.
 *
 * sendBookingEmail flow:
 *  1. Load booking + property + guest via runQuery
 *     internal.email.getEmailContext (builder E adds it — internal query in
 *     THIS file, keeping bookings.ts untouched by stream E).
 *  2. Render the template (emailTemplates.ts — pure, unit-testable).
 *  3. Insert emailLog row status 'queued' (writeLog below), then fetch Resend;
 *     patch to 'sent' (+providerMessageId) or 'failed' (+error). Transient
 *     failure → reschedule self (attempt < 3, backoff 60s·attempt).
 *  4. Idempotency: skip the send if an emailLog row for (bookingId,
 *     templateKey) is already 'sent' — webhook retries must not double-email.
 */
export const sendBookingEmail = internalAction({
  args: {
    bookingId: v.id('bookings'),
    kind: v.union(
      v.literal('confirmation'),
      v.literal('cancellation'),
      v.literal('payment_conflict'),
    ),
    attempt: v.optional(v.number()),
  },
  handler: async (): Promise<void> => {
    // builder E — until implemented, a silent no-op so booking flows never block.
  },
});

/** Append an emailLog row; returns its id. (builder E) */
export const writeLog = internalMutation({
  args: {
    propertyId: v.id('properties'),
    to: v.string(),
    templateKey: v.string(),
    subject: v.string(),
    bookingId: v.optional(v.id('bookings')),
    status: v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'), v.literal('logged')),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('emailLog', { ...args, ts: Date.now() });
  },
});

/** Patch an emailLog row's delivery outcome. (builder E) */
export const updateLog = internalMutation({
  args: {
    logId: v.id('emailLog'),
    status: v.union(v.literal('sent'), v.literal('failed')),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { logId, ...patch }) => {
    await ctx.db.patch(logId, patch);
  },
});
