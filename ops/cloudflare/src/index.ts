import {
  issueEligibilityToken,
  type EligibilityAction,
  verifyTurnstile,
} from './eligibility';
import {
  MerchantOperations,
  type MerchantOperationsEnv,
} from './merchantContainer';

export interface Env extends MerchantOperationsEnv {
  PUBLIC_ORIGIN: string;
  RELEASE: string;
  OPERATIONS_MODE: 'cloudflare_container' | 'synology_external';
  TURNSTILE_SECRET: string;
  ELIGIBILITY_HMAC_SECRET: string;
  OPERATIONS_ADMIN_TOKEN: string;
  MERCHANT_OPERATIONS?: DurableObjectNamespace<MerchantOperations>;
}

type WorkerContext = Pick<
  ExecutionContext,
  'waitUntil' | 'passThroughOnException'
>;

const MAX_BODY_BYTES = 8 * 1_024;
const ACTIONS = new Set<EligibilityAction>([
  'zaprite_payment',
  'wavelength_payment',
  'reward_claim',
]);
const OPERATIONS_MODES = new Set([
  'cloudflare_container',
  'synology_external',
]);

function validRuntimeConfiguration(env: Env): boolean {
  if (!OPERATIONS_MODES.has(env.OPERATIONS_MODE)) return false;
  if (
    typeof env.RELEASE !== 'string'
    || !env.RELEASE.trim()
    || env.RELEASE !== env.RELEASE.trim()
  ) return false;
  if (
    typeof env.TURNSTILE_SECRET !== 'string'
    || !env.TURNSTILE_SECRET.trim()
    || env.TURNSTILE_SECRET !== env.TURNSTILE_SECRET.trim()
  ) return false;
  if (
    typeof env.ELIGIBILITY_HMAC_SECRET !== 'string'
    || new TextEncoder().encode(env.ELIGIBILITY_HMAC_SECRET).byteLength < 32
  ) return false;
  if (typeof env.PUBLIC_ORIGIN !== 'string') return false;
  try {
    const origin = new URL(env.PUBLIC_ORIGIN);
    return origin.protocol === 'https:'
      && origin.origin === env.PUBLIC_ORIGIN;
  } catch {
    return false;
  }
}

function configurationError(request: Request, env: Env): Response {
  return json(request, env, 503, { error: 'CONFIGURATION_ERROR' });
}

function configurationHealth(request: Request, env: Env): Response {
  const release = typeof env.RELEASE === 'string'
    && env.RELEASE.trim()
    && env.RELEASE === env.RELEASE.trim()
    ? env.RELEASE
    : 'unconfigured';
  return json(request, env, 503, {
    release,
    status: 'configuration_error',
    failureCategory: 'configuration_error',
  });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  });
  if (request.headers.get('Origin') === env.PUBLIC_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', env.PUBLIC_ORIGIN);
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function json(
  request: Request,
  env: Env,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, env),
  });
}

function validInput(value: unknown): value is {
  action: EligibilityAction;
  bookingId: string;
  normalizedEmail: string;
  deviceId: string;
  turnstileToken: string;
} {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return ACTIONS.has(input.action as EligibilityAction)
    && typeof input.bookingId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/u.test(input.bookingId)
    && typeof input.normalizedEmail === 'string'
    && input.normalizedEmail === input.normalizedEmail.trim().toLowerCase()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.normalizedEmail)
    && input.normalizedEmail.length <= 254
    && typeof input.deviceId === 'string'
    && /^[a-f0-9]{32}$/u.test(input.deviceId)
    && typeof input.turnstileToken === 'string'
    && input.turnstileToken.length > 0
    && input.turnstileToken.length <= 2_048;
}

async function eligibility(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
): Promise<Response> {
  if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
    return json(request, env, 403, { error: 'ORIGIN_FORBIDDEN' });
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredLength >= MAX_BODY_BYTES) {
    return json(request, env, 413, { error: 'BODY_TOO_LARGE' });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength >= MAX_BODY_BYTES) {
    return json(request, env, 413, { error: 'BODY_TOO_LARGE' });
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json(request, env, 400, { error: 'INVALID_REQUEST' });
  }
  if (!validInput(input)) {
    const failedChallenge = Boolean(
      input
      && typeof input === 'object'
      && 'turnstileToken' in input
      && (input as { turnstileToken?: unknown }).turnstileToken === '',
    );
    return json(request, env, failedChallenge ? 403 : 400, {
      error: failedChallenge ? 'TURNSTILE_FAILED' : 'INVALID_REQUEST',
    });
  }
  const ip = request.headers.get('CF-Connecting-IP')?.trim() ?? '';
  if (!ip || !await verifyTurnstile(
    env.TURNSTILE_SECRET,
    input.turnstileToken,
    ip,
    fetcher,
  )) {
    return json(request, env, 403, { error: 'TURNSTILE_FAILED' });
  }
  const token = await issueEligibilityToken({
    action: input.action,
    bookingId: input.bookingId,
    normalizedEmail: input.normalizedEmail,
    deviceId: input.deviceId,
    ip,
  }, env.ELIGIBILITY_HMAC_SECRET, Date.now());
  return json(request, env, 200, { token });
}

