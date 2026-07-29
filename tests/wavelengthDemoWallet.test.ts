import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEMO_WALLET_ATTEMPT_SATS,
  DEMO_WALLET_TARGET_ATTEMPTS,
  DEMO_WALLET_TARGET_SATS,
  demoWalletAttemptsFunded,
  isLocalDemoWalletSetup,
  localDemoConsolidationPreview,
  validateLocalDemoConsolidationQuote,
} from '../src/lib/wavelengthDemoWallet';

const TREASURY_ADDRESS = 'tb1pytpd7rg5nf08ty0mn7wscvplgztnggzhz4kgr7c32dy2cs9r6mqst883u6';

describe('local demo wallet policy', () => {
  it('pins twelve 1,000-sat attempts to a 12,000-sat target', () => {
    expect(DEMO_WALLET_ATTEMPT_SATS).toBe(1_000);
    expect(DEMO_WALLET_TARGET_ATTEMPTS).toBe(12);
    expect(DEMO_WALLET_TARGET_SATS).toBe(12_000);
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('permits explicit setup on %s', (hostname) => {
    expect(isLocalDemoWalletSetup(hostname, '1')).toBe(true);
  });

  it.each([
    ['openstays.example', '1'],
    ['127.0.0.1', null],
    ['localhost', '0'],
  ])('rejects non-local or implicit setup', (hostname, flag) => {
    expect(isLocalDemoWalletSetup(hostname, flag)).toBe(false);
  });

  it('counts only complete, spendable attempts', () => {
    expect(demoWalletAttemptsFunded(0)).toBe(0);
    expect(demoWalletAttemptsFunded(11_999)).toBe(11);
    expect(demoWalletAttemptsFunded(12_000)).toBe(12);
    expect(demoWalletAttemptsFunded(-1)).toBe(0);
  });

  it('offers a bounded disposable-wallet consolidation only on explicit localhost setup', () => {
    expect(localDemoConsolidationPreview({
      hostname: '127.0.0.1',
      setupFlag: '1',
      publicShowcase: false,
      destinationAddress: TREASURY_ADDRESS,
      spendableSats: 12_000,
    })).toEqual({
      allowed: true,
      amountSats: 10_000,
      reserveSats: 1_000,
      maxFeeSats: 1_000,
    });
    expect(localDemoConsolidationPreview({
      hostname: 'openstays.example',
      setupFlag: '1',
      publicShowcase: false,
      destinationAddress: TREASURY_ADDRESS,
      spendableSats: 12_000,
    }).allowed).toBe(false);
    expect(localDemoConsolidationPreview({
      hostname: 'localhost',
      setupFlag: '1',
      publicShowcase: true,
      destinationAddress: TREASURY_ADDRESS,
      spendableSats: 12_000,
    }).allowed).toBe(false);
  });

  it('rejects a mismatched, Lightning, excessive-fee, or reserve-crossing quote', () => {
    const quote = {
      network: 'signet',
      destinationSummary: TREASURY_ADDRESS,
      amountSat: 10_000,
      expectedFeeSat: 500,
      feeKnown: true,
      expectedTotalOutflowSat: 10_500,
      totalOutflowKnown: true,
      rail: 'onchain',
      quoteStatus: 'complete',
      expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
    };
    expect(validateLocalDemoConsolidationQuote(quote, {
      destinationAddress: TREASURY_ADDRESS,
      spendableSats: 12_000,
      amountSats: 10_000,
      reserveSats: 1_000,
      maxFeeSats: 1_000,
      now: Date.now(),
    })).toEqual({ ok: true });
    expect(validateLocalDemoConsolidationQuote(
      { ...quote, rail: 'lightning' },
      {
        destinationAddress: TREASURY_ADDRESS,
        spendableSats: 12_000,
        amountSats: 10_000,
        reserveSats: 1_000,
        maxFeeSats: 1_000,
        now: Date.now(),
      },
    )).toEqual({ ok: false, reason: 'On-chain quote required.' });
    expect(validateLocalDemoConsolidationQuote(
      { ...quote, expectedFeeSat: 1_001, expectedTotalOutflowSat: 11_001 },
      {
        destinationAddress: TREASURY_ADDRESS,
        spendableSats: 12_000,
        amountSats: 10_000,
        reserveSats: 1_000,
        maxFeeSats: 1_000,
        now: Date.now(),
      },
    )).toEqual({ ok: false, reason: 'Fee exceeds the local safety ceiling.' });
  });

  it('keeps the explicit consolidation control local, confirmed, and bounded', () => {
    const source = fs.readFileSync('src/pages/WavelengthWalletPage.tsx', 'utf8');
    expect(source).toContain('VITE_WAVELENGTH_LOCAL_TREASURY_ADDRESS');
    expect(source).toContain('!PUBLIC_SHOWCASE.enabled');
    expect(source).toContain('Consolidate test funds');
    expect(source).toContain('sweepAll: false');
    expect(source).toContain('I reviewed the destination and protected reserve');
    expect(source).toContain('validateLocalDemoConsolidationQuote');
  });
});
