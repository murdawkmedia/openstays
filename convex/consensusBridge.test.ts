/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

afterEach(() => vi.unstubAllEnvs());

describe('consensus bridge authentication', () => {
  it('protects the OpenTimestamps claim endpoint with its own token', async () => {
    vi.stubEnv('OTS_BRIDGE_TOKEN', 'ots-secret');
    const t = convexTest(schema, modules);
    expect((await t.fetch('/ots-bridge/pending')).status).toBe(401);
    expect((await t.fetch('/ots-bridge/pending', { headers: { Authorization: 'Bearer forged' } })).status).toBe(401);
    const response = await t.fetch('/ots-bridge/pending', { headers: { Authorization: 'Bearer ots-secret' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipts: [] });
  });

  it('protects reward payout claims with the Wavelength bridge token', async () => {
    vi.stubEnv('WAVELENGTH_BRIDGE_TOKEN', 'wave-secret');
    const t = convexTest(schema, modules);
    expect((await t.fetch('/wavelength-bridge/rewards/pending')).status).toBe(401);
    const response = await t.fetch('/wavelength-bridge/rewards/pending', {
      headers: { Authorization: 'Bearer wave-secret' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rewards: [] });
  });
});
