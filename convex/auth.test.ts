/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/**
 * OAuth providers are ENV-GATED and the gating (`oauthConfigured`) is computed
 * ONCE at auth.ts module-load from process.env. So env-gating is verified by
 * stubbing the env, resetting the module registry, and re-importing auth.ts —
 * `oauthConfigured` then reflects the stubbed env. `availableAuthMethods`
 * returns those same flags.
 */

async function loadAuthFresh() {
  vi.resetModules();
  return await import('./auth');
}

describe('auth.oauthConfigured (env gating at module load)', () => {
  it('is all-false when no OAuth env vars are set', async () => {
    const mod = await loadAuthFresh();
    expect(mod.oauthConfigured).toEqual({ github: false, google: false, microsoft: false });
  });

  it('github is true ONLY when BOTH AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are set', async () => {
    // Only the ID → still false.
    vi.stubEnv('AUTH_GITHUB_ID', 'gh-id');
    let mod = await loadAuthFresh();
    expect(mod.oauthConfigured.github).toBe(false);

    // Both → true.
    vi.stubEnv('AUTH_GITHUB_SECRET', 'gh-secret');
    mod = await loadAuthFresh();
    expect(mod.oauthConfigured.github).toBe(true);
  });

  it('google and microsoft each require BOTH their id and secret', async () => {
    vi.stubEnv('AUTH_GOOGLE_ID', 'g-id');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'g-secret');
    // Microsoft: only the ID set → microsoft stays false.
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'ms-id');
    const mod = await loadAuthFresh();
    expect(mod.oauthConfigured.google).toBe(true);
    expect(mod.oauthConfigured.microsoft).toBe(false);
  });
});

describe('auth.availableAuthMethods', () => {
  it('reports password always-on and OAuth flags off with no env vars set', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.auth.availableAuthMethods, {});
    expect(result).toEqual({ password: true, github: false, google: false, microsoft: false });
  });
});

/**
 * The providers array is assembled at module load (import side-effect):
 * convexAuth() is called with the env-gated list. Verify the module imports
 * cleanly both with and without OAuth env vars — convexAuth() must not throw
 * when a provider is (or isn't) registered. (This caught that @auth/core's
 * MicrosoftEntraID throws if materialized with an undefined config — auth.ts
 * pushes MicrosoftEntraID({}) to avoid it.)
 */
describe('auth.ts module load (provider registration side-effects)', () => {
  it('loads without any OAuth env vars set', async () => {
    const mod = await loadAuthFresh();
    expect(mod.auth).toBeDefined();
    expect(mod.signIn).toBeDefined();
  });

  it('loads with all three OAuth providers enabled via env vars', async () => {
    vi.stubEnv('AUTH_GITHUB_ID', 'gh-id');
    vi.stubEnv('AUTH_GITHUB_SECRET', 'gh-secret');
    vi.stubEnv('AUTH_GOOGLE_ID', 'g-id');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'g-secret');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'ms-id');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'ms-secret');
    const mod = await loadAuthFresh();
    expect(mod.oauthConfigured).toEqual({ github: true, google: true, microsoft: true });
    expect(mod.auth).toBeDefined();
    expect(mod.signIn).toBeDefined();
  });
});
