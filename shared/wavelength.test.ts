import { describe, expect, it } from 'vitest';
import {
  assertWavelengthAmount,
  parseWavelengthNetwork,
  quoteSignetSats,
} from './wavelength';

describe('quoteSignetSats', () => {
  it('uses the fixed demo rate, rounds upward, and respects the public signet minimum', () => {
    expect(quoteSignetSats(10_000, 1_000)).toBe(100_000);
    expect(quoteSignetSats(100, 1_000)).toBe(1_000);
    expect(quoteSignetSats(21, 1_000)).toBe(1_000);
    expect(quoteSignetSats(1, 1_001)).toBe(1_000);
  });

  it('rejects invalid money and rates', () => {
    expect(() => quoteSignetSats(0, 1_000)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
    expect(() => quoteSignetSats(100, -1)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
    expect(() => quoteSignetSats(1.5, 1_000)).toThrow(/INVALID_WAVELENGTH_QUOTE/);
  });
});

describe('signet-only Wavelength', () => {
  it('parses only signet', () => {
    expect(parseWavelengthNetwork('signet')).toBe('signet');
    expect(parseWavelengthNetwork()).toBe('signet');
    expect(() => parseWavelengthNetwork('mainnet')).toThrow('INVALID_WAVELENGTH_NETWORK');
    expect(() => parseWavelengthNetwork('testnet')).toThrow('INVALID_WAVELENGTH_NETWORK');
  });

  it('accepts positive integer signet amounts only', () => {
    expect(assertWavelengthAmount('signet', 210)).toBe(210);
    expect(() => assertWavelengthAmount('signet', 0)).toThrow('INVALID_WAVELENGTH_AMOUNT');
  });
});
