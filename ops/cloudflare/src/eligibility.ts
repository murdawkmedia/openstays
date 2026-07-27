export type EligibilityAction =
  | 'zaprite_payment'
  | 'wavelength_payment'
  | 'reward_claim';

export type EligibilityClaims = {
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

const TOKEN_TTL_MS = 5 * 60_000;
const TURNSTILE_SITEVERIFY =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function hmac(
  signingKey: string,
  value: string | Uint8Array,
): Promise<Uint8Array> {
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
  const data = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value;
  const dataBuffer = new Uint8Array(data).buffer as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBuffer));
}

async function digest(signingKey: string, value: string): Promise<string> {
  return base64Url(await hmac(signingKey, value));
}

export async function verifyTurnstile(
  secret: string,
  response: string,
  remoteip: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!secret || !response || response.length > 2_048 || !remoteip) return false;
  const body = new URLSearchParams({
    secret,
    response,
    remoteip,
    idempotency_key: crypto.randomUUID(),
  });
  try {
    const result = await fetcher(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!result.ok) return false;
    const payload = await result.json() as { success?: unknown };
    return payload.success === true;
  } catch {
    return false;
  }
}

export async function issueEligibilityToken(
  input: {
    action: EligibilityAction;
    bookingId: string;
    normalizedEmail: string;
    deviceId: string;
    ip: string;
  },
  signingKey: string,
  nowMs: number,
): Promise<string> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const claims: EligibilityClaims = {
    v: 1,
    jti: crypto.randomUUID(),
    action: input.action,
    bookingId: input.bookingId,
    emailDigest: await digest(
      signingKey,
      `openstays-eligibility-email-v1\n${input.normalizedEmail}`,
    ),
    deviceDigest: await digest(
      signingKey,
      `openstays-eligibility-device-v1\n${input.deviceId}`,
    ),
    networkDigest: await digest(
      signingKey,
      `openstays-eligibility-network-v1\n${day}\n${input.ip}`,
    ),
    iat: nowMs,
    exp: nowMs + TOKEN_TTL_MS,
  };
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  return `${base64Url(payload)}.${base64Url(await hmac(signingKey, payload))}`;
}
