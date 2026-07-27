import { describe, expect, it, vi } from 'vitest';

import worker, { type Env } from '../src/index';

const env: Env = {
  PUBLIC_ORIGIN: 'https://showcase.example',
  RELEASE: 'test',
  TURNSTILE_SECRET: 'turnstile-secret',
  ELIGIBILITY_HMAC_SECRET: 'eligibility-signing-key-with-at-least-32-bytes',
  OPERATIONS_ADMIN_TOKEN: 'operator-secret',
} as Env;

function eligibilityRequest(
  overrides: Record<string, unknown> = {},
  origin = env.PUBLIC_ORIGIN,
): Request {
  return new Request('https://edge.example/v1/eligibility', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin,
      'CF-Connecting-IP': '203.0.113.8',
    },
    body: JSON.stringify({
      action: 'zaprite_payment',
      bookingId: 'booking_1',
      normalizedEmail: 'guest@example.test',
      deviceId: 'c'.repeat(32),
      turnstileToken: 'challenge',
      ...overrides,
    }),
  });
}

describe('eligibility HTTP boundary', () => {
  it('returns CORS only to the configured origin', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: true })));
    const accepted = await worker.fetch(eligibilityRequest(), env, {
      waitUntil() {},
      passThroughOnException() {},
    }, fetcher);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('Access-Control-Allow-Origin'))
      .toBe(env.PUBLIC_ORIGIN);
    expect(await accepted.clone().text()).not.toContain('203.0.113.8');

    const rejected = await worker.fetch(
      eligibilityRequest({}, 'https://attacker.example'),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      fetcher,
    );
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('fails closed for missing or failed Turnstile', async () => {
    const failed = vi.fn(async () =>
      new Response(JSON.stringify({ success: false })));
    expect((await worker.fetch(
      eligibilityRequest({ turnstileToken: '' }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      failed,
    )).status).toBe(403);
    expect((await worker.fetch(
      eligibilityRequest(),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      failed,
    )).status).toBe(403);
  });

  it.each([
    { action: 'unsupported' },
    { bookingId: '../booking' },
    { normalizedEmail: 'Not-Normalized@Example.test' },
    { deviceId: 'short' },
  ])('rejects malformed input %#', async (override) => {
    const response = await worker.fetch(
      eligibilityRequest(override),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(response.status).toBe(400);
  });

  it('rejects bodies at or above 8 KiB', async () => {
    const response = await worker.fetch(
      eligibilityRequest({ padding: 'x'.repeat(8_192) }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(response.status).toBe(413);
  });

  it('returns redacted health and protects operator diagnostics', async () => {
    const health = await worker.fetch(
      new Request('https://edge.example/healthz'),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(await health.json()).toEqual({
      release: 'test',
      status: 'starting',
    });
    const denied = await worker.fetch(
      new Request('https://edge.example/v1/operator/diagnostics'),
      env,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(denied.status).toBe(401);
  });

  it('protects the single-use merchant wallet bootstrap route', async () => {
    const bootstrapWallet = vi.fn(async () => ({
      mnemonic: Array.from({ length: 24 }, (_, index) => `word${index}`),
    }));
    const operations = {
      getByName: vi.fn(() => ({ bootstrapWallet })),
    };
    const withOperations = {
      ...env,
      MERCHANT_OPERATIONS: operations,
    } as unknown as Env;
    const denied = await worker.fetch(
      new Request('https://edge.example/v1/operator/bootstrap-wallet', {
        method: 'POST',
      }),
      withOperations,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(denied.status).toBe(401);
    expect(bootstrapWallet).not.toHaveBeenCalled();

    const accepted = await worker.fetch(
      new Request('https://edge.example/v1/operator/bootstrap-wallet', {
        method: 'POST',
        headers: { Authorization: 'Bearer operator-secret' },
      }),
      withOperations,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(accepted.status).toBe(201);
    expect((await accepted.json() as { mnemonic: string[] }).mnemonic)
      .toHaveLength(24);
    expect(bootstrapWallet).toHaveBeenCalledOnce();
  });

  it('wakes the merchant supervisor and publishes only redacted backup health', async () => {
    const ensureReady = vi.fn(async () => ({ status: 'ready' as const }));
    const operations = {
      getByName: vi.fn(() => ({ ensureReady })),
    };
    const withOperations = {
      ...env,
      OPENSTAYS_URL: 'https://backend.example',
      BACKUP_HEARTBEAT_TOKEN: 'backup-heartbeat-secret',
      MERCHANT_OPERATIONS: operations,
    } as unknown as Env;
    const fetcher = vi.fn(async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(null, { status: 204 }));
    let pending: Promise<unknown> | undefined;

    await worker.scheduled!(
      { cron: '* * * * *', scheduledTime: Date.now(), noRetry() {} },
      withOperations,
      {
        waitUntil(value) {
          pending = value;
        },
        passThroughOnException() {},
      },
      fetcher,
    );
    await pending;

    expect(ensureReady).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [, request] = fetcher.mock.calls[0];
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer backup-heartbeat-secret',
    });
    expect(String(request?.body)).not.toContain('backup-heartbeat-secret');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      service: 'backup',
      status: 'ready',
      release: 'test',
    });
  });

  it('protects the forced merchant restore rehearsal route', async () => {
    const restartFromBackup = vi.fn(async () => ({ status: 'ready' as const }));
    const withOperations = {
      ...env,
      MERCHANT_OPERATIONS: {
        getByName: vi.fn(() => ({ restartFromBackup })),
      },
    } as unknown as Env;
    const denied = await worker.fetch(
      new Request('https://edge.example/v1/operator/restart-from-backup', {
        method: 'POST',
      }),
      withOperations,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(denied.status).toBe(401);

    const accepted = await worker.fetch(
      new Request('https://edge.example/v1/operator/restart-from-backup', {
        method: 'POST',
        headers: { Authorization: 'Bearer operator-secret' },
      }),
      withOperations,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ status: 'ready' });
    expect(restartFromBackup).toHaveBeenCalledOnce();
  });
});
