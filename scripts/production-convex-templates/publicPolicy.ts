export const PUBLIC_CONSENT_VERSION = 'openstays.public-live.v1' as const;
export const ZAPRITE_CONTRIBUTION_CENTS = 100 as const;

const MAX_TOKEN_CLOCK_SKEW_MS = 60_000;

export type EligibilityAction = 'zaprite_payment';

export type VerifiedEligibility = {
  v: 1;
  jti: string;
  action: EligibilityAction;
  bookingId: string;
  emailDigest: string;
  deviceDigest: string;
  networkDigest: string;
  iat: number;
  exp: number;
};

export type PublicPolicy = {
  liveMode: boolean;
  simulatedEnabled: boolean;
  zapriteEnabled: boolean;
  zapriteContributionCents: 100;
};

export function readPublicPolicy(env: Record<string, string | undefined>): PublicPolicy {
  if (env.PUBLIC_ZAPRITE_CONTRIBUTION_CENTS !== undefined
    && Number(env.PUBLIC_ZAPRITE_CONTRIBUTION_CENTS) !== ZAPRITE_CONTRIBUTION_CENTS) {
    throw new Error('PUBLIC_ZAPRITE_CONTRIBUTION_CENTS must be 100');
  }
  if (env.DEMO_MODE === 'true') throw new Error('PRODUCTION_DEMO_MODE_FORBIDDEN');
  return {
    liveMode: env.PUBLIC_LIVE_PAYMENTS === 'true',
    simulatedEnabled: false,
    zapriteEnabled: env.ZAPRITE_ENABLED === 'true',
    zapriteContributionCents: ZAPRITE_CONTRIBUTION_CENTS,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('ELIGIBILITY_TOKEN_MALFORMED');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('ELIGIBILITY_TOKEN_MALFORMED');
  }
}

async function hmac(input: Uint8Array, signingKey: string): Promise<Uint8Array> {
  if (new TextEncoder().encode(signingKey).byteLength < 32) {
    throw new Error('ELIGIBILITY_SIGNING_KEY_TOO_SHORT');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new Uint8Array(input).buffer as ArrayBuffer,
  ));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function validClaims(value: unknown): value is VerifiedEligibility {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Record<string, unknown>;
  return claims.v === 1
    && claims.action === 'zaprite_payment'
    && typeof claims.jti === 'string'
    && typeof claims.bookingId === 'string'
    && typeof claims.emailDigest === 'string'
    && typeof claims.deviceDigest === 'string'
    && typeof claims.networkDigest === 'string'
    && Number.isSafeInteger(claims.iat)
    && Number.isSafeInteger(claims.exp)
    && Number(claims.exp) > Number(claims.iat);
}

export async function signEligibilityToken(
  claims: VerifiedEligibility,
  signingKey: string,
): Promise<string> {
  if (!validClaims(claims)) throw new Error('ELIGIBILITY_CLAIMS_INVALID');
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  return `${encodeBase64Url(payload)}.${encodeBase64Url(await hmac(payload, signingKey))}`;
}

export async function verifyEligibilityToken(
  token: string,
  expected: { action: EligibilityAction; bookingId: string },
  signingKey: string,
  nowMs: number,
): Promise<VerifiedEligibility> {
  const segments = token.split('.');
  if (segments.length !== 2) throw new Error('ELIGIBILITY_TOKEN_MALFORMED');
  const payload = decodeBase64Url(segments[0]);
  if (!timingSafeEqual(decodeBase64Url(segments[1]), await hmac(payload, signingKey))) {
    throw new Error('ELIGIBILITY_SIGNATURE_INVALID');
  }
  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder().decode(payload)); }
  catch { throw new Error('ELIGIBILITY_TOKEN_MALFORMED'); }
  if (!validClaims(claims)) throw new Error('ELIGIBILITY_CLAIMS_INVALID');
  if (claims.action !== expected.action || claims.bookingId !== expected.bookingId) {
    throw new Error('ELIGIBILITY_SCOPE_INVALID');
  }
  if (claims.iat > nowMs + MAX_TOKEN_CLOCK_SKEW_MS) throw new Error('ELIGIBILITY_ISSUED_IN_FUTURE');
  if (claims.exp < nowMs) throw new Error('ELIGIBILITY_EXPIRED');
  return claims;
}

export async function eligibilityEmailDigest(
  normalizedEmail: string,
  signingKey: string,
): Promise<string> {
  return encodeBase64Url(await hmac(
    new TextEncoder().encode(`openstays-eligibility-email-v1\n${normalizedEmail}`),
    signingKey,
  ));
}
