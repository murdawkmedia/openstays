import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  confirmationPathForAuthoritativeSettlement,
  officialWavelengthDemoPaymentLink,
} from '../src/lib/wavelengthExternalCheckout';

describe('official Wavelength demo checkout', () => {
  it('offers the official demo only for a valid, unexpired amount-bearing request', () => {
    expect(officialWavelengthDemoPaymentLink({
      status: 'invoice_ready',
      bolt11: 'lntbs10u1valid',
      satsAmount: 1_000,
      expiresAt: 20_000,
    }, 10_000)).toBe('https://wavelength.lightning.engineering/demo/');

    expect(officialWavelengthDemoPaymentLink({
      status: 'pending',
      bolt11: 'lntbs10u1valid',
      satsAmount: 1_000,
      expiresAt: 20_000,
    }, 10_000)).toBeNull();
    expect(officialWavelengthDemoPaymentLink({
      status: 'invoice_ready',
      bolt11: '',
      satsAmount: 1_000,
      expiresAt: 20_000,
    }, 10_000)).toBeNull();
    expect(officialWavelengthDemoPaymentLink({
      status: 'invoice_ready',
      bolt11: 'lntbs10u1valid',
      satsAmount: 0,
      expiresAt: 20_000,
    }, 10_000)).toBeNull();
    expect(officialWavelengthDemoPaymentLink({
      status: 'invoice_ready',
      bolt11: 'lntbs10u1valid',
      satsAmount: 1_000,
      expiresAt: 10_000,
    }, 10_000)).toBeNull();
  });

  it('creates a confirmation path only from authoritative settlement', () => {
    expect(confirmationPathForAuthoritativeSettlement('settled', 'BAD-BASH')).toBe(
      '/confirmation/BAD-BASH',
    );
    expect(confirmationPathForAuthoritativeSettlement('invoice_ready', 'BAD-BASH')).toBeNull();
    expect(confirmationPathForAuthoritativeSettlement('failed', 'BAD-BASH')).toBeNull();
    expect(confirmationPathForAuthoritativeSettlement('settled', '')).toBeNull();
  });
});

describe('Wavelength payment page integration', () => {
  it('keeps the external path available independently of embedded wallet state', () => {
    const source = fs.readFileSync('src/pages/WavelengthWalletPage.tsx', 'utf8');
    expect(source).toContain('Pay using Wavelength’s official demo wallet');
    expect(source).toContain('Copy the BOLT11 above');
    expect(source).toContain('OFFICIAL_WAVELENGTH_RECOVERY_URL');
    expect(source).toContain('never enter a mainnet recovery phrase');
    expect(source).not.toContain('<iframe');
  });

  it('redirects once only after the reactive request is authoritatively settled', () => {
    const source = fs.readFileSync('src/pages/WavelengthWalletPage.tsx', 'utf8');
    expect(source).toContain('confirmationPathForAuthoritativeSettlement');
    expect(source).toContain('settledRedirected.current');
    expect(source).toContain('2_000');
    expect(source).toContain('Continue to confirmation');
    expect(source).toContain('replace: true');
  });
});
