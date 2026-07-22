export const DEFAULT_SIGNET_SATS_PER_CURRENCY_UNIT = 1_000;
export const MAINNET_HACKATHON_SATS = 210;

export type WavelengthNetwork = 'signet' | 'mainnet';

export function parseWavelengthNetwork(value: string | undefined): WavelengthNetwork {
  const network = value ?? 'signet';
  if (network !== 'signet' && network !== 'mainnet') {
    throw new Error('INVALID_WAVELENGTH_NETWORK');
  }
  return network;
}

export function assertWavelengthAmount(network: WavelengthNetwork, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_WAVELENGTH_AMOUNT');
  }
  if (network === 'mainnet' && amount !== MAINNET_HACKATHON_SATS) {
    throw new Error('WAVELENGTH_MAINNET_AMOUNT_NOT_210');
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
  return Math.ceil((amountCents * satsPerCurrencyUnit) / 100);
}
