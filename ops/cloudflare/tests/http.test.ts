import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import worker, { type Env } from '../src/index';

const env: Env = {
  PUBLIC_ORIGIN: 'https://showcase.example',
  RELEASE: 'test',
  OPERATIONS_MODE: 'cloudflare_container',
  TURNSTILE_SECRET: 'turnstile-secret',
  ELIGIBILITY_HMAC_SECRET: 'eligibility-signing-key-with-at-least-32-bytes',
  OPERATIONS_ADMIN_TOKEN: 'operator-secret',
} as Env;

const synologyEnv: Env = {
  ...env,
  OPERATIONS_MODE: 'synology_external',
};

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
  it('issues eligibility in external mode without merchant operations', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: true })));
    const response = await worker.fetch(
      eligibilityRequest(),
      synologyEnv,
      { waitUntil() {}, passThroughOnException() {} },
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      token: expect.any(String),
    });
  });

  it.each([
    ['missing mode', { OPERATIONS_MODE: undefined }],
    ['unknown mode', { OPERATIONS_MODE: 'synology_externl' }],
  ])('fails closed with an accidental merchant binding for %s',
    async (_label, override) => {
      const getByName = vi.fn(() => ({
        redactedHealth: vi.fn(async () => ({ status: 'ready' as const })),
        bootstrapWallet: vi.fn(async () => ({
          mnemonic: ['mnemonic-must-not-leak'],
        })),
        restartFromBackup: vi.fn(async () => ({ status: 'ready' as const })),
        ensureReady: vi.fn(async () => ({ status: 'ready' as const })),
      }));
      const invalidModeEnv = {
        ...env,
        ...override,
        MERCHANT_OPERATIONS: { getByName },
      } as unknown as Env;
      const context = { waitUntil: vi.fn(), passThroughOnException() {} };

      const eligibilityResponse = await worker.fetch(
        eligibilityRequest(),
        invalidModeEnv,
        context,
        vi.fn(async () => new Response(JSON.stringify({ success: true }))),
      );
      const healthResponse = await worker.fetch(
        new Request('https://edge.example/healthz'),
        invalidModeEnv,
        context,
        vi.fn(),
      );
      const diagnosticsResponse = await worker.fetch(
        new Request('https://edge.example/v1/operator/diagnostics', {
          headers: { Authorization: 'Bearer operator-secret' },
        }),
        invalidModeEnv,
        context,
        vi.fn(),
      );
      const bootstrapResponse = await worker.fetch(
        new Request('https://edge.example/v1/operator/bootstrap-wallet', {
          method: 'POST',
          headers: { Authorization: 'Bearer operator-secret' },
        }),
        invalidModeEnv,
        context,
        vi.fn(),
      );
      const restoreResponse = await worker.fetch(
        new Request('https://edge.example/v1/operator/restart-from-backup', {
          method: 'POST',
          headers: { Authorization: 'Bearer operator-secret' },
        }),
        invalidModeEnv,
        context,
        vi.fn(),
      );
      await worker.scheduled!(
        { cron: '* * * * *', scheduledTime: Date.now(), noRetry() {} },
        invalidModeEnv,
        context,
        vi.fn(),
      );

      expect(eligibilityResponse.status).toBe(503);
      expect(await eligibilityResponse.json()).toEqual({
        error: 'CONFIGURATION_ERROR',
      });
      expect(healthResponse.status).toBe(503);
      expect(await healthResponse.json()).toEqual({
        release: 'test',
        status: 'configuration_error',
        failureCategory: 'configuration_error',
      });
      expect(diagnosticsResponse.status).toBe(503);
      expect(bootstrapResponse.status).toBe(503);
      expect(restoreResponse.status).toBe(503);
      expect(await bootstrapResponse.text()).not.toContain('mnemonic');
      expect(getByName).not.toHaveBeenCalled();
      expect(context.waitUntil).not.toHaveBeenCalled();
    });

  it.each([
    ['missing Turnstile secret', { TURNSTILE_SECRET: undefined }],
    ['empty Turnstile secret', { TURNSTILE_SECRET: '  ' }],
    ['missing eligibility key', { ELIGIBILITY_HMAC_SECRET: undefined }],
    ['weak eligibility key', { ELIGIBILITY_HMAC_SECRET: 'too-short' }],
    ['whitespace-only eligibility key', {
      ELIGIBILITY_HMAC_SECRET: ' '.repeat(32),
    }],
    ['leading whitespace in eligibility key', {
      ELIGIBILITY_HMAC_SECRET: ` ${'a'.repeat(32)}`,
    }],
    ['trailing whitespace in eligibility key', {
      ELIGIBILITY_HMAC_SECRET: `${'a'.repeat(32)} `,
    }],
    ['CRLF in eligibility key', {
      ELIGIBILITY_HMAC_SECRET: `${'a'.repeat(16)}\r\n${'b'.repeat(16)}`,
    }],
    ['control character in eligibility key', {
      ELIGIBILITY_HMAC_SECRET: `${'a'.repeat(31)}\u0000`,
    }],
    ['missing public origin', { PUBLIC_ORIGIN: undefined }],
    ['malformed public origin', { PUBLIC_ORIGIN: 'not-a-url' }],
    ['non-HTTPS public origin', { PUBLIC_ORIGIN: 'http://showcase.example' }],
    ['public origin with path', { PUBLIC_ORIGIN: 'https://showcase.example/path' }],
    ['missing release', { RELEASE: undefined }],
    ['empty release', { RELEASE: '  ' }],
    ['release with surrounding whitespace', { RELEASE: ' test ' }],
  ])('returns one redacted configuration error for %s',
    async (_label, override) => {
      const invalidEnv = {
        ...synologyEnv,
        ...override,
        MERCHANT_OPERATIONS: {
          getByName: vi.fn(() => {
            throw new Error('invalid configuration must not access bindings');
          }),
        },
      } as unknown as Env;
      const fetcher = vi.fn(async () =>
        new Response(JSON.stringify({ success: true })));
      const eligibilityResponse = await worker.fetch(
        eligibilityRequest(),
        invalidEnv,
        { waitUntil() {}, passThroughOnException() {} },
        fetcher,
      );
      const healthResponse = await worker.fetch(
        new Request('https://edge.example/healthz'),
        invalidEnv,
        { waitUntil() {}, passThroughOnException() {} },
        fetcher,
      );

      expect(eligibilityResponse.status).toBe(503);
      expect(await eligibilityResponse.json()).toEqual({
        error: 'CONFIGURATION_ERROR',
      });
      expect(healthResponse.status).toBe(503);
      const healthBody = await healthResponse.text();
      const safeRelease = typeof invalidEnv.RELEASE === 'string'
        && invalidEnv.RELEASE.trim()
        && invalidEnv.RELEASE === invalidEnv.RELEASE.trim()
        ? invalidEnv.RELEASE
        : 'unconfigured';
      expect(JSON.parse(healthBody)).toEqual({
        release: safeRelease,
        status: 'configuration_error',
        failureCategory: 'configuration_error',
      });
      expect(healthBody).not.toContain(String(invalidEnv.TURNSTILE_SECRET));
      expect(healthBody).not.toContain(String(invalidEnv.ELIGIBILITY_HMAC_SECRET));
      expect(fetcher).not.toHaveBeenCalled();
      expect(invalidEnv.MERCHANT_OPERATIONS?.getByName).not.toHaveBeenCalled();
    });

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
      synologyEnv,
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
      synologyEnv,
      { waitUntil() {}, passThroughOnException() {} },
      failed,
    )).status).toBe(403);
    expect((await worker.fetch(
      eligibilityRequest(),
      synologyEnv,
      { waitUntil() {}, passThroughOnException() {} },
      failed,
    )).status).toBe(403);
  });

  it('rejects a Turnstile challenge reused for another action', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));

    const first = await worker.fetch(
      eligibilityRequest(),
      synologyEnv,
      { waitUntil() {}, passThroughOnException() {} },
      fetcher,
    );
    const replay = await worker.fetch(
      eligibilityRequest({ action: 'reward_claim' }),
      synologyEnv,
      { waitUntil() {}, passThroughOnException() {} },
      fetcher,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(403);
  });

  it.each([
    { action: 'unsupported' },
    { bookingId: '../booking' },
    { normalizedEmail: 'Not-Normalized@Example.test' },
    { deviceId: 'short' },
  ])('rejects malformed input %#', async (override) => {
    const response = await worker.fetch(
      eligibilityRequest(override),
      synologyEnv,
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

  it('reports only eligibility readiness in external mode', async () => {
    const redactedHealth = vi.fn(async () => ({ status: 'ready' as const }));
    const externalWithAccidentalBinding = {
      ...synologyEnv,
      SYNOLOGY_ORIGIN: 'https://nas.internal',
      SYNOLOGY_TOKEN: 'must-not-be-exposed',
      MERCHANT_OPERATIONS: {
        getByName: vi.fn(() => ({ redactedHealth })),
      },
    } as unknown as Env;
    const response = await worker.fetch(
      new Request('https://edge.example/healthz'),
      externalWithAccidentalBinding,
      { waitUntil() {}, passThroughOnException() {} },
      vi.fn(),
    );

    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      release: 'test',
      status: 'eligibility_ready',
    });
    expect(redactedHealth).not.toHaveBeenCalled();
    expect(body).not.toContain('nas.internal');
    expect(body).not.toContain('must-not-be-exposed');
  });

  it.each([
    '/v1/operator/bootstrap-wallet',
    '/v1/operator/restart-from-backup',
  ])('keeps the operator wallet route unavailable in external mode: %s',
    async (pathname) => {
      const externalWithAccidentalBinding = {
        ...synologyEnv,
        MERCHANT_OPERATIONS: {
          getByName: vi.fn(() => {
            throw new Error('external mode must not use merchant operations');
          }),
        },
      } as unknown as Env;
      const response = await worker.fetch(
        new Request(`https://edge.example${pathname}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer operator-secret' },
        }),
        externalWithAccidentalBinding,
        { waitUntil() {}, passThroughOnException() {} },
        vi.fn(),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'OPERATIONS_UNAVAILABLE',
      });
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

describe('eligibility-only Wrangler configuration', () => {
  it('contains only edge eligibility bindings and no merchant infrastructure', async () => {
    const raw = await readFile(
      new URL('../wrangler.synology.jsonc', import.meta.url),
      'utf8',
    );
    const config = JSON.parse(raw) as Record<string, unknown>;

    expect(config.vars).toEqual({
      PUBLIC_ORIGIN: 'https://openstays-consensus.pages.dev',
      RELEASE: 'local-unconfigured',
      OPERATIONS_MODE: 'synology_external',
    });
    expect(config.secrets).toEqual({
      required: [
        'TURNSTILE_SECRET',
        'ELIGIBILITY_HMAC_SECRET',
        'OPERATIONS_ADMIN_TOKEN',
      ],
    });
    for (const forbidden of [
      'r2_buckets',
      'durable_objects',
      'containers',
      'migrations',
      'triggers',
    ]) {
      expect(config).not.toHaveProperty(forbidden);
    }
    expect(raw).not.toMatch(
      /SYN(?:OLOGY)?_(?:ORIGIN|TOKEN)|MERCHANT_OPERATIONS|OPENSTAYS_URL|WAVELENGTH|BACKUP_/u,
    );
  });

  it('makes the legacy deployment mode explicit', async () => {
    const raw = await readFile(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    );
    const config = JSON.parse(raw) as {
      vars?: Record<string, unknown>;
    };

    expect(config.vars?.OPERATIONS_MODE).toBe('cloudflare_container');
  });
});