function authorized(request: Request, expected: string): boolean {
  const supplied = request.headers.get('Authorization');
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function merchantOperations(env: Env) {
  if (env.OPERATIONS_MODE !== 'cloudflare_container') return undefined;
  return env.MERCHANT_OPERATIONS?.getByName('merchant');
}

async function publishBackupHeartbeat(
  env: Env,
  status: 'ready' | 'failed',
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.OPENSTAYS_URL || !env.BACKUP_HEARTBEAT_TOKEN) return;
  const response = await fetcher(
    `${env.OPENSTAYS_URL.replace(/\/$/u, '')}/operations-bridge/heartbeat`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BACKUP_HEARTBEAT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service: 'backup',
        status,
        release: env.RELEASE,
        observedAt: Date.now(),
        ...(status === 'failed' ? { failureCategory: 'backup_stale' } : {}),
      }),
    },
  );
  if (!response.ok) throw new Error('BACKUP_HEARTBEAT_FAILED');
}

export { MerchantOperations };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    _context: WorkerContext,
    fetcher: typeof fetch = fetch,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!validRuntimeConfiguration(env)) {
      return request.method === 'GET' && url.pathname === '/healthz'
        ? configurationHealth(request, env)
        : configurationError(request, env);
    }
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
        return json(request, env, 403, { error: 'ORIGIN_FORBIDDEN' });
      }
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method === 'POST' && url.pathname === '/v1/eligibility') {
      return eligibility(request, env, fetcher);
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      if (env.OPERATIONS_MODE === 'synology_external') {
        return json(request, env, 200, {
          release: env.RELEASE,
          status: 'eligibility_ready',
        });
      }
      const operations = merchantOperations(env);
      const health = operations
        ? await operations.redactedHealth()
        : { status: 'starting' as const };
      return json(request, env, 200, {
        release: env.RELEASE,
        status: health.status,
      });
    }
    if (url.pathname === '/v1/operator/diagnostics') {
      if (!authorized(request, env.OPERATIONS_ADMIN_TOKEN)) {
        return json(request, env, 401, { error: 'UNAUTHORIZED' });
      }
      if (env.OPERATIONS_MODE === 'synology_external') {
        return json(request, env, 503, { error: 'OPERATIONS_UNAVAILABLE' });
      }
      const health = merchantOperations(env)
        ? await merchantOperations(env)!.redactedHealth()
        : { status: 'starting' as const };
      return json(request, env, 200, {
        release: env.RELEASE,
        status: health.status,
        components: {
          merchant: health,
        },
      });
    }
    if (
      request.method === 'POST'
      && url.pathname === '/v1/operator/bootstrap-wallet'
    ) {
      if (!authorized(request, env.OPERATIONS_ADMIN_TOKEN)) {
        return json(request, env, 401, { error: 'UNAUTHORIZED' });
      }
      if (!merchantOperations(env)) {
        return json(request, env, 503, { error: 'OPERATIONS_UNAVAILABLE' });
      }
      try {
        const result = await merchantOperations(env)!.bootstrapWallet();
        return json(request, env, 201, { mnemonic: result.mnemonic });
      } catch {
        return json(request, env, 409, { error: 'BOOTSTRAP_FAILED' });
      }
    }
    if (
      request.method === 'POST'
      && url.pathname === '/v1/operator/restart-from-backup'
    ) {
      if (!authorized(request, env.OPERATIONS_ADMIN_TOKEN)) {
        return json(request, env, 401, { error: 'UNAUTHORIZED' });
      }
      const operations = merchantOperations(env);
      if (!operations) {
        return json(request, env, 503, { error: 'OPERATIONS_UNAVAILABLE' });
      }
      const result = await operations.restartFromBackup();
      return json(request, env, result.status === 'ready' ? 200 : 503, {
        status: result.status,
      });
    }
    return json(request, env, 404, { error: 'NOT_FOUND' });
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: WorkerContext,
    fetcher: typeof fetch = fetch,
  ): Promise<void> {
    if (!validRuntimeConfiguration(env)) return;
    const operations = merchantOperations(env);
    if (!operations) return;
    context.waitUntil((async () => {
      let status: 'ready' | 'failed' = 'failed';
      try {
        status = (await operations.ensureReady()).status;
      } finally {
        await publishBackupHeartbeat(env, status, fetcher);
      }
    })());
  },
};

export default worker;
