import { ConvexError, v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { isSupportedCurrency } from '../shared/currency';
import {
  capabilitiesForRole,
  roleCan,
  type OperationalCapability,
  type OperationalRole,
} from '../shared/operations';

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

function legacyOperationalRole(profile: Doc<'staffProfiles'>): OperationalRole {
  return profile.role === 'owner' ? 'owner' : 'front_desk';
}

/**
 * Property-scoped authorization chokepoint for command-center operations.
 *
 * The temporary legacy fallback keeps existing deployments readable while the
 * idempotent backfill runs. As soon as a profile has one scoped assignment,
 * every property must be granted explicitly.
 */
export async function requirePropertyCapability(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<'properties'>,
  capability: OperationalCapability,
): Promise<{
  userId: Id<'users'>;
  profile: Doc<'staffProfiles'>;
  property: Doc<'properties'>;
  role: OperationalRole;
}> {
  const { userId, profile } = await requireStaff(ctx);
  return await resolvePropertyCapability(ctx, userId, profile, propertyId, capability);
}

async function resolvePropertyCapability(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  profile: Doc<'staffProfiles'>,
  propertyId: Id<'properties'>,
  capability: OperationalCapability,
): Promise<{
  userId: Id<'users'>;
  profile: Doc<'staffProfiles'>;
  property: Doc<'properties'>;
  role: OperationalRole;
}> {
  const property = await ctx.db.get(propertyId);
  if (!property || !property.active) throw new ConvexError('PROPERTY_ACCESS_DENIED');

  const assignments = await ctx.db
    .query('staffPropertyAssignments')
    .withIndex('by_profile', (q) => q.eq('staffProfileId', profile._id))
    .collect();
  const explicit = assignments.find(
    (assignment) => assignment.propertyId === propertyId && assignment.active,
  );
  if (assignments.length > 0 && !explicit) throw new ConvexError('PROPERTY_ACCESS_DENIED');

  const role = explicit?.role ?? legacyOperationalRole(profile);
  if (!roleCan(role, capability)) throw new ConvexError('CAPABILITY_DENIED');
  return { userId, profile, property, role };
}

/**
 * API-key automation authorization. A write key acts only with the active
 * property role of the owner who minted it; it never becomes a deployment-
 * wide superuser merely because its scope is "write".
 */
export async function requireAutomationPropertyCapability(
  ctx: QueryCtx | MutationCtx,
  actorUserId: Id<'users'>,
  propertyId: Id<'properties'>,
  capability: OperationalCapability,
) {
  const profile = await ctx.db
    .query('staffProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', actorUserId))
    .unique();
  if (!profile?.active) throw new ConvexError('AUTOMATION_ACTOR_INACTIVE');
  return await resolvePropertyCapability(ctx, actorUserId, profile, propertyId, capability);
}

export async function requireMutationPropertyCapability(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  capability: OperationalCapability,
  action: string,
  automationToken?: string,
) {
  if (!automationToken) return await requirePropertyCapability(ctx, propertyId, capability);
  const claim = await ctx.db
    .query('automationClaims')
    .withIndex('by_token', (q) => q.eq('token', automationToken))
    .unique();
  if (!claim || claim.propertyId !== propertyId || claim.action !== action || claim.expiresAt <= Date.now()) {
    throw new ConvexError('AUTOMATION_CLAIM_INVALID');
  }
  const access = await requireAutomationPropertyCapability(ctx, claim.actorUserId, propertyId, capability);
  const key = await ctx.db.get(claim.apiKeyId);
  await ctx.db.insert('auditLog', {
    actorUserId: access.userId,
    actorName: access.profile.name,
    propertyId,
    action: 'automation.authorize',
    detail: `authorized ${action} via API key ${key?.prefix ?? 'unknown'}`,
    entityType: 'api_key',
    entityId: claim.apiKeyId,
    metadataJson: JSON.stringify({ source: 'api_v1', action, apiKeyId: claim.apiKeyId }),
    ts: Date.now(),
  });
  await ctx.db.delete(claim._id);
  return access;
}

export async function requirePropertyFeature(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<'properties'>,
  feature: string,
): Promise<void> {
  const row = await ctx.db
    .query('propertyFeatures')
    .withIndex('by_property_feature', (q) =>
      q.eq('propertyId', propertyId).eq('feature', feature),
    )
    .unique();
  if (!row?.enabled) throw new ConvexError(`FEATURE_DISABLED:${feature}`);
}

export const propertyContext = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    const access = await requirePropertyCapability(ctx, args.propertyId, 'property.read');
    return {
      propertyId: access.property._id,
      propertyName: access.property.name,
      role: access.role,
      capabilities: capabilitiesForRole(access.role),
    };
  },
});

export const assignedProperties = query({
  args: {},
  handler: async (ctx) => {
    const { profile } = await requireStaff(ctx);
    const assignments = await ctx.db
      .query('staffPropertyAssignments')
      .withIndex('by_profile', (q) => q.eq('staffProfileId', profile._id))
      .collect();

    if (assignments.length === 0) {
      const role = legacyOperationalRole(profile);
      const properties = (await ctx.db.query('properties').collect()).filter((property) => property.active);
      return properties.map((property) => ({
        propertyId: property._id,
        name: property.name,
        slug: property.slug,
        role,
        capabilities: capabilitiesForRole(role),
      }));
    }

    const result = [];
    for (const assignment of assignments.filter((row) => row.active)) {
      const property = await ctx.db.get(assignment.propertyId);
      if (!property?.active) continue;
      result.push({
        propertyId: property._id,
        name: property.name,
        slug: property.slug,
        role: assignment.role,
        capabilities: capabilitiesForRole(assignment.role),
      });
    }
    return result;
  },
});

