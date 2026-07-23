export const DEFAULT_SIGNET_SATS_PER_CURRENCY_UNIT = 1_000;
export const MIN_SIGNET_PAYMENT_SATS = 1_000;

export type WavelengthNetwork = 'signet';

export function parseWavelengthNetwork(value?: string): WavelengthNetwork {
  const network = value ?? 'signet';
  if (network !== 'signet') {
    throw new Error('INVALID_WAVELENGTH_NETWORK');
  }
  return network;
}

export function assertWavelengthAmount(network: WavelengthNetwork, amount: number): number {
  if ((network as string) !== 'signet') throw new Error('INVALID_WAVELENGTH_NETWORK');
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_WAVELENGTH_AMOUNT');
  }
  return amount;
}

export function quoteSignetSats(amountCents: number, satsPerCurrencyUnit: number): number {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !Number.isSafeInteger(satsPerCurrencyUnit) ||
    satsPerCurrencyUnit <= 0
  ) {
    throw new Error('INVALID_WAVELENGTH_QUOTE');
  }
  return Math.max(MIN_SIGNET_PAYMENT_SATS, Math.ceil((amountCents * satsPerCurrencyUnit) / 100));
}
