/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const heartbeat = {
  service: 'wavelength',
  status: 'ready',
  release: 'v0.1.0',
  observedAt: Date.UTC(2026, 6, 26, 12),
  spendableSats: 12_000,
};

describe('operations heartbeat HTTP endpoint', () => {
  it('enforces a different bearer token for every service', async () => {
    vi.stubEnv('WAVELENGTH_HEARTBEAT_TOKEN', 'wave-heartbeat');
    vi.stubEnv('OTS_HEARTBEAT_TOKEN', 'ots-heartbeat');
    const t = convexTest(schema, modules);

    const wrongService = await t.fetch('/operations-bridge/heartbeat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ots-heartbeat', 'Content-Type': 'application/json' },
      body: JSON.stringify(heartbeat),
    });
    const correct = await t.fetch('/operations-bridge/heartbeat', {
      method: 'POST',
      headers: { Authorization: 'Bearer wave-heartbeat', 'Content-Type': 'application/json' },
      body: JSON.stringify(heartbeat),
    });

    expect(wrongService.status).toBe(401);
    expect(correct.status).toBe(204);
  });

  it('rejects unknown fields and service-inappropriate balance fields', async () => {
    vi.stubEnv('MAIL_HEARTBEAT_TOKEN', 'mail-heartbeat');
    const t = convexTest(schema, modules);
    const headers = { Authorization: 'Bearer mail-heartbeat', 'Content-Type': 'application/json' };
    const unknown = await t.fetch('/operations-bridge/heartbeat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service: 'mail', status: 'ready', release: 'v1', observedAt: Date.now(),
        smtpPassword: 'must-never-land',
      }),
    });
    const balance = await t.fetch('/operations-bridge/heartbeat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service: 'mail', status: 'ready', release: 'v1', observedAt: Date.now(),
        spendableSats: 10,
      }),
    });
    expect(unknown.status).toBe(400);
    expect(balance.status).toBe(400);
  });

  it('makes Wavelength unavailable after 60 seconds without exposing details', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(heartbeat.observedAt);
    vi.stubEnv('WAVELENGTH_HEARTBEAT_TOKEN', 'wave-heartbeat');
    const t = convexTest(schema, modules);
    const response = await t.fetch('/operations-bridge/heartbeat', {
      method: 'POST',
      headers: { Authorization: 'Bearer wave-heartbeat', 'Content-Type': 'application/json' },
      body: JSON.stringify(heartbeat),
    });
    expect(response.status).toBe(204);
    await expect(t.query((api as any).operationsHealth.publicAvailability, {})).resolves.toEqual({
      wavelengthAvailable: true,
      rewardAvailable: true,
      updatedAt: heartbeat.observedAt,
    });

    vi.advanceTimersByTime(60_001);
    await expect(t.query((api as any).operationsHealth.publicAvailability, {})).resolves.toEqual({
      wavelengthAvailable: false,
      rewardAvailable: false,
      updatedAt: heartbeat.observedAt,
    });
  });
});
