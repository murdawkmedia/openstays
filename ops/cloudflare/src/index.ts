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
  TURNSTILE_SECRET: string;
  ELIGIBILITY_HMAC_SECRET: string;
  OPERATIONS_ADMIN_TOKEN: string;
  MERCHANT_OPERATIONS?: DurableObjectNamespace;
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

export { MerchantOperations };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    _context: WorkerContext,
    fetcher: typeof fetch = fetch,
  ): Promise<Response> {
    const url = new URL(request.url);
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
      return json(request, env, 200, {
        release: env.RELEASE,
        status: 'starting',
      });
    }
    if (url.pathname === '/v1/operator/diagnostics') {
      if (!authorized(request, env.OPERATIONS_ADMIN_TOKEN)) {
        return json(request, env, 401, { error: 'UNAUTHORIZED' });
      }
      return json(request, env, 200, {
        release: env.RELEASE,
        status: 'starting',
        components: {},
      });
    }
    return json(request, env, 404, { error: 'NOT_FOUND' });
  },
};

export default worker;
