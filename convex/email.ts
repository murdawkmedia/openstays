import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { BookingEmailData } from './emailTemplates';
import { renderCancellation, renderConfirmation, renderPaymentConflict } from './emailTemplates';

/** getEmailContext's return shape: template data + delivery-only fields. */
export type EmailContext = BookingEmailData & {
  propertyId: Id<'properties'>;
  guestEmail: string;
  refundCents: number;
};

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
    // Cancellation only: the policy-computed refund amount, passed by
    // cancelByGuest. For stripe/square the refunds[] row is written only AFTER
    // the provider round-trip, so deriving the refund from the context here
    // would race the refund and render "Refund: $0.00". This override wins.
    refundCents: v.optional(v.number()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const templateKey = args.kind;

    // Idempotency: skip if this (bookingId, templateKey) already sent/logged.
    const priorStatus: 'sent' | 'logged' | null = await ctx.runQuery(
      internal.email.getPriorLogStatus,
      { bookingId: args.bookingId, templateKey },
    );
    if (priorStatus === 'sent' || priorStatus === 'logged') {
      return;
    }

    const context: EmailContext | null = await ctx.runQuery(internal.email.getEmailContext, {
      bookingId: args.bookingId,
    });
    if (!context) {
      // Booking/property/guest vanished — nothing sane to send or log against.
      return;
    }

    let rendered;
    if (args.kind === 'confirmation') {
      rendered = renderConfirmation(context);
    } else if (args.kind === 'cancellation') {
      // Prefer the caller's policy-computed refund (cancelByGuest) over the
      // context value derived from refunds[] (which lags the provider refund).
      const refundCents = args.refundCents ?? context.refundCents;
      // For provider payments the money is still in flight when this sends, so
      // the copy says the refund "is being processed".
      rendered = renderCancellation({ ...context, refundCents, refundInFlight: refundCents > 0 });
    } else {
      rendered = renderPaymentConflict(context);
    }

    const demoMode = process.env.DEMO_MODE === 'true';
    const apiKey = process.env.RESEND_API_KEY;

    if (demoMode || !apiKey) {
      await ctx.runMutation(internal.email.writeLog, {
        propertyId: context.propertyId,
        to: context.guestEmail,
        templateKey,
        subject: rendered.subject,
        bookingId: args.bookingId,
        status: 'logged',
      });
      return;
    }

    const logId = await ctx.runMutation(internal.email.writeLog, {
      propertyId: context.propertyId,
      to: context.guestEmail,
      templateKey,
      subject: rendered.subject,
      bookingId: args.bookingId,
      status: 'queued',
    });

    const from = process.env.EMAIL_FROM ?? `${context.propertyName} <no-reply@example.com>`;

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: context.guestEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      });
    } catch (error) {
      // Network failure — transient, treated like a 5xx.
      await retryOrFail(ctx, logId, args, error instanceof Error ? error.message : 'Network error');
      return;
    }

    if (response.ok) {
      let providerMessageId: string | undefined;
      try {
        const body: unknown = await response.json();
        providerMessageId =
          body && typeof body === 'object' && 'id' in body && typeof (body as { id: unknown }).id === 'string'
            ? (body as { id: string }).id
            : undefined;
      } catch {
        providerMessageId = undefined;
      }
      await ctx.runMutation(internal.email.updateLog, {
        logId,
        status: 'sent',
        providerMessageId,
      });
      return;
    }

    if (response.status >= 400 && response.status < 500) {
      const errorText = await safeText(response);
      await ctx.runMutation(internal.email.updateLog, {
        logId,
        status: 'failed',
        error: `HTTP ${response.status}: ${errorText}`,
      });
      return;
    }

    // 5xx — transient, retry with backoff.
    const errorText = await safeText(response);
    await retryOrFail(ctx, logId, args, `HTTP ${response.status}: ${errorText}`);
  },
});

/**
 * Staff alert email (M1 money-fix): a real email to the PROPERTY's own address
 * for operational failures a human must act on — a dead-lettered refund, a
 * captured-amount mismatch. Mirrors sendBookingEmail's send/log-degrade
 * pattern (no RESEND_API_KEY or DEMO_MODE → emailLog row only), but has NO
 * idempotency skip: every alert is distinct and must be surfaced.
 */
export const sendStaffAlert = internalAction({
  args: {
    propertyId: v.id('properties'),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const property = await ctx.runQuery(internal.email.getProperty, {
      propertyId: args.propertyId,
    });
    if (!property) return; // nothing to send against
    const to = property.email;

    const demoMode = process.env.DEMO_MODE === 'true';
    const apiKey = process.env.RESEND_API_KEY;

    if (demoMode || !apiKey) {
      await ctx.runMutation(internal.email.writeLog, {
        propertyId: args.propertyId,
        to,
        templateKey: 'staff_alert',
        subject: args.subject,
        status: 'logged',
      });
      return;
    }

    const from = process.env.EMAIL_FROM ?? `${property.name} <no-reply@example.com>`;
    const logId = await ctx.runMutation(internal.email.writeLog, {
      propertyId: args.propertyId,
      to,
      templateKey: 'staff_alert',
      subject: args.subject,
      status: 'queued',
    });

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject: args.subject,
          text: args.body,
        }),
      });
    } catch (error) {
      await ctx.runMutation(internal.email.updateLog, {
        logId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Network error',
      });
      return;
    }

    if (response.ok) {
      let providerMessageId: string | undefined;
      try {
        const body: unknown = await response.json();
        providerMessageId =
          body && typeof body === 'object' && 'id' in body && typeof (body as { id: unknown }).id === 'string'
            ? (body as { id: string }).id
            : undefined;
      } catch {
        providerMessageId = undefined;
      }
      await ctx.runMutation(internal.email.updateLog, { logId, status: 'sent', providerMessageId });
      return;
    }
    const errorText = await safeText(response);
    await ctx.runMutation(internal.email.updateLog, {
      logId,
      status: 'failed',
      error: `HTTP ${response.status}: ${errorText}`,
    });
  },
});

