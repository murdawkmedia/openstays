/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { sha256HexOf } from './apiKeys';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

/**
 * Convex Auth identity subject format (see staff.test.ts): getAuthUserId splits
 * identity.subject on '|' and takes the first segment as the users row id.
 */
function identityFor(userId: Id<'users'>) {
  return { subject: `${userId}|s` };
}

async function seedUser(t: ReturnType<typeof convexTest>, email: string, name = 'Test User') {
  return await t.run(async (ctx) => ctx.db.insert('users', { email, name }));
}

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  role: 'owner' | 'staff',
  email = `${role}@example.com`,
) {
  const userId = await seedUser(t, email, role);
  await t.run(async (ctx) =>
    ctx.db.insert('staffProfiles', {
      userId,
      name: role,
      role,
      active: true,
      createdAt: Date.now(),
    }),
  );
  return userId;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createApiKey', () => {
  it('is owner-only: an anonymous caller is rejected', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.apiKeys.createApiKey, { name: 'anon', scope: 'read' }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('is owner-only: a non-owner staff member is rejected', async () => {
    const t = convexTest(schema, modules);
    const staffId = await seedStaff(t, 'staff');
    const asStaff = t.withIdentity(identityFor(staffId));
    await expect(
      asStaff.action(api.apiKeys.createApiKey, { name: 'nope', scope: 'read' }),
    ).rejects.toThrow(/OWNER_ONLY/);
  });

  it('mints an osk_-prefixed token whose sha256 matches the stored row, hash never returned', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));

    const result = await asOwner.action(api.apiKeys.createApiKey, {
      name: 'NAS runner',
      scope: 'write',
    });
    // Format: 'osk_' + 48 lowercase hex; prefix = first 12 chars.
    expect(result.token).toMatch(/^osk_[0-9a-f]{48}$/);
    expect(result.prefix).toBe(result.token.slice(0, 12));
    expect(result.prefix).toMatch(/^osk_[0-9a-f]{8}$/);

    // The stored row holds the SHA-256 of the token, and NOT the token itself.
    const rows = await t.run(async (ctx) => ctx.db.query('apiKeys').collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.keyHash).toBe(await sha256HexOf(result.token));
    expect(row.keyHash).not.toBe(result.token);
    expect(row.scope).toBe('write');
    expect(row.active).toBe(true);
    expect(row.createdBy).toBe(ownerId);
  });

  it('stores read vs write scope as given', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.action(api.apiKeys.createApiKey, { name: 'reader', scope: 'read' });
    await asOwner.action(api.apiKeys.createApiKey, { name: 'writer', scope: 'write' });

    const scopes = await t.run(async (ctx) =>
      (await ctx.db.query('apiKeys').collect()).map((k) => k.scope).sort(),
    );
    expect(scopes).toEqual(['read', 'write']);
  });

  it('DEMO_MODE allows creation and tags createdBy "demo"', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    // No staff seeded, no identity — DEMO_MODE grants the synthetic path.
    const result = await t.action(api.apiKeys.createApiKey, { name: 'demo', scope: 'read' });
    expect(result.token).toMatch(/^osk_[0-9a-f]{48}$/);
    const row = await t.run(async (ctx) => (await ctx.db.query('apiKeys').collect())[0]);
    expect(row.createdBy).toBe('demo');
  });

  it('DEMO_MODE forces scope to read even when write is requested', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    // An anonymous demo visitor must never obtain a WRITE credential.
    await t.action(api.apiKeys.createApiKey, { name: 'demo-write-attempt', scope: 'write' });
    const row = await t.run(async (ctx) => (await ctx.db.query('apiKeys').collect())[0]);
    expect(row.scope).toBe('read');
  });
});

describe('demo.reset clears apiKeys', () => {
  it('a demo-minted key does not survive a nightly reset', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    const { token } = await t.action(api.apiKeys.createApiKey, { name: 'demo', scope: 'read' });
    const keyHash = await sha256HexOf(token);

    // Live before the reset.
    expect(await t.query(internal.apiKeys.verifyKey, { keyHash })).not.toBeNull();

    await t.mutation(internal.demo.reset, {});

    // The apiKeys table was wiped, so the key no longer verifies.
    expect(await t.query(internal.apiKeys.verifyKey, { keyHash })).toBeNull();
  });

  it('demo-created channelSync + channelSyncLog rows do not survive a nightly reset', async () => {
    // Under DEMO_MODE an anonymous visitor can create a channelSync row (the
    // admin gate() short-circuits before auth). Those rows — and any sync-log
    // noise — must be wiped by the nightly reset, not accumulate across resets.
    // (Adversarial review 2026-07-08.)
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', {
        name: 'Demo Grounds',
        slug: 'demo-grounds',
        timezone: 'America/Edmonton',
        currency: 'CAD',
        taxRateBps: 500,
        email: 'd@example.com',
        phone: '555',
        address: '1 Demo Rd',
        checkInTime: '16:00',
        checkOutTime: '11:00',
        active: true,
        channexPropertyId: 'attacker-supplied-uuid',
      });
      await ctx.db.insert('channelSync', {
        propertyId,
        provider: 'channex',
        enabled: true,
      });
      await ctx.db.insert('channelSyncLog', {
        propertyId,
        provider: 'channex',
        kind: 'ari_push',
        ok: true,
        detail: 'seeded log row',
        ts: Date.now(),
      });
    });

    await t.mutation(internal.demo.reset, {});

    const syncRows = await t.run(async (ctx) => ctx.db.query('channelSync').collect());
    const logRows = await t.run(async (ctx) => ctx.db.query('channelSyncLog').collect());
    expect(syncRows).toHaveLength(0);
    expect(logRows).toHaveLength(0);
  });
});

