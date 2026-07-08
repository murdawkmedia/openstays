import { ConvexError, v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { isSupportedCurrency } from '../shared/currency';

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
    // Public demo only: everyone browses the admin area as a synthetic staff
    // member (role 'staff', so owner-only staff management stays hidden).
    // A DEMO_MODE deployment is insecure BY DESIGN (simulated payments,
    // nightly reset) — never set DEMO_MODE on a real deployment.
    if (process.env.DEMO_MODE === 'true') {
      return { name: 'Demo staff', role: 'staff' as const };
    }
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
  handler: async (ctx, args): Promise<{ granted: boolean }> => {
    const { profile } = await requireStaff(ctx);
    if (profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');

    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', args.email))
      .unique();
    if (!user) throw new ConvexError('USER_NOT_FOUND_SIGN_UP_FIRST');

    const existing = await ctx.db
      .query('staffProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        role: args.role,
        active: true,
      });
    } else {
      await ctx.db.insert('staffProfiles', {
        userId: user._id,
        name: args.name,
        role: args.role,
        active: true,
        createdAt: Date.now(),
      });
    }
    return { granted: true };
  },
});

export const revokeStaff = mutation({
  args: { staffProfileId: v.id('staffProfiles') },
  handler: async (ctx, args): Promise<{ revoked: boolean }> => {
    const { profile } = await requireStaff(ctx);
    if (profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');

    const target = await ctx.db.get(args.staffProfileId);
    if (!target) throw new ConvexError('NOT_FOUND');

    if (target.role === 'owner' && target.active) {
      const allProfiles = await ctx.db.query('staffProfiles').collect();
      const activeOwners = allProfiles.filter((p) => p.role === 'owner' && p.active);
      if (activeOwners.length <= 1) throw new ConvexError('LAST_OWNER');
    }

    await ctx.db.patch(args.staffProfileId, { active: false });
    return { revoked: true };
  },
});

export const listStaff = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Array<{ staffProfileId: Id<'staffProfiles'>; name: string; email: string; role: string; active: boolean }>
  > => {
    await requireStaff(ctx);
    const profiles = await ctx.db.query('staffProfiles').collect();
    const result = [];
    for (const profile of profiles) {
      const user = await ctx.db.get(profile.userId);
      result.push({
        staffProfileId: profile._id,
        name: profile.name,
        email: user?.email ?? '(unknown)',
        role: profile.role,
        active: profile.active,
      });
    }
    return result;
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
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    // DEMO_MODE: the writable public demo lets anyone edit settings (nightly
    // reset restores the seed). Real deployments always require staff.
    if (process.env.DEMO_MODE !== 'true') {
      await requireStaff(ctx);
    }

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError('NOT_FOUND');

    const { patch } = args;

    if (patch.name !== undefined && patch.name.trim() === '') {
      throw new ConvexError('INVALID_NAME');
    }
    if (patch.currency !== undefined && !isSupportedCurrency(patch.currency)) {
      throw new ConvexError('INVALID_CURRENCY');
    }
    if (patch.taxRateBps !== undefined) {
      const rate = patch.taxRateBps;
      if (!Number.isInteger(rate) || rate < 0 || rate > 3000) {
        throw new ConvexError('INVALID_TAXRATEBPS');
      }
    }
    const timeShape = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (patch.checkInTime !== undefined && !timeShape.test(patch.checkInTime)) {
      throw new ConvexError('INVALID_CHECKINTIME');
    }
    if (patch.checkOutTime !== undefined && !timeShape.test(patch.checkOutTime)) {
      throw new ConvexError('INVALID_CHECKOUTTIME');
    }

    const fields: Partial<Doc<'properties'>> = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.email !== undefined) fields.email = patch.email;
    if (patch.phone !== undefined) fields.phone = patch.phone;
    if (patch.address !== undefined) fields.address = patch.address;
    if (patch.currency !== undefined) fields.currency = patch.currency;
    if (patch.taxRateBps !== undefined) fields.taxRateBps = patch.taxRateBps;
    if (patch.taxLabel !== undefined) fields.taxLabel = patch.taxLabel;
    if (patch.gstNumber !== undefined) fields.gstNumber = patch.gstNumber;
    if (patch.checkInTime !== undefined) fields.checkInTime = patch.checkInTime;
    if (patch.checkOutTime !== undefined) fields.checkOutTime = patch.checkOutTime;

    await ctx.db.patch(args.propertyId, fields);
    return { updated: true };
  },
});