/** Minimal property lookup for sendStaffAlert (actions have no db access). */
export const getProperty = internalQuery({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) return null;
    return { name: property.name, email: property.email };
  },
});

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function retryOrFail(
  ctx: {
    runMutation: (fn: typeof internal.email.updateLog, args: {
      logId: Id<'emailLog'>;
      status: 'sent' | 'failed';
      providerMessageId?: string;
      error?: string;
    }) => Promise<unknown>;
    scheduler: {
      runAfter: (
        delayMs: number,
        fn: typeof internal.email.sendBookingEmail,
        args: {
          bookingId: Id<'bookings'>;
          kind: 'confirmation' | 'cancellation' | 'payment_conflict';
          refundCents?: number;
          attempt: number;
        },
      ) => Promise<unknown>;
    };
  },
  logId: Id<'emailLog'>,
  args: {
    bookingId: Id<'bookings'>;
    kind: 'confirmation' | 'cancellation' | 'payment_conflict';
    refundCents?: number;
    attempt?: number;
  },
  error: string,
): Promise<void> {
  const attempt = args.attempt ?? 0;
  if (attempt < 3) {
    await ctx.scheduler.runAfter(60_000 * (attempt + 1), internal.email.sendBookingEmail, {
      bookingId: args.bookingId,
      kind: args.kind,
      // Carry the refund override across retries so a retried cancellation email
      // still shows the policy amount.
      refundCents: args.refundCents,
      attempt: attempt + 1,
    });
    return;
  }
  await ctx.runMutation(internal.email.updateLog, {
    logId,
    status: 'failed',
    error,
  });
}

/** Read the most recent emailLog status for (bookingId, templateKey), if any. (builder E) */
export const getPriorLogStatus = internalQuery({
  args: { bookingId: v.id('bookings'), templateKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('emailLog')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
      .collect();
    const matching = rows.filter((r) => r.templateKey === args.templateKey);
    if (matching.some((r) => r.status === 'sent')) return 'sent';
    if (matching.some((r) => r.status === 'logged')) return 'logged';
    return null;
  },
});

/**
 * Load booking + property + guest → the BookingEmailData shape plus guestEmail
 * and propertyId (needed by sendBookingEmail but not part of the template
 * data itself). paidCents = sum of 'paid' payments for this booking;
 * balanceDueCents = priceBreakdown.totalCents − paidCents (never negative).
 * manageUrl = `${SITE_URL}/manage/${confirmationCode}`. (builder E)
 */
export const getEmailContext = internalQuery({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args): Promise<EmailContext | null> => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    const property = await ctx.db.get(booking.propertyId);
    if (!property) return null;
    const unitType = await ctx.db.get(booking.unitTypeId);
    const guest = booking.guestId ? await ctx.db.get(booking.guestId) : null;

    const payments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
      .collect();
    // paidCents = the amount actually STILL held: each counted row's captured
    // amount minus its refunds (floored at 0 per row). A fully refunded row
    // therefore contributes 0, and a partially refunded row contributes the
    // still-paid remainder — never the gross amount (which overstated 'Paid'
    // and understated 'Balance due').
    const paidCents = payments
      .filter(
        (p) => p.status === 'paid' || p.status === 'partially_refunded' || p.status === 'refunded',
      )
      .reduce((sum, p) => {
        const refundedForRow = p.refunds.reduce((rsum, r) => rsum + r.amountCents, 0);
        return sum + Math.max(0, p.amountCents - refundedForRow);
      }, 0);
    const refundCents = payments.reduce(
      (sum, p) => sum + p.refunds.reduce((rsum, r) => rsum + r.amountCents, 0),
      0,
    );

    const totalCents = booking.priceBreakdown?.totalCents ?? 0;
    const balanceDueCents = Math.max(0, totalCents - paidCents);

    const siteUrl = process.env.SITE_URL ?? '';
    const manageUrl = `${siteUrl}/manage/${booking.confirmationCode}`;

    return {
      guestName: guest?.name ?? 'Guest',
      guestEmail: guest?.email ?? '',
      propertyId: booking.propertyId,
      propertyName: property.name,
      propertyEmail: property.email,
      propertyPhone: property.phone,
      unitTypeName: unitType?.name ?? '',
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      confirmationCode: booking.confirmationCode,
      currency: property.currency,
      taxLabel: property.taxLabel ?? 'Tax',
      totalCents,
      paidCents,
      balanceDueCents,
      refundCents,
      manageUrl,
    };
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
