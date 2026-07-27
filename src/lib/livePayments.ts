export const PUBLIC_CONSENT_VERSION = 'openstays.public-live.v1' as const;
export const PUBLIC_ZAPRITE_CONTRIBUTION_CENTS = 100 as const;
export const PUBLIC_WAVELENGTH_PAYMENT_SATS = 1_000 as const;
export const PUBLIC_WAVELENGTH_REWARD_SATS = 1_000 as const;
export const PUBLIC_DEVICE_STORAGE_KEY = 'openstays.public.device.v1';

export const PUBLIC_PAYMENT_DISCLOSURE =
  'Consensus Commons is a fictional property created to demonstrate OpenStays. '
  + 'No accommodation, reservation, or other lodging service is being purchased. '
  + 'A CA$1 Zaprite payment is a voluntary contribution supporting continued '
  + 'development of the open-source OpenStays project. It is not tax-deductible, '
  + 'and no charitable receipt will be issued. Refunds may be requested from the '
  + 'booking-management page. Wavelength payments and rewards use valueless '
  + 'signet test sats.';

function randomDeviceId(randomBytes: (target: Uint8Array) => Uint8Array): string {
  const bytes = randomBytes(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getPublicDeviceId(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
  randomBytes: (target: Uint8Array) => Uint8Array = (target) =>
    crypto.getRandomValues(target),
): string {
  const existing = storage.getItem(PUBLIC_DEVICE_STORAGE_KEY);
  if (existing && /^[a-f0-9]{32}$/u.test(existing)) return existing;
  const created = randomDeviceId(randomBytes);
  storage.setItem(PUBLIC_DEVICE_STORAGE_KEY, created);
  return created;
}

export async function requestEligibilityToken(input: {
  action: 'zaprite_payment' | 'wavelength_payment' | 'reward_claim';
  bookingId: string;
  normalizedEmail: string;
  deviceId: string;
  turnstileToken: string;
}): Promise<string> {
  const edgeUrl = import.meta.env.VITE_PAYMENT_EDGE_URL?.replace(/\/$/u, '');
  if (!edgeUrl) throw new Error('Live payment verification is unavailable.');
  const response = await fetch(`${edgeUrl}/v1/eligibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Live payment verification failed.');
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error('Live payment verification returned an invalid response.');
  }
  return body.token;
}
