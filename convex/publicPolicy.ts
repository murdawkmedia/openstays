export const PUBLIC_CONSENT_VERSION = 'openstays.public-live.v1' as const;
export const ZAPRITE_CONTRIBUTION_CENTS = 100 as const;
export const WAVELENGTH_PAYMENT_SATS = 1_000 as const;
export const WAVELENGTH_REWARD_SATS = 1_000 as const;

const DEFAULT_REWARD_MAX_FEE_SATS = 210;
const MAX_TOKEN_CLOCK_SKEW_MS = 60_000;

export type EligibilityAction =
  | 'zaprite_payment'
  | 'wavelength_payment'
  | 'reward_claim';

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
  wavelengthEnabled: boolean;
  rewardsEnabled: boolean;
  zapriteContributionCents: 100;
  wavelengthPaymentSats: 1_000;
  rewardSats: 1_000;
  rewardDailyBudgetSats: number;
  rewardMaxFeeSats: number;
};

function enabled(value: string | undefined): boolean {
  return value === 'true';
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function exactInteger(
  value: string | undefined,
  expected: number,
  name: string,
): void {
  if (value !== undefined && Number(value) !== expected) {
    throw new Error(`${name} must be ${expected}`);
  }
}

export function readPublicPolicy(
  env: Record<string, string | undefined>,
): PublicPolicy {
  exactInteger(
    env.PUBLIC_ZAPRITE_CONTRIBUTION_CENTS,
    ZAPRITE_CONTRIBUTION_CENTS,
    'PUBLIC_ZAPRITE_CONTRIBUTION_CENTS',
  );
  exactInteger(
    env.WAVELENGTH_PUBLIC_PAYMENT_SATS,
    WAVELENGTH_PAYMENT_SATS,
    'WAVELENGTH_PUBLIC_PAYMENT_SATS',
  );
  exactInteger(
    env.WAVELENGTH_REWARD_SATS,
    WAVELENGTH_REWARD_SATS,
    'WAVELENGTH_REWARD_SATS',
  );

  const liveMode = enabled(env.PUBLIC_LIVE_PAYMENTS);
  const zapriteEnabled = enabled(env.ZAPRITE_ENABLED);
  const wavelengthEnabled = enabled(env.WAVELENGTH_ENABLED);
  const rewardsEnabled = enabled(env.WAVELENGTH_REWARDS_ENABLED);
  if (!liveMode && (zapriteEnabled || wavelengthEnabled || rewardsEnabled)) {
    throw new Error('PUBLIC_LIVE_PAYMENTS_REQUIRED');
  }
  if (
    enabled(env.DEMO_MODE)
    && (zapriteEnabled || wavelengthEnabled || rewardsEnabled)
  ) {
    throw new Error('LIVE_DEMO_MODE_CONFLICT');
  }

  return {
    liveMode,
    simulatedEnabled: env.PUBLIC_SIMULATED_PAYMENTS !== 'false',
    zapriteEnabled,
    wavelengthEnabled,
    rewardsEnabled,
    zapriteContributionCents: ZAPRITE_CONTRIBUTION_CENTS,
    wavelengthPaymentSats: WAVELENGTH_PAYMENT_SATS,
    rewardSats: WAVELENGTH_REWARD_SATS,
    rewardDailyBudgetSats: nonNegativeInteger(
      env.WAVELENGTH_REWARD_DAILY_BUDGET_SATS,
      0,
      'WAVELENGTH_REWARD_DAILY_BUDGET_SATS',
    ),
    rewardMaxFeeSats: nonNegativeInteger(
      env.WAVELENGTH_REWARD_MAX_FEE_SATS,
      DEFAULT_REWARD_MAX_FEE_SATS,
      'WAVELENGTH_REWARD_MAX_FEE_SATS',
    ),
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('ELIGIBILITY_TOKEN_MALFORMED');
  }
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
  const data = new Uint8Array(input).buffer as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function isEligibilityClaims(value: unknown): value is VerifiedEligibility {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Record<string, unknown>;
  return claims.v === 1
    && typeof claims.jti === 'string'
    && claims.jti.length > 0
    && ['zaprite_payment', 'wavelength_payment', 'reward_claim']
      .includes(String(claims.action))
    && typeof claims.bookingId === 'string'
    && claims.bookingId.length > 0
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
  if (!isEligibilityClaims(claims)) throw new Error('ELIGIBILITY_CLAIMS_INVALID');
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
  const suppliedSignature = decodeBase64Url(segments[1]);
  const expectedSignature = await hmac(payload, signingKey);
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new Error('ELIGIBILITY_SIGNATURE_INVALID');
  }

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new Error('ELIGIBILITY_TOKEN_MALFORMED');
  }
  if (!isEligibilityClaims(claims)) throw new Error('ELIGIBILITY_CLAIMS_INVALID');
  if (claims.action !== expected.action || claims.bookingId !== expected.bookingId) {
    throw new Error('ELIGIBILITY_SCOPE_INVALID');
  }
  if (claims.iat > nowMs + MAX_TOKEN_CLOCK_SKEW_MS) {
    throw new Error('ELIGIBILITY_ISSUED_IN_FUTURE');
  }
  if (claims.exp < nowMs) throw new Error('ELIGIBILITY_EXPIRED');
  return claims;
}

export async function eligibilityEmailDigest(
  normalizedEmail: string,
  signingKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `openstays-eligibility-email-v1\n${normalizedEmail}`,
  );
  return encodeBase64Url(await hmac(bytes, signingKey));
}
