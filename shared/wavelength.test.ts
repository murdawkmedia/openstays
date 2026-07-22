import { describe, expect, it } from 'vitest';
import {
  MAINNET_HACKATHON_SATS,
  assertWavelengthAmount,
  parseWavelengthNetwork,
  quoteSignetSats,
} from './wavelength';

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

describe('guarded Wavelength mainnet', () => {
  it('accepts exactly 210 sats', () => {
    expect(assertWavelengthAmount('mainnet', 210)).toBe(210);
  });

  it.each([209, 211, 21_000])('rejects %i sats', (amount) => {
    expect(() => assertWavelengthAmount('mainnet', amount)).toThrow(
      'WAVELENGTH_MAINNET_AMOUNT_NOT_210',
    );
  });

  it('parses only supported networks', () => {
    expect(parseWavelengthNetwork('signet')).toBe('signet');
    expect(parseWavelengthNetwork('mainnet')).toBe('mainnet');
    expect(() => parseWavelengthNetwork('testnet')).toThrow('INVALID_WAVELENGTH_NETWORK');
    expect(MAINNET_HACKATHON_SATS).toBe(210);
  });
});
