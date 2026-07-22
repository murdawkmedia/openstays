import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { requireStaff, writeAudit } from './staff';

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
