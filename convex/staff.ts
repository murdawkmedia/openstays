import { ConvexError, v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Staff access control + staff-only admin mutations (M1).
//
// The rule: a Convex Auth users row grants NOTHING. Staff rights require an
// active staffProfiles row. requireStaff() is the single chokepoint — every
// admin query/mutation calls it first.
// ---------------------------------------------------------------------------

export async function requireStaff(
  ctx: QueryCtx | MutationCtx,
): Promise<{ userId: Id<'users'>; profile: Doc<'staffProfiles'> }> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError('UNAUTHENTICATED');
  const profile = await ctx.db
    .query('staffProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  if (!profile || !profile.active) throw new ConvexError('NOT_STAFF');
  return { userId, profile };
}

/** Who am I? Null when signed out or not (yet) staff — the admin UI gates on this. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query('staffProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!profile || !profile.active) return null;
    return { name: profile.name, role: profile.role };
  },
});

/**
 * One-time bootstrap, orchestrator-run against a deployment:
 *   npx convex run staff:bootstrap '{"email":"tim@example.com","name":"Tim"}'
 * Grants `owner` to an already-signed-up user. Refuses if any owner exists.
 */
export const bootstrap = internalMutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const existingOwner = (await ctx.db.query('staffProfiles').collect()).find(
      (p) => p.role === 'owner' && p.active,
    );
    if (existingOwner) throw new ConvexError('OWNER_EXISTS');
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', args.email))
      .unique();
    if (!user) throw new ConvexError('USER_NOT_FOUND_SIGN_UP_FIRST');
    await ctx.db.insert('staffProfiles', {
      userId: user._id,
      name: args.name,
      role: 'owner',
      active: true,
      createdAt: Date.now(),
    });
    return { granted: true };
  },
});

// ---------------------------------------------------------------------------
// Contracts below are implemented by builder D (admin auth + settings stream).
// Signatures are FIXED — the UI codes against them.
// ---------------------------------------------------------------------------

/** Owner grants/revokes staff. */
export const grantStaff = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal('owner'), v.literal('staff')),
  },
  handler: async (): Promise<{ granted: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder D
  },
});

export const revokeStaff = mutation({
  args: { staffProfileId: v.id('staffProfiles') },
  handler: async (): Promise<{ revoked: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder D
  },
});

export const listStaff = query({
  args: {},
  handler: async (): Promise<
    Array<{ staffProfileId: Id<'staffProfiles'>; name: string; email: string; role: string; active: boolean }>
  > => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder D
  },
});

/**
 * Staff-editable property settings (the /admin/settings page goes editable in
 * M1). Only non-secret display/config prefs — secrets stay in env vars.
 */
export const updateProperty = mutation({
  args: {
    propertyId: v.id('properties'),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      currency: v.optional(v.string()), // validated against SUPPORTED_CURRENCIES
      taxRateBps: v.optional(v.number()),
      taxLabel: v.optional(v.string()),
      gstNumber: v.optional(v.string()),
      checkInTime: v.optional(v.string()),
      checkOutTime: v.optional(v.string()),
    }),
  },
  handler: async (): Promise<{ updated: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder D
  },
});
