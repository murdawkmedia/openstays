import { ConvexError, v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { bridgeBearerAuthorized } from './wavelength';

const LEASE_MS = 30_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

export function mailBridgeAuthorized(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  return bridgeBearerAuthorized(authorization, expectedToken);
}

function sanitizeDeliveryError(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/(password|pass|token|secret)=\S+/gi, '$1=[redacted]')
    .trim()
    .slice(0, 500);
}

export const claimPending = internalMutation({
  args: { limit: v.number(), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 25);
    const leaseToken = args.leaseToken.trim();
    if (!leaseToken) throw new ConvexError('INVALID_MAIL_LEASE');
    const rows = await ctx.db
      .query('emailLog')
      .withIndex('by_status_nextAttemptAt', (q) => q.eq('status', 'queued'))
      .take(limit * 3);
    const claimable = rows
      .filter((row) =>
        row.provider === 'mail_bridge' &&
        (row.nextAttemptAt ?? 0) <= now &&
        (row.leaseExpiresAt ?? 0) <= now,
      )
      .slice(0, limit);
    const leaseExpiresAt = now + LEASE_MS;
    for (const row of claimable) {
      await ctx.db.patch(row._id, { leaseToken, leaseExpiresAt });
    }
    return claimable.map((row) => ({ ...row, leaseToken, leaseExpiresAt }));
  },
});

export const markDelivered = internalMutation({
  args: {
    emailLogId: v.id('emailLog'),
    leaseToken: v.string(),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.emailLogId);
    if (!row) throw new ConvexError('EMAIL_LOG_NOT_FOUND');
    if (row.status === 'sent') return { delivered: false };
    if (
      row.status !== 'queued' ||
      row.leaseToken !== args.leaseToken ||
      (row.leaseExpiresAt ?? 0) < Date.now()
    ) {
      throw new ConvexError('MAIL_LEASE_MISMATCH');
    }
    await ctx.db.patch(row._id, {
      status: 'sent',
      providerMessageId: args.providerMessageId?.trim() || undefined,
      deliveredAt: Date.now(),
      error: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    return { delivered: true };
  },
});

export const markFailed = internalMutation({
  args: {
    emailLogId: v.id('emailLog'),
    leaseToken: v.string(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.emailLogId);
    if (!row) throw new ConvexError('EMAIL_LOG_NOT_FOUND');
    if (row.status === 'sent') return { failed: false, terminal: true };
    if (
      row.status !== 'queued' ||
      row.leaseToken !== args.leaseToken ||
      (row.leaseExpiresAt ?? 0) < Date.now()
    ) {
      throw new ConvexError('MAIL_LEASE_MISMATCH');
    }
    const attemptCount = (row.attemptCount ?? 0) + 1;
    const terminal = !args.retryable || attemptCount >= RETRY_DELAYS_MS.length;
    await ctx.db.patch(row._id, {
      status: terminal ? 'failed' : 'queued',
      attemptCount,
      nextAttemptAt: terminal
        ? undefined
        : Date.now() + RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)],
      error: sanitizeDeliveryError(args.error),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    return { failed: true, terminal };
  },
});
