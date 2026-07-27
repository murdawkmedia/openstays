import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OPERATIONS_HEARTBEAT_INTERVAL_MS,
  buildOperationsHeartbeat,
  publishOperationsHeartbeat,
  runOperationsHeartbeat,
} from './operationsHeartbeat.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('operations heartbeat', () => {
  it('publishes immediately and every 15 seconds', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const controller = new AbortController();
    const running = runOperationsHeartbeat({
      openStaysUrl: 'https://example.test/',
      heartbeatToken: 'heartbeat-secret',
      service: 'mail',
      release: 'test-release',
      signal: controller.signal,
      fetchFn,
      snapshot: async () => ({ status: 'ready' }),
    });

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(OPERATIONS_HEARTBEAT_INTERVAL_MS);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    controller.abort();
    await running;

    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/operations-bridge/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer heartbeat-secret' }),
      }),
    );
  });

  it('only permits Wavelength to publish a non-negative integer balance', () => {
    expect(buildOperationsHeartbeat({
      service: 'wavelength',
      release: 'v0.1.0',
      observedAt: 123,
      snapshot: { status: 'ready', spendableSats: 12_000 },
    })).toEqual({
      service: 'wavelength',
      status: 'ready',
      release: 'v0.1.0',
      observedAt: 123,
      spendableSats: 12_000,
    });
    expect(() => buildOperationsHeartbeat({
      service: 'mail',
      release: 'v0.1.0',
      observedAt: 123,
      snapshot: { status: 'ready', spendableSats: 1 },
    })).toThrow('HEARTBEAT_BALANCE_SERVICE_MISMATCH');
  });

  it('sends only the allowlisted heartbeat fields', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        service: 'ots',
        status: 'degraded',
        release: 'release-1',
        observedAt: 456,
        failureCategory: 'dependency_unavailable',
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('lnsb');
      expect(serialized).not.toContain('guest@example');
      expect(serialized).not.toContain('smtp');
      expect(serialized).not.toContain('C:\\');
      expect(serialized).not.toContain('payment_hash');
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await publishOperationsHeartbeat({
      openStaysUrl: 'https://example.test',
      heartbeatToken: 'not-in-body',
      fetchFn,
    }, buildOperationsHeartbeat({
      service: 'ots',
      release: 'release-1',
      observedAt: 456,
      snapshot: {
        status: 'degraded',
        failureCategory: 'dependency_unavailable',
        // Runtime objects can contain sensitive operational context. The
        // builder deliberately serializes only its narrow contract.
        bolt11: 'lnsb-secret',
        email: 'guest@example.test',
        smtpHost: 'smtp.example.test',
        localPath: 'C:\\wallet',
        paymentHash: 'payment_hash',
      } as never,
    }));
  });
});
