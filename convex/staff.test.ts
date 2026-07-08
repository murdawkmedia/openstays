/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

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
});
