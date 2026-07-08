import { ConvexError, v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// API key lifecycle (M1.5) — machine credentials for the HTTP API v1.
// Raw token format: 'osk_' + 48 hex chars (24 random bytes). Stored as
// SHA-256 hex only; shown once at creation. Builder H implements the stubs;
// signatures are FIXED (the admin UI and apiV1.ts code against them).
// ---------------------------------------------------------------------------

/**
 * Internal: resolve the calling identity to an ACTIVE OWNER staffProfile, or
 * throw. Actions can't touch the db, so createApiKey (an action, because it
 * needs crypto.getRandomValues) does its owner check through this query.
 *
 * DEMO_MODE: the writable public demo has no real auth (synthetic staff via
 * staff.me, nightly reset), so we allow key creation and tag it 'demo' — same
 * carve-out staff.me / updateProperty / tapeForProperty make. Never set
 * DEMO_MODE on a real deployment.
 *
 * Returns the createdBy tag string the insert should record.
 */
export const requireOwnerIdentity = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ createdBy: string }> => {
    if (process.env.DEMO_MODE === 'true') {
      return { createdBy: 'demo' };
    }
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError('UNAUTHENTICATED');
    const profile = await ctx.db
      .query('staffProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!profile || !profile.active) throw new ConvexError('NOT_STAFF');
    if (profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');
    return { createdBy: userId };
  },
});

/**
 * Staff-only (owner role) action: mints a token, stores its hash, returns the
 * RAW token exactly once. Actions can use crypto.getRandomValues; the insert
 * happens via the internal mutation below. The owner check runs through
 * requireOwnerIdentity (an action has no db).
 */
export const createApiKey = action({
  args: {
    name: v.string(),
    scope: v.union(v.literal('read'), v.literal('write')),
  },
  handler: async (ctx, args): Promise<{ token: string; prefix: string }> => {
    const { createdBy } = await ctx.runQuery(internal.apiKeys.requireOwnerIdentity, {});

    // DEMO_MODE: the demo mints keys with no real auth (requireOwnerIdentity's
    // carve-out) so the admin UI can showcase the flow. An anonymous demo
    // visitor must NEVER obtain a WRITE credential — force scope to 'read'
    // regardless of what was requested. Real deployments are owner-gated and
    // may mint any scope. (Adversarial review 2026-07-08.)
    const scope = process.env.DEMO_MODE === 'true' ? 'read' : args.scope;

    // 'osk_' + 48 lowercase hex chars (24 random bytes).
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const token = `osk_${hex}`;
    // prefix = first 12 chars ('osk_' + first 8 hex) — display/identification only.
    const prefix = token.slice(0, 12);
    const keyHash = await sha256HexOf(token);

    await ctx.runMutation(internal.apiKeys.insertKey, {
      name: args.name,
      keyHash,
      prefix,
      scope,
      createdBy,
    });

    // token is returned ONCE and never stored (only its hash is).
    return { token, prefix };
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

/**
 * Staff-only (owner role): deactivate a key. Soft revoke — the row stays for
 * the audit trail, only `active` flips false (verifyKey then returns null).
 * Public mutation (the FIXED exported name is revokeApiKey); the stub was an
 * internalMutation only so it compiled without the auth wiring.
 */
export const revokeApiKey = mutation({
  args: { apiKeyId: v.id('apiKeys') },
  handler: async (ctx, args): Promise<{ revoked: boolean }> => {
    // Owner-only, with the same DEMO_MODE carve-out as createApiKey.
    if (process.env.DEMO_MODE !== 'true') {
      const userId = await getAuthUserId(ctx);
      if (userId === null) throw new ConvexError('UNAUTHENTICATED');
      const profile = await ctx.db
        .query('staffProfiles')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .unique();
      if (!profile || !profile.active) throw new ConvexError('NOT_STAFF');
      if (profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');
    }

    const key = await ctx.db.get(args.apiKeyId);
    if (!key) throw new ConvexError('NOT_FOUND');
    await ctx.db.patch(args.apiKeyId, { active: false });
    return { revoked: true };
  },
});

/** Staff-gated: list keys (prefix + metadata only — never hashes). */
export const listApiKeys = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
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
    // Staff-gated (any active staff, matching listStaff / forSettings). Owner
    // is only required to MINT or REVOKE; viewing the key list is fine for
    // staff. DEMO_MODE is exempt like everywhere else.
    if (process.env.DEMO_MODE !== 'true') {
      const userId = await getAuthUserId(ctx);
      if (userId === null) throw new ConvexError('UNAUTHENTICATED');
      const profile = await ctx.db
        .query('staffProfiles')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .unique();
      if (!profile || !profile.active) throw new ConvexError('NOT_STAFF');
    }

    const keys = await ctx.db.query('apiKeys').collect();
    // keyHash is deliberately NEVER returned — only the display prefix.
    return keys.map((k) => ({
      apiKeyId: k._id,
      name: k.name,
      prefix: k.prefix,
      scope: k.scope,
      active: k.active,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
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
