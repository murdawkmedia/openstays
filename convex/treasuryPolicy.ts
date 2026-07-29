export type TreasuryPreviewStatus =
  | 'eligible'
  | 'disabled'
  | 'dry_run'
  | 'invalid_network'
  | 'invalid_destination'
  | 'below_reserve'
  | 'below_minimum'
  | 'cooldown'
  | 'unresolved_transfer'
  | 'invalid_configuration';

export interface TreasuryPreviewInput {
  enabled: boolean;
  dryRun: boolean;
  network: string;
  destinationAddress: string;
  spendableSats: number;
  baseReserveSats: number;
  rewardLiabilitySats: number;
  refundLiabilitySats: number;
  feeAllowanceSats: number;
  minSweepSats: number;
  cooldownMs: number;
  lastCompletedAt?: number;
  unresolvedTransfer: boolean;
  now: number;
}

export interface TreasuryPreview {
  status: TreasuryPreviewStatus;
  canClaim: boolean;
  requiredReserveSats: number;
  excessOutflowSats: number;
  authorizedAmountSats: number;
}

function safeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isSignetTaprootAddress(address: string): boolean {
  return /^tb1p[0-9a-z]{20,100}$/.test(address.trim());
}

export function calculateTreasuryPreview(input: TreasuryPreviewInput): TreasuryPreview {
  const numericValues = [
    input.spendableSats,
    input.baseReserveSats,
    input.rewardLiabilitySats,
    input.refundLiabilitySats,
    input.feeAllowanceSats,
    input.minSweepSats,
    input.cooldownMs,
    input.now,
  ];
  if (!numericValues.every(safeNonNegativeInteger)) {
    return {
      status: 'invalid_configuration',
      canClaim: false,
      requiredReserveSats: 0,
      excessOutflowSats: 0,
      authorizedAmountSats: 0,
    };
  }

  const requiredReserveSats =
    Math.max(input.baseReserveSats, input.rewardLiabilitySats)
    + input.refundLiabilitySats;
  const excessOutflowSats = Math.max(0, input.spendableSats - requiredReserveSats);
  const authorizedAmountSats = Math.max(0, excessOutflowSats - input.feeAllowanceSats);
  const result = (status: TreasuryPreviewStatus, canClaim = false): TreasuryPreview => ({
    status,
    canClaim,
    requiredReserveSats,
    excessOutflowSats,
    authorizedAmountSats,
  });

  if (input.network !== 'signet') return result('invalid_network');
  if (!isSignetTaprootAddress(input.destinationAddress)) return result('invalid_destination');
  if (!input.enabled) return result('disabled');
  if (input.unresolvedTransfer) return result('unresolved_transfer');
  if (
    input.lastCompletedAt !== undefined
    && (
      !safeNonNegativeInteger(input.lastCompletedAt)
      || input.lastCompletedAt + input.cooldownMs > input.now
    )
  ) {
    return result('cooldown');
  }
  if (excessOutflowSats <= 0) return result('below_reserve');
  if (authorizedAmountSats < input.minSweepSats) return result('below_minimum');
  if (input.dryRun) return result('dry_run');
  return result('eligible', true);
}

export interface TreasuryQuoteInput {
  network: string;
  expectedDestination: string;
  actualDestination: string;
  rail: string;
  preparedAmountSats: number;
  expectedFeeSats: number;
  expectedTotalOutflowSats: number;
  totalOutflowKnown: boolean;
  maxFeeSats: number;
  spendableSats: number;
  requiredReserveSats: number;
  authorizedAmountSats: number;
  expiresAtUnix: number;
  now: number;
}

export type TreasuryQuoteValidation =
  | { ok: true }
  | { ok: false; code: string };

export function validateTreasuryQuote(input: TreasuryQuoteInput): TreasuryQuoteValidation {
  const fail = (code: string): TreasuryQuoteValidation => ({ ok: false, code });
  if (input.network !== 'signet') return fail('TREASURY_NETWORK_MISMATCH');
  if (
    !isSignetTaprootAddress(input.expectedDestination)
    || input.actualDestination.trim() !== input.expectedDestination.trim()
  ) {
    return fail('TREASURY_DESTINATION_MISMATCH');
  }
  const rail = input.rail.trim().toLowerCase().replaceAll('-', '_');
  if (!['onchain', 'on_chain', 'rail_onchain', 'rail_on_chain'].includes(rail)) {
    return fail('TREASURY_RAIL_MISMATCH');
  }
  const integers = [
    input.preparedAmountSats,
    input.expectedFeeSats,
    input.expectedTotalOutflowSats,
    input.maxFeeSats,
    input.spendableSats,
    input.requiredReserveSats,
    input.authorizedAmountSats,
    input.expiresAtUnix,
    input.now,
  ];
  if (!integers.every(safeNonNegativeInteger)) return fail('TREASURY_INVALID_QUOTE');
  if (
    input.preparedAmountSats <= 0
    || input.preparedAmountSats !== input.authorizedAmountSats
  ) {
    return fail('TREASURY_AMOUNT_MISMATCH');
  }
  if (!input.totalOutflowKnown) return fail('TREASURY_OUTFLOW_UNKNOWN');
  if (
    input.expectedFeeSats > input.maxFeeSats
    || input.expectedTotalOutflowSats
      !== input.preparedAmountSats + input.expectedFeeSats
  ) {
    return fail('TREASURY_FEE_MISMATCH');
  }
  if (
    input.expiresAtUnix * 1_000 <= input.now + 30_000
  ) {
    return fail('TREASURY_QUOTE_EXPIRED');
  }
  if (
    input.expectedTotalOutflowSats
      > input.spendableSats - input.requiredReserveSats
  ) {
    return fail('TREASURY_RESERVE_CROSSING');
  }
  return { ok: true };
}
