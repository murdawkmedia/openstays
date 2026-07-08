import { ConvexError, v } from 'convex/values';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import type { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// API key lifecycle (M1.5) — machine credentials for the HTTP API v1.
// Raw token format: 'osk_' + 48 hex chars (24 random bytes). Stored as
// SHA-256 hex only; shown once at creation. Builder H implements the stubs;
// signatures are FIXED (the admin UI and apiV1.ts code against them).
// ---------------------------------------------------------------------------

/**
 * Staff-only (owner role) action: mints a token, stores its hash, returns the
 * RAW token exactly once. Actions can use crypto.getRandomValues; the insert
 * happens via the internal mutation below.
 */
export const createApiKey = action({
  args: {
    name: v.string(),
    scope: v.union(v.literal('read'), v.literal('write')),
  },
  handler: async (): Promise<{ token: string; prefix: string }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder H
  },
});

/** Internal: store a minted key (called by createApiKey after staff check). */
export const insertKey = internalMutation({
  args: {
    name: v.string(),
    keyHash: v.string(),
    prefix: v.string(),
    scope: v.union(v.literal('read'), v.literal('write')),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('apiKeys', { ...args, active: true, createdAt: Date.now() });
  },
});

/** Staff-only (owner role): deactivate a key. Soft revoke — audit trail stays. */
export const revokeApiKey = internalMutation({
  args: { apiKeyId: v.id('apiKeys') },
  handler: async (): Promise<{ revoked: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder H — NOTE: convert to a
    // public staff-gated mutation; internalMutation here only to keep the stub
    // compiling without auth wiring. FIXED public name: revokeApiKey.
  },
});

/** Staff-gated: list keys (prefix + metadata only — never hashes). */
export const listApiKeys = query({
  args: {},
  handler: async (): Promise<
    Array<{
      apiKeyId: Id<'apiKeys'>;
      name: string;
      prefix: string;
      scope: string;
      active: boolean;
      createdAt: number;
      lastUsedAt?: number;
    }>
  > => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder H
  },
});

/**
 * Internal: resolve a token hash → scope, or null (unknown/revoked). Used by
 * every /api/v1 request. lastUsedAt is touched at most once per hour (via
 * touchLastUsed) to avoid a write per request.
 */
export const verifyKey = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args): Promise<{ scope: 'read' | 'write'; apiKeyId: Id<'apiKeys'>; lastUsedAt?: number } | null> => {
    const key = await ctx.db
      .query('apiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique();
    if (!key || !key.active) return null;
    return { scope: key.scope, apiKeyId: key._id, lastUsedAt: key.lastUsedAt };
  },
});

export const touchLastUsed = internalMutation({
  args: { apiKeyId: v.id('apiKeys') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: Date.now() });
  },
});

/** SHA-256 hex of a raw token — shared by createApiKey and the request path. */
export async function sha256HexOf(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
