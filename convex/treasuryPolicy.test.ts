import { describe, expect, it } from 'vitest';

import {
  calculateTreasuryPreview,
  validateTreasuryQuote,
} from './treasuryPolicy';

const DESTINATION = 'tb1pytpd7rg5nf08ty0mn7wscvplgztnggzhz4kgr7c32dy2cs9r6mqst883u6';
const NOW = 1_800_000_000_000;

function preview(overrides: Partial<Parameters<typeof calculateTreasuryPreview>[0]> = {}) {
  return calculateTreasuryPreview({
    enabled: true,
    dryRun: false,
    network: 'signet',
    destinationAddress: DESTINATION,
    spendableSats: 40_000,
    baseReserveSats: 14_520,
    rewardLiabilitySats: 0,
    refundLiabilitySats: 0,
    feeAllowanceSats: 1_000,
    minSweepSats: 5_000,
    cooldownMs: 86_400_000,
    lastCompletedAt: undefined,
    unresolvedTransfer: false,
    now: NOW,
    ...overrides,
  });
}

describe('Signet treasury preview policy', () => {
  it('protects the greater of the base reserve or active rewards plus refunds', () => {
    expect(preview({
      rewardLiabilitySats: 18_000,
      refundLiabilitySats: 2_500,
    })).toMatchObject({
      requiredReserveSats: 20_500,
      excessOutflowSats: 19_500,
      authorizedAmountSats: 18_500,
      status: 'eligible',
      canClaim: true,
    });
  });

  it('uses the base floor when rewards are lower', () => {
    expect(preview({
      rewardLiabilitySats: 1_210,
      refundLiabilitySats: 1_000,
    })).toMatchObject({
      requiredReserveSats: 15_520,
      authorizedAmountSats: 23_480,
    });
  });

  it('fails closed for disabled, dry-run, wrong-network, and invalid-address modes', () => {
    expect(preview({ enabled: false })).toMatchObject({ status: 'disabled', canClaim: false });
    expect(preview({ dryRun: true })).toMatchObject({
      status: 'dry_run',
      canClaim: false,
      authorizedAmountSats: 24_480,
    });
    expect(preview({ network: 'mainnet' })).toMatchObject({ status: 'invalid_network', canClaim: false });
    expect(preview({ destinationAddress: 'bc1pmainnet' })).toMatchObject({
      status: 'invalid_destination',
      canClaim: false,
    });
  });

  it('skips balances below reserve or the minimum bounded principal', () => {
    expect(preview({ spendableSats: 14_520 })).toMatchObject({
      status: 'below_reserve',
      canClaim: false,
      authorizedAmountSats: 0,
    });
    expect(preview({ spendableSats: 20_000 })).toMatchObject({
      status: 'below_minimum',
      canClaim: false,
      authorizedAmountSats: 4_480,
    });
  });

  it('enforces cooldown and unresolved-transfer serialization', () => {
    expect(preview({ lastCompletedAt: NOW - 1_000 })).toMatchObject({
      status: 'cooldown',
      canClaim: false,
    });
    expect(preview({ unresolvedTransfer: true })).toMatchObject({
      status: 'unresolved_transfer',
      canClaim: false,
    });
  });
});

describe('Signet treasury quote validation', () => {
  const quote = {
    network: 'signet',
    expectedDestination: DESTINATION,
    actualDestination: DESTINATION,
    rail: 'onchain',
    preparedAmountSats: 10_000,
    expectedFeeSats: 300,
    expectedTotalOutflowSats: 10_300,
    totalOutflowKnown: true,
    maxFeeSats: 1_000,
    spendableSats: 30_000,
    requiredReserveSats: 14_520,
    authorizedAmountSats: 10_000,
    expiresAtUnix: Math.floor(NOW / 1_000) + 600,
    now: NOW,
  };

  it('accepts an exact bounded cooperative on-chain quote above reserve', () => {
    expect(validateTreasuryQuote(quote)).toEqual({ ok: true });
  });

  it('rejects network, destination, and rail mismatches', () => {
    expect(validateTreasuryQuote({ ...quote, network: 'mainnet' }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, actualDestination: `${DESTINATION}x` }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, rail: 'lightning' }).ok).toBe(false);
  });

  it('rejects expired, unknown, excessive, inconsistent, and reserve-crossing outflow', () => {
    expect(validateTreasuryQuote({ ...quote, expiresAtUnix: 1 }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, totalOutflowKnown: false }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, expectedFeeSats: 1_001, expectedTotalOutflowSats: 11_001 }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, expectedTotalOutflowSats: 10_301 }).ok).toBe(false);
    expect(validateTreasuryQuote({
      ...quote,
      spendableSats: 24_700,
      expectedTotalOutflowSats: 10_300,
    }).ok).toBe(false);
  });

  it('rejects a different or unbounded principal', () => {
    expect(validateTreasuryQuote({ ...quote, preparedAmountSats: 9_999 }).ok).toBe(false);
    expect(validateTreasuryQuote({ ...quote, preparedAmountSats: 0 }).ok).toBe(false);
  });
});
