export const DEMO_WALLET_ATTEMPT_SATS = 1_000;
export const DEMO_WALLET_TARGET_ATTEMPTS = 12;
export const DEMO_WALLET_TARGET_SATS =
  DEMO_WALLET_ATTEMPT_SATS * DEMO_WALLET_TARGET_ATTEMPTS;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
export const LOCAL_CONSOLIDATION_RESERVE_SATS = 1_000;
export const LOCAL_CONSOLIDATION_MAX_FEE_SATS = 1_000;
export const LOCAL_CONSOLIDATION_MIN_SATS = 5_000;

export function isLocalDemoWalletSetup(hostname: string, setupFlag: string | null) {
  return setupFlag === '1' && LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function demoWalletAttemptsFunded(spendableSats: number) {
  return Math.max(0, Math.floor(spendableSats / DEMO_WALLET_ATTEMPT_SATS));
}

interface ConsolidationPreviewInput {
  hostname: string;
  setupFlag: string | null;
  publicShowcase: boolean;
  destinationAddress?: string;
  spendableSats: number;
}

export type LocalConsolidationPreview =
  | {
    allowed: true;
    amountSats: number;
    reserveSats: number;
    maxFeeSats: number;
  }
  | {
    allowed: false;
    reason: string;
    amountSats: 0;
    reserveSats: number;
    maxFeeSats: number;
  };

function signetTaprootAddress(value: string | undefined): value is string {
  return Boolean(value && /^tb1p[0-9a-z]{20,100}$/.test(value.trim()));
}

export function localDemoConsolidationPreview(
  input: ConsolidationPreviewInput,
): LocalConsolidationPreview {
  const denied = (reason: string): LocalConsolidationPreview => ({
    allowed: false,
    reason,
    amountSats: 0,
    reserveSats: LOCAL_CONSOLIDATION_RESERVE_SATS,
    maxFeeSats: LOCAL_CONSOLIDATION_MAX_FEE_SATS,
  });
  if (input.publicShowcase) return denied('Excluded from public builds.');
  if (!isLocalDemoWalletSetup(input.hostname, input.setupFlag)) {
    return denied('Explicit localhost demo setup is required.');
  }
  if (!signetTaprootAddress(input.destinationAddress)) {
    return denied('A Signet treasury address must be configured.');
  }
  if (!Number.isSafeInteger(input.spendableSats) || input.spendableSats < 0) {
    return denied('Wallet balance is invalid.');
  }
  const amountSats = input.spendableSats
    - LOCAL_CONSOLIDATION_RESERVE_SATS
    - LOCAL_CONSOLIDATION_MAX_FEE_SATS;
  if (amountSats < LOCAL_CONSOLIDATION_MIN_SATS) {
    return denied('Excess balance is below the consolidation minimum.');
  }
  return {
    allowed: true,
    amountSats,
    reserveSats: LOCAL_CONSOLIDATION_RESERVE_SATS,
    maxFeeSats: LOCAL_CONSOLIDATION_MAX_FEE_SATS,
  };
}

interface LocalConsolidationQuote {
  network: string;
  destinationSummary: string;
  amountSat: number;
  expectedFeeSat: number;
  feeKnown: boolean;
  expectedTotalOutflowSat: number;
  totalOutflowKnown: boolean;
  rail: string;
  quoteStatus: string;
  expiresAtUnix: number;
}

interface LocalConsolidationQuotePolicy {
  destinationAddress: string;
  spendableSats: number;
  amountSats: number;
  reserveSats: number;
  maxFeeSats: number;
  now: number;
}

export function validateLocalDemoConsolidationQuote(
  quote: LocalConsolidationQuote,
  policy: LocalConsolidationQuotePolicy,
): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (quote.network !== 'signet') return fail('Signet quote required.');
  if (
    !signetTaprootAddress(policy.destinationAddress)
    || quote.destinationSummary !== policy.destinationAddress
  ) return fail('Treasury destination does not match.');
  if (!quote.rail.toLowerCase().replaceAll('_', '').includes('onchain')) {
    return fail('On-chain quote required.');
  }
  if (quote.quoteStatus.toLowerCase() !== 'complete') return fail('Complete quote required.');
  if (quote.amountSat !== policy.amountSats || quote.amountSat <= 0) {
    return fail('Prepared amount does not match.');
  }
  if (
    !quote.feeKnown
    || !Number.isSafeInteger(quote.expectedFeeSat)
    || quote.expectedFeeSat < 0
    || quote.expectedFeeSat > policy.maxFeeSats
  ) return fail('Fee exceeds the local safety ceiling.');
  if (
    !quote.totalOutflowKnown
    || quote.expectedTotalOutflowSat !== quote.amountSat + quote.expectedFeeSat
  ) return fail('Total outflow is not authoritative.');
  if (quote.expectedTotalOutflowSat > policy.spendableSats - policy.reserveSats) {
    return fail('Prepared transfer crosses the protected reserve.');
  }
  if (
    !Number.isSafeInteger(quote.expiresAtUnix)
    || quote.expiresAtUnix * 1_000 <= policy.now + 30_000
  ) return fail('Prepared quote expired.');
  return { ok: true };
}
