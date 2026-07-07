// Currency support. The pricing engine itself is currency-agnostic (integer
// cents of whatever the property's currency is); this module curates the
// options the settings UI offers and how amounts are formatted.
//
// Default is CAD (OpenStays is built by SebaHub, a Canadian company).

export const SUPPORTED_CURRENCIES = ['CAD', 'USD', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'CAD';

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Deterministic formatting locale per currency (symbol + separators). */
const CURRENCY_LOCALES: Record<string, string> = {
  CAD: 'en-CA',
  USD: 'en-US',
  EUR: 'en-IE', // English Euro formatting: €1,234.56
};

/**
 * Format integer cents in a currency, e.g. (14900, 'CAD') -> "$149.00",
 * (14900, 'EUR') -> "€149.00". Unknown-but-valid ISO codes still format via
 * a generic English locale, so OSS operators outside the curated list work.
 */
export function formatMoney(cents: number, currency: string = DEFAULT_CURRENCY): string {
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'en', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    // Invalid currency code — fail readable, never crash a booking page.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Display label for the tax line ('GST', 'VAT', 'Sales Tax'…). */
export function taxLabelOrDefault(taxLabel: string | undefined | null): string {
  return taxLabel && taxLabel.trim() !== '' ? taxLabel : 'Tax';
}