/** Idempotent migration from the legacy global owner/staff roles. */
export const backfillPropertyAssignments = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; existing: number }> => {
    const profiles = (await ctx.db.query('staffProfiles').collect()).filter((profile) => profile.active);
    const properties = (await ctx.db.query('properties').collect()).filter((property) => property.active);
    let inserted = 0;
    let existing = 0;
    const now = Date.now();

    for (const profile of profiles) {
      for (const property of properties) {
        const assignment = await ctx.db
          .query('staffPropertyAssignments')
          .withIndex('by_profile_property', (q) =>
            q.eq('staffProfileId', profile._id).eq('propertyId', property._id),
          )
          .unique();
        if (assignment) {
          existing += 1;
          continue;
        }
        await ctx.db.insert('staffPropertyAssignments', {
          staffProfileId: profile._id,
          userId: profile.userId,
          propertyId: property._id,
          role: legacyOperationalRole(profile),
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        inserted += 1;
      }
    }
    return { inserted, existing };
  },
});

// ---------------------------------------------------------------------------
// Who-did-what audit trail. writeAudit appends one auditLog row per staff
// action (property config, staff grants, API keys, channel config). Append-
// only; surfaced in /admin/settings via recentActivity.
//
// Actor resolution: getAuthUserId → staffProfile name → {actorUserId,
// actorName}. Unauthenticated under DEMO_MODE → 'demo' (the writable public
// demo has no real identity). Unauthenticated otherwise → 'system' (internal
// mutations / cron have no user). `detail` MUST stay human-readable and SHORT
// and NEVER contain secrets or tokens (only field NAMES, never gstNumber
// values, never key hashes).
// ---------------------------------------------------------------------------

export async function writeAudit(ctx: MutationCtx, action: string, detail: string): Promise<void> {
  const userId = await getAuthUserId(ctx);
  let actorUserId: Id<'users'> | undefined;
  let actorName: string;
  if (userId !== null) {
    const profile = await ctx.db
      .query('staffProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    actorUserId = userId;
    actorName = profile?.name ?? 'unknown';
  } else if (process.env.DEMO_MODE === 'true') {
    actorName = 'demo';
  } else {
    actorName = 'system';
  }
  await ctx.db.insert('auditLog', {
    actorUserId,
    actorName,
    action,
    detail,
    ts: Date.now(),
  });
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
    await writeAudit(ctx, 'staff.bootstrap', `bootstrapped owner ${args.name}`);
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
    await writeAudit(ctx, 'staff.grant', `granted staff to ${args.email} (${args.role})`);
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
    await writeAudit(ctx, 'staff.revoke', `revoked staff from ${target.name} (${target.role})`);
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
 * Recent staff/admin activity (the audit trail) for the /admin/settings
 * "Sign-in & activity" section. Any active staff may read it; DEMO_MODE is
 * exempt from the auth check (same carve-out as the rest of the settings
 * surface — the writable public demo has no real identity). Newest-first,
 * default 30 rows, capped at 100. Never returns actorUserId or secrets — only
 * the human-readable {actorName, action, detail, ts}.
 */
export const recentActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ actorName: string; action: string; detail: string; ts: number }>> => {
    if (process.env.DEMO_MODE !== 'true') {
      await requireStaff(ctx);
    }
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    const rows = await ctx.db.query('auditLog').withIndex('by_ts').order('desc').take(limit);
    return rows.map((row) => ({
      actorName: row.actorName,
      action: row.action,
      detail: row.detail,
      ts: row.ts,
    }));
  },
});

/**
 * Full property config for the admin /settings page. Staff-gated (or DEMO_MODE,
 * same rationale as staff.me / updateProperty: the writable public demo has no
 * real auth and resets nightly). Returns the sensitive fields the public
 * properties.configList deliberately drops — gstNumber, taxRateBps, timezone.
 */
export const forSettings = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Array<{
      propertyId: Id<'properties'>;
      name: string;
      slug: string;
      active: boolean;
      timezone: string;
      currency: string;
      taxRateBps: number;
      taxLabel?: string;
      gstNumber?: string;
      email: string;
      phone: string;
      address: string;
      checkInTime: string;
      checkOutTime: string;
    }>
  > => {
    if (process.env.DEMO_MODE !== 'true') {
      await requireStaff(ctx);
    }
    const properties = await ctx.db.query('properties').collect();
    return properties.map((p) => ({
      propertyId: p._id,
      name: p.name,
      slug: p.slug,
      active: p.active,
      timezone: p.timezone,
      currency: p.currency,
      taxRateBps: p.taxRateBps,
      taxLabel: p.taxLabel,
      gstNumber: p.gstNumber,
      email: p.email,
      phone: p.phone,
      address: p.address,
      checkInTime: p.checkInTime,
      checkOutTime: p.checkOutTime,
    }));
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

    // Audit detail lists the CHANGED FIELD NAMES only — never old/new values
    // (gstNumber is sensitive; keep the trail free of any field values).
    const changedFields = Object.keys(fields);
    const summary =
      changedFields.length > 0 ? changedFields.join(', ') : 'no fields';
    await writeAudit(ctx, 'property.update', `updated ${property.name}: ${summary}`);
    return { updated: true };
  },
});
