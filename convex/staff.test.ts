/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { writeAudit } from './staff';

afterEach(() => {
  vi.unstubAllEnvs();
});

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

/**
 * Convex Auth identity subject format: `getAuthUserId` (convex/staff.ts,
 * @convex-dev/auth/server) splits `identity.subject` on '|' and takes the
 * first segment as the users row id — the second segment is meant to be a
 * session id, but requireStaff/me never validate it, so any string works in
 * tests. `t.withIdentity({ subject: `${userId}|test-session` })` is enough
 * to authenticate as a given seeded `users` row without going through the
 * real Password sign-in flow.
 */
function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|test-session` };
}

async function seedUser(t: ReturnType<typeof convexTest>, email: string, name = 'Test User') {
  return await t.run(async (ctx) => ctx.db.insert('users', { email, name }));
}

async function seedProperty(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: 'America/Edmonton',
      currency: 'CAD',
      taxRateBps: 500,
      email: 't@example.com',
      phone: '555',
      address: '1 Test Rd',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
    }),
  );
}

async function seedOwner(t: ReturnType<typeof convexTest>, email = 'owner@example.com') {
  const userId = await seedUser(t, email, 'Owner');
  await t.run(async (ctx) =>
    ctx.db.insert('staffProfiles', {
      userId,
      name: 'Owner',
      role: 'owner',
      active: true,
      createdAt: Date.now(),
    }),
  );
  return userId;
}

describe('staff.me', () => {
  it('is null when unauthenticated', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.staff.me, {});
    expect(result).toBeNull();
  });

  it('is null when the signed-in user has no staff profile', async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, 'nobody@example.com');
    const asUser = t.withIdentity(identityFor(userId));
    const result = await asUser.query(api.staff.me, {});
    expect(result).toBeNull();
  });

  it('returns name+role for an active staff profile', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const asOwner = t.withIdentity(identityFor(ownerId));
    const result = await asOwner.query(api.staff.me, {});
    expect(result).toEqual({ name: 'Owner', role: 'owner' });
  });
});

describe('staff.grantStaff', () => {
  it('is owner-only: a non-owner staff member is refused', async () => {
    const t = convexTest(schema, modules);
    const staffUserId = await seedUser(t, 'staffer@example.com');
    await t.run(async (ctx) =>
      ctx.db.insert('staffProfiles', {
        userId: staffUserId,
        name: 'Staffer',
        role: 'staff',
        active: true,
        createdAt: Date.now(),
      }),
    );
    await seedUser(t, 'newbie@example.com');

    const asStaff = t.withIdentity(identityFor(staffUserId));
    await expect(
      asStaff.mutation(api.staff.grantStaff, { email: 'newbie@example.com', name: 'Newbie', role: 'staff' }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });

  it('throws USER_NOT_FOUND_SIGN_UP_FIRST for an unknown email', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const asOwner = t.withIdentity(identityFor(ownerId));
    await expect(
      asOwner.mutation(api.staff.grantStaff, {
        email: 'ghost@example.com',
        name: 'Ghost',
        role: 'staff',
      }),
    ).rejects.toThrow(/USER_NOT_FOUND_SIGN_UP_FIRST/);
  });

  it('grants access, and the grant shows up in listStaff', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    await seedUser(t, 'newbie@example.com', 'Newbie');

    const asOwner = t.withIdentity(identityFor(ownerId));
    const result = await asOwner.mutation(api.staff.grantStaff, {
      email: 'newbie@example.com',
      name: 'Newbie',
      role: 'staff',
    });
    expect(result).toEqual({ granted: true });

    const list = await asOwner.query(api.staff.listStaff, {});
    const entry = list.find((s) => s.email === 'newbie@example.com');
    expect(entry).toBeDefined();
    expect(entry?.role).toBe('staff');
    expect(entry?.active).toBe(true);
  });
});

describe('staff.revokeStaff', () => {
  it('refuses to revoke the last active owner', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const list = await asOwner.query(api.staff.listStaff, {});
    const ownerProfile = list.find((s) => s.role === 'owner');
    expect(ownerProfile).toBeDefined();

    await expect(
      asOwner.mutation(api.staff.revokeStaff, { staffProfileId: ownerProfile!.staffProfileId }),
    ).rejects.toThrow(/LAST_OWNER/);
  });

  it('allows revoking a second owner, leaving one active', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t, 'owner1@example.com');
    const secondOwnerUserId = await seedUser(t, 'owner2@example.com', 'Owner Two');
    const asOwner = t.withIdentity(identityFor(ownerId));
    await asOwner.mutation(api.staff.grantStaff, {
      email: 'owner2@example.com',
      name: 'Owner Two',
      role: 'owner',
    });

    const list = await asOwner.query(api.staff.listStaff, {});
    const secondOwnerProfile = list.find((s) => s.email === 'owner2@example.com');
    expect(secondOwnerProfile).toBeDefined();

    const result = await asOwner.mutation(api.staff.revokeStaff, {
      staffProfileId: secondOwnerProfile!.staffProfileId,
    });
    expect(result).toEqual({ revoked: true });

    const asSecondOwner = t.withIdentity(identityFor(secondOwnerUserId));
    const me = await asSecondOwner.query(api.staff.me, {});
    expect(me).toBeNull();
  });
});

describe('staff.updateProperty', () => {
  it('rejects an unsupported currency', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await expect(
      asOwner.mutation(api.staff.updateProperty, {
        propertyId,
        patch: { currency: 'XYZ' },
      }),
    ).rejects.toThrow(/INVALID_CURRENCY/);
  });

  it('rejects an out-of-range taxRateBps', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await expect(
      asOwner.mutation(api.staff.updateProperty, {
        propertyId,
        patch: { taxRateBps: 5000 },
      }),
    ).rejects.toThrow(/INVALID_TAXRATEBPS/);
  });

  it('applies a valid patch', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.mutation(api.staff.updateProperty, {
      propertyId,
      patch: { name: 'Renamed Grounds', currency: 'USD', taxRateBps: 700, checkInTime: '15:00' },
    });
    expect(result).toEqual({ updated: true });

    const updated = await t.run(async (ctx) => ctx.db.get(propertyId));
    expect(updated?.name).toBe('Renamed Grounds');
    expect(updated?.currency).toBe('USD');
    expect(updated?.taxRateBps).toBe(700);
    expect(updated?.checkInTime).toBe('15:00');
  });

  it('requires staff (unauthenticated is refused)', async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await expect(
      t.mutation(api.staff.updateProperty, { propertyId, patch: { name: 'Nope' } }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe('staff.bootstrap', () => {
  it('refuses when an owner already exists', async () => {
    const t = convexTest(schema, modules);
    await seedOwner(t);
    await seedUser(t, 'second@example.com', 'Second');

    await expect(
      t.mutation(internal.staff.bootstrap, { email: 'second@example.com', name: 'Second' }),
    ).rejects.toThrow(/OWNER_EXISTS/);
  });

  it('grants owner to a signed-up user when no owner exists yet', async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, 'first@example.com', 'First');

    const result = await t.mutation(internal.staff.bootstrap, {
      email: 'first@example.com',
      name: 'First',
    });
    expect(result).toEqual({ granted: true });

    const asUser = t.withIdentity(identityFor(userId));
    const me = await asUser.query(api.staff.me, {});
    expect(me).toEqual({ name: 'First', role: 'owner' });
  });

  it('writes a staff.bootstrap audit row', async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, 'first@example.com', 'First');
    await t.mutation(internal.staff.bootstrap, { email: 'first@example.com', name: 'First' });

    const rows = await t.run(async (ctx) => ctx.db.query('auditLog').collect());
    const bootstrapRow = rows.find((r) => r.action === 'staff.bootstrap');
    expect(bootstrapRow).toBeDefined();
    // bootstrap is an internal mutation with no signed-in identity → 'system'.
    expect(bootstrapRow?.actorName).toBe('system');
  });
});

describe('writeAudit actor resolution', () => {
  it('resolves a signed-in staff member to their profile name + userId', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t, 'owner@example.com');
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.run(async (ctx) => {
      await writeAudit(ctx, 'test.action', 'a detail');
    });

    const row = await t.run(async (ctx) => (await ctx.db.query('auditLog').collect())[0]);
    expect(row.actorName).toBe('Owner');
    expect(row.actorUserId).toBe(ownerId);
    expect(row.action).toBe('test.action');
    expect(row.detail).toBe('a detail');
    expect(typeof row.ts).toBe('number');
  });

  it('resolves an unauthenticated caller to "system" (no actorUserId)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await writeAudit(ctx, 'sys.action', 'system detail');
    });

    const row = await t.run(async (ctx) => (await ctx.db.query('auditLog').collect())[0]);
    expect(row.actorName).toBe('system');
    expect(row.actorUserId).toBeUndefined();
  });

  it('resolves an unauthenticated caller to "demo" under DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await writeAudit(ctx, 'demo.action', 'demo detail');
    });

    const row = await t.run(async (ctx) => (await ctx.db.query('auditLog').collect())[0]);
    expect(row.actorName).toBe('demo');
    expect(row.actorUserId).toBeUndefined();
  });
});

describe('audit rows on staff mutations', () => {
  it('updateProperty writes a property.update row listing changed field names, not values', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.staff.updateProperty, {
      propertyId,
      patch: { name: 'Renamed', gstNumber: '123456789RT0001', taxLabel: 'VAT' },
    });

    const row = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'property.update'),
    );
    expect(row).toBeDefined();
    expect(row?.actorName).toBe('Owner');
    // Field NAMES are listed…
    expect(row?.detail).toContain('name');
    expect(row?.detail).toContain('gstNumber');
    expect(row?.detail).toContain('taxLabel');
    // …but the sensitive gstNumber VALUE is never in the trail.
    expect(row?.detail).not.toContain('123456789RT0001');
  });

  it('grantStaff writes a staff.grant row and revokeStaff writes a staff.revoke row', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    await seedUser(t, 'newbie@example.com', 'Newbie');
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.mutation(api.staff.grantStaff, {
      email: 'newbie@example.com',
      name: 'Newbie',
      role: 'staff',
    });

    const grantRow = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'staff.grant'),
    );
    expect(grantRow).toBeDefined();
    expect(grantRow?.detail).toContain('newbie@example.com');
    expect(grantRow?.detail).toContain('staff');

    const list = await asOwner.query(api.staff.listStaff, {});
    const target = list.find((s) => s.email === 'newbie@example.com');
    await asOwner.mutation(api.staff.revokeStaff, { staffProfileId: target!.staffProfileId });

    const revokeRow = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'staff.revoke'),
    );
    expect(revokeRow).toBeDefined();
    expect(revokeRow?.detail).toContain('Newbie');
  });
});

describe('staff.recentActivity', () => {
  it('returns rows newest-first, capped, staff-shaped', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    await t.run(async (ctx) => {
      await ctx.db.insert('auditLog', { actorName: 'A', action: 'x', detail: 'first', ts: 1 });
      await ctx.db.insert('auditLog', { actorName: 'B', action: 'y', detail: 'second', ts: 2 });
      await ctx.db.insert('auditLog', { actorName: 'C', action: 'z', detail: 'third', ts: 3 });
    });

    const rows = await asOwner.query(api.staff.recentActivity, {});
    expect(rows.map((r) => r.detail)).toEqual(['third', 'second', 'first']);
    // shape: only the four public fields, no actorUserId leak.
    expect(Object.keys(rows[0]).sort()).toEqual(['action', 'actorName', 'detail', 'ts']);

    const limited = await asOwner.query(api.staff.recentActivity, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].detail).toBe('third');
  });

  it('is readable by any active staff member (not owner-only)', async () => {
    const t = convexTest(schema, modules);
    const staffUserId = await seedUser(t, 'staffer@example.com', 'Staffer');
    await t.run(async (ctx) =>
      ctx.db.insert('staffProfiles', {
        userId: staffUserId,
        name: 'Staffer',
        role: 'staff',
        active: true,
        createdAt: Date.now(),
      }),
    );
    const asStaff = t.withIdentity(identityFor(staffUserId));
    const rows = await asStaff.query(api.staff.recentActivity, {});
    expect(rows).toEqual([]);
  });

  it('rejects an unauthenticated (non-demo) caller', async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.staff.recentActivity, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('is exempt from auth under DEMO_MODE', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert('auditLog', { actorName: 'demo', action: 'x', detail: 'd', ts: 1 }),
    );
    const rows = await t.query(api.staff.recentActivity, {});
    expect(rows).toHaveLength(1);
  });
});

describe('per-property operational access', () => {
  it('maps legacy profiles safely before assignment backfill', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    const asOwner = t.withIdentity(identityFor(ownerId));

    const context = await asOwner.query((api as any).staff.propertyContext, { propertyId });

    expect(context.role).toBe('owner');
    expect(context.capabilities).toContain('staff.manage');
  });

  it('uses explicit assignments and denies unassigned properties once scoped access exists', async () => {
    const t = convexTest(schema, modules);
    const staffUserId = await seedUser(t, 'manager@example.com', 'Manager');
    const profileId = await t.run(async (ctx) =>
      ctx.db.insert('staffProfiles', {
        userId: staffUserId,
        name: 'Manager',
        role: 'staff',
        active: true,
        createdAt: Date.now(),
      }),
    );
    const propertyId = await seedProperty(t);
    const secondPropertyId = await t.run(async (ctx) =>
      ctx.db.insert('properties', {
        name: 'Second Grounds',
        slug: 'second-grounds',
        timezone: 'America/Edmonton',
        currency: 'CAD',
        taxRateBps: 500,
        email: 'second@example.com',
        phone: '555',
        address: '2 Test Rd',
        checkInTime: '16:00',
        checkOutTime: '11:00',
        active: true,
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert('staffPropertyAssignments' as any, {
        staffProfileId: profileId,
        userId: staffUserId,
        propertyId,
        role: 'manager',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const asManager = t.withIdentity(identityFor(staffUserId));

    const context = await asManager.query((api as any).staff.propertyContext, { propertyId });
    expect(context.role).toBe('manager');
    expect(context.capabilities).toContain('complimentary.approve');
    expect(context.capabilities).not.toContain('staff.manage');

    await expect(
      asManager.query((api as any).staff.propertyContext, { propertyId: secondPropertyId }),
    ).rejects.toThrow(/PROPERTY_ACCESS_DENIED/);
  });

  it('backfills every active legacy profile across active properties exactly once', async () => {
    const t = convexTest(schema, modules);
    await seedOwner(t);
    const staffUserId = await seedUser(t, 'frontdesk@example.com', 'Front Desk');
    await t.run(async (ctx) =>
      ctx.db.insert('staffProfiles', {
        userId: staffUserId,
        name: 'Front Desk',
        role: 'staff',
        active: true,
        createdAt: Date.now(),
      }),
    );
    await seedProperty(t);
    await t.run(async (ctx) =>
      ctx.db.insert('properties', {
        name: 'Inactive Grounds',
        slug: 'inactive-grounds',
        timezone: 'America/Edmonton',
        currency: 'CAD',
        taxRateBps: 500,
        email: 'inactive@example.com',
        phone: '555',
        address: '3 Test Rd',
        checkInTime: '16:00',
        checkOutTime: '11:00',
        active: false,
      }),
    );

    const first = await t.mutation((internal as any).staff.backfillPropertyAssignments, {});
    const second = await t.mutation((internal as any).staff.backfillPropertyAssignments, {});
    const assignments = await t.run(async (ctx) =>
      ctx.db.query('staffPropertyAssignments' as any).collect(),
    );

    expect(first).toEqual({ inserted: 2, existing: 0 });
    expect(second).toEqual({ inserted: 0, existing: 2 });
    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment: any) => assignment.role).sort()).toEqual(['front_desk', 'owner']);
  });

  it('lists only explicitly assigned properties once scoped access exists', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const firstPropertyId = await seedProperty(t);
    const secondPropertyId = await t.run(async (ctx) =>
      ctx.db.insert('properties', {
        name: 'Second Grounds',
        slug: 'second-grounds',
        timezone: 'America/Edmonton',
        currency: 'CAD',
        taxRateBps: 500,
        email: 'second@example.com',
        phone: '555',
        address: '2 Test Rd',
        checkInTime: '16:00',
        checkOutTime: '11:00',
        active: true,
      }),
    );
    const profileId = await t.run(async (ctx) =>
      (await ctx.db
        .query('staffProfiles')
        .withIndex('by_userId', (q) => q.eq('userId', ownerId))
        .unique())!._id,
    );
    await t.run(async (ctx) =>
      ctx.db.insert('staffPropertyAssignments', {
        staffProfileId: profileId,
        userId: ownerId,
        propertyId: secondPropertyId,
        role: 'manager',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const rows = await t.withIdentity(identityFor(ownerId)).query((api as any).staff.assignedProperties, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      propertyId: secondPropertyId,
      role: 'manager',
      timezone: 'America/Edmonton',
    });
    expect(rows[0].propertyId).not.toBe(firstPropertyId);
  });

  it('returns only active property assignees without contact fields', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedOwner(t);
    const propertyId = await seedProperty(t);
    await t.mutation((internal as any).staff.backfillPropertyAssignments, {});

    const rows = await t.withIdentity(identityFor(ownerId)).query(
      (api as any).staff.propertyAssignees,
      { propertyId },
    );

    expect(rows).toEqual([
      expect.objectContaining({ name: 'Owner', role: 'owner' }),
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/email|userId/i);
  });
});