describe('listApiKeys', () => {
  it('is staff-gated and NEVER returns the keyHash', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));
    await asOwner.action(api.apiKeys.createApiKey, { name: 'k1', scope: 'read' });

    // Anonymous cannot list.
    await expect(t.query(api.apiKeys.listApiKeys, {})).rejects.toThrow(/UNAUTHENTICATED/);

    const list = await asOwner.query(api.apiKeys.listApiKeys, {});
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('k1');
    expect(list[0].prefix).toMatch(/^osk_[0-9a-f]{8}$/);
    // No keyHash on any listed entry.
    expect(Object.keys(list[0])).not.toContain('keyHash');
    for (const entry of list) {
      expect((entry as Record<string, unknown>).keyHash).toBeUndefined();
    }
  });

  it('an active non-owner staff member can list keys', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));
    await asOwner.action(api.apiKeys.createApiKey, { name: 'k1', scope: 'read' });

    const staffId = await seedStaff(t, 'staff');
    const asStaff = t.withIdentity(identityFor(staffId));
    const list = await asStaff.query(api.apiKeys.listApiKeys, {});
    expect(list).toHaveLength(1);
  });
});

describe('revokeApiKey', () => {
  it('is owner-only and soft-revokes so verifyKey returns null', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));

    const { token } = await asOwner.action(api.apiKeys.createApiKey, {
      name: 'to-revoke',
      scope: 'write',
    });
    const keyHash = await sha256HexOf(token);

    // Live key verifies.
    const before = await t.query(internal.apiKeys.verifyKey, { keyHash });
    expect(before?.scope).toBe('write');

    const apiKeyId = (await t.run(async (ctx) =>
      (await ctx.db.query('apiKeys').collect())[0]._id,
    )) as Id<'apiKeys'>;

    // A non-owner staff member cannot revoke.
    const staffId = await seedStaff(t, 'staff');
    const asStaff = t.withIdentity(identityFor(staffId));
    await expect(
      asStaff.mutation(api.apiKeys.revokeApiKey, { apiKeyId }),
    ).rejects.toThrow(/OWNER_ONLY/);

    const result = await asOwner.mutation(api.apiKeys.revokeApiKey, { apiKeyId });
    expect(result).toEqual({ revoked: true });

    // The row stays (audit trail) but active is false → verifyKey returns null.
    const row = await t.run(async (ctx) => ctx.db.get(apiKeyId));
    expect(row?.active).toBe(false);
    const after = await t.query(internal.apiKeys.verifyKey, { keyHash });
    expect(after).toBeNull();
  });
});

describe('verifyKey', () => {
  it('returns null for an unknown hash', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(internal.apiKeys.verifyKey, {
      keyHash: 'deadbeef'.repeat(8),
    });
    expect(result).toBeNull();
  });
});

describe('apiKey audit trail', () => {
  it('createApiKey writes an apiKey.create row (name + scope + prefix, never the token/hash)', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));

    const { token, prefix } = await asOwner.action(api.apiKeys.createApiKey, {
      name: 'NAS runner',
      scope: 'read',
    });

    const row = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'apiKey.create'),
    );
    expect(row).toBeDefined();
    expect(row?.actorName).toBe('owner');
    expect(row?.detail).toContain('NAS runner');
    expect(row?.detail).toContain('read');
    expect(row?.detail).toContain(prefix);
    // The raw token and its hash NEVER appear in the audit detail.
    expect(row?.detail).not.toContain(token);
    expect(row?.detail).not.toContain(await sha256HexOf(token));
  });

  it('revokeApiKey writes an apiKey.revoke row', async () => {
    const t = convexTest(schema, modules);
    const ownerId = await seedStaff(t, 'owner');
    const asOwner = t.withIdentity(identityFor(ownerId));

    await asOwner.action(api.apiKeys.createApiKey, { name: 'to-revoke', scope: 'write' });
    const apiKeyId = (await t.run(async (ctx) =>
      (await ctx.db.query('apiKeys').collect())[0]._id,
    )) as Id<'apiKeys'>;

    await asOwner.mutation(api.apiKeys.revokeApiKey, { apiKeyId });

    const row = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'apiKey.revoke'),
    );
    expect(row).toBeDefined();
    expect(row?.actorName).toBe('owner');
    expect(row?.detail).toContain('to-revoke');
  });

  it('a DEMO_MODE createApiKey tags the audit actor as "demo"', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const t = convexTest(schema, modules);
    await t.action(api.apiKeys.createApiKey, { name: 'demo', scope: 'read' });

    const row = await t.run(async (ctx) =>
      (await ctx.db.query('auditLog').collect()).find((r) => r.action === 'apiKey.create'),
    );
    expect(row?.actorName).toBe('demo');
  });
});
