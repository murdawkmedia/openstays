import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireStaff, writeAudit } from './staff';

const GUEST_PUBLIC_REFUND_REASON = 'guest_requested_public_contribution_refund';

async function authenticateGuest(
  ctx: QueryCtx | MutationCtx,
  confirmationCode: string,
  email: string,
) {
  const booking = await ctx.db
    .query('bookings')
    .withIndex('by_confirmationCode', (q) =>
      q.eq('confirmationCode', confirmationCode.trim().toUpperCase()))
    .first();
  const guest = booking?.guestId ? await ctx.db.get(booking.guestId) : null;
  if (!booking || !guest || guest.normalizedEmail !== email.trim().toLowerCase()) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Booking not found.' });
  }
  return booking;
}

export const forGuest = query({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const booking = await authenticateGuest(ctx, args.confirmationCode, args.email);
    const [payments, cases] = await Promise.all([
      ctx.db.query('payments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
      ctx.db.query('refundCases').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).collect(),
    ]);
    const refundable = payments.filter((payment) =>
      (payment.provider === 'zaprite' || payment.provider === 'wavelength')
      && payment.status === 'paid');
    const publicCases = cases.filter((refundCase) =>
      refundable.some((payment) => payment._id === refundCase.paymentId)
      && refundCase.reason === GUEST_PUBLIC_REFUND_REASON);
    return {
      refundablePaymentCount: refundable.length,
      requestedCaseCount: publicCases.filter((refundCase) => refundCase.status === 'open').length,
      completedCaseCount: publicCases.filter((refundCase) => refundCase.status === 'completed').length,
      refundableAmountCents: refundable.reduce((sum, payment) => sum + payment.amountCents, 0),
    };
  },
});

export const requestForGuest = mutation({
  args: { confirmationCode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const booking = await authenticateGuest(ctx, args.confirmationCode, args.email);
    const payments = await ctx.db.query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .collect();
    const refundable = payments.filter((payment) =>
      (payment.provider === 'zaprite' || payment.provider === 'wavelength')
      && payment.status === 'paid');
    if (refundable.length === 0) {
      throw new ConvexError({
        code: 'NO_REFUNDABLE_PUBLIC_PAYMENT',
        message: 'No paid Zaprite or Wavelength contribution is eligible for a manual refund request.',
      });
    }
    const existingCases = await ctx.db.query('refundCases')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .collect();
    let requested = false;
    let caseCount = 0;
    let amountCents = 0;
    const now = Date.now();
    for (const payment of refundable) {
      amountCents += payment.amountCents;
      // Never allow a second manual disposition for the same payment, even if
      // the first case was opened by cancellation or reconciliation.
      const existing = existingCases.find((refundCase) => refundCase.paymentId === payment._id);
      if (existing) {
        caseCount += 1;
        continue;
      }
      const refundCaseId = await ctx.db.insert('refundCases', {
        propertyId: payment.propertyId,
        paymentId: payment._id,
        bookingId: booking._id,
        amountCents: payment.amountCents,
        currency: payment.currency,
        reason: GUEST_PUBLIC_REFUND_REASON,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, (internal as any).email.sendRefundCaseNotice, {
        refundCaseId,
        kind: 'required',
      });
      requested = true;
      caseCount += 1;
    }
    return { requested, caseCount, amountCents };
  },
});

export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const cases = await ctx.db
      .query('refundCases')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'open'))
      .order('asc')
      .collect();
    return await Promise.all(
      cases.map(async (refundCase) => {
        const [payment, booking] = await Promise.all([
          ctx.db.get(refundCase.paymentId),
          ctx.db.get(refundCase.bookingId),
        ]);
        return {
          ...refundCase,
          provider: payment?.provider ?? 'unknown',
          confirmationCode: booking?.confirmationCode ?? 'unknown',
        };
      }),
    );
  },
});

export const complete = mutation({
  args: {
    refundCaseId: v.id('refundCases'),
    externalReference: v.string(),
  },
  handler: async (ctx, args): Promise<{ completed: boolean }> => {
    const { profile } = await requireStaff(ctx);
    const externalReference = args.externalReference.trim();
    if (!externalReference || externalReference.length > 200) {
      throw new ConvexError('EXTERNAL_REFERENCE_REQUIRED');
    }
    const refundCase = await ctx.db.get(args.refundCaseId);
    if (!refundCase) throw new ConvexError('REFUND_CASE_NOT_FOUND');
    if (refundCase.status === 'completed') return { completed: false };
    const payment = await ctx.db.get(refundCase.paymentId);
    if (!payment) throw new ConvexError('PAYMENT_NOT_FOUND');

    const now = Date.now();
    const refunds = [
      ...payment.refunds,
      {
        amountCents: refundCase.amountCents,
        providerRefundId: externalReference,
        reason: refundCase.reason,
        ts: now,
        by: profile.name,
      },
    ];
    const totalRefunded = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    await ctx.db.patch(payment._id, {
      refunds,
      status: totalRefunded >= payment.amountCents ? 'refunded' : 'partially_refunded',
    });
    await ctx.db.patch(refundCase._id, {
      status: 'completed',
      externalReference,
      resolvedBy: profile.name,
      resolvedAt: now,
      updatedAt: now,
    });
    await writeAudit(
      ctx,
      'refund.complete',
      `completed refund case ${refundCase._id} for ${refundCase.amountCents} ${refundCase.currency}`,
    );
    await ctx.scheduler.runAfter(0, (internal as any).email.sendRefundCaseNotice, {
      refundCaseId: refundCase._id,
      kind: 'completed',
    });
    return { completed: true };
  },
});
