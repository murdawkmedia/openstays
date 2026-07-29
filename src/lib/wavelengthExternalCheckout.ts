export const OFFICIAL_WAVELENGTH_DEMO_URL =
  'https://wavelength.lightning.engineering/demo/';
export const OFFICIAL_WAVELENGTH_RECOVERY_URL =
  'https://wavelength.lightning.engineering/guides/restore-a-wallet/';

interface ExternalPaymentRequest {
  status?: string;
  bolt11?: string;
  satsAmount?: number;
  expiresAt?: number;
}

export function officialWavelengthDemoPaymentLink(
  request: ExternalPaymentRequest | undefined,
  now: number,
): string | null {
  if (
    request?.status !== 'invoice_ready'
    || !request.bolt11?.trim()
    || !Number.isInteger(request.satsAmount)
    || (request.satsAmount ?? 0) <= 0
    || !Number.isFinite(request.expiresAt)
    || (request.expiresAt ?? 0) <= now
  ) {
    return null;
  }
  return OFFICIAL_WAVELENGTH_DEMO_URL;
}

export function confirmationPathForAuthoritativeSettlement(
  status: string | undefined,
  confirmationCode: string,
): string | null {
  if (status !== 'settled' || !confirmationCode.trim()) return null;
  return `/confirmation/${encodeURIComponent(confirmationCode)}`;
}
