export const DEFAULT_SIGNET_SATS_PER_CURRENCY_UNIT = 1_000;

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
