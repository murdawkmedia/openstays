import { describe, expect, it } from 'vitest';
import { quoteSignetSats } from './wavelength';

describe('quoteSignetSats', () => {
  it('uses the fixed demo rate and rounds fractional sats upward', () => {
    expect(quoteSignetSats(10_000, 1_000)).toBe(100_000);
    expect(quoteSignetSats(1, 1_001)).toBe(11);
  });

  it('rejects invalid money and rates', () => {
    expect(() => quoteSignetSats(0, 1_000)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
    expect(() => quoteSignetSats(100, -1)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
    expect(() => quoteSignetSats(1.5, 1_000)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
  });
});
