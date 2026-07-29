import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface TreasuryRuntimeConfig {
  enabled: boolean;
  dryRun: boolean;
  destinationAddress?: string;
  reserveSats: number;
  minSweepSats: number;
  cooldownMs: number;
  maxFeeSats: number;
  rewardMaxFeeSats: number;
}

export interface TreasuryJournal {
  version: 1;
  sweepId: string;
  phase: 'prepared' | 'dispatching' | 'dispatched' | 'completed' | 'failed';
  destinationAddress: string;
  authorizedAmountSats: number;
  preparedAmountSats: number;
  preparedFeeSats: number;
  preparedTotalOutflowSats: number;
  rail: 'onchain';
  expiresAtUnix: number;
  sendIntentId: string;
  merchantActivityId?: string;
  transactionId?: string;
  updatedAt: number;
}

export interface RunTreasuryConfig {
  openStaysUrl: string;
  bridgeToken: string;
  daemonUrl: string;
  daemonMacaroonHex?: string;
  runtime: TreasuryRuntimeConfig;
  journalDir: string;
}

interface TreasurySweep {
  _id: string;
  status: 'prepared' | 'dispatched' | 'completed' | 'failed' | 'reconciliation_required';
  leaseToken: string;
  network: 'signet';
  destinationAddress: string;
  balanceSnapshotSats: number;
  requiredReserveSats: number;
  authorizedAmountSats: number;
  feeAllowanceSats: number;
  preparedAmountSats?: number;
  preparedFeeSats?: number;
  preparedTotalOutflowSats?: number;
  sendIntentId?: string;
  merchantActivityId?: string;
}

interface PreparedSend {
  send_intent_id: string;
  amount_sat: string | number;
  expected_fee_sat: string | number;
  fee_known: boolean;
  expected_total_outflow_sat: string | number;
  total_outflow_known: boolean;
  rail: string;
  quote_status: string;
  destination_summary: string;
  expires_at_unix: number;
}

class TreasurySafetyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function nonNegativeInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative integer.`);
  return parsed;
}

function signetAddress(address: string | undefined): address is string {
  return Boolean(address && /^tb1p[0-9a-z]{20,100}$/.test(address));
}

export function loadTreasuryRuntimeConfig(
  env: Record<string, string | undefined>,
): TreasuryRuntimeConfig {
  const enabled = env.WAVELENGTH_TREASURY_ENABLED === 'true';
  const dryRun = env.WAVELENGTH_TREASURY_DRY_RUN !== 'false';
  const destinationAddress = env.WAVELENGTH_TREASURY_ADDRESS?.trim() || undefined;
  if (enabled && !signetAddress(destinationAddress)) {
    throw new Error('WAVELENGTH_TREASURY_ADDRESS must be a Signet taproot address.');
  }
  return {
    enabled,
    dryRun,
    destinationAddress,
    reserveSats: nonNegativeInteger(env, 'WAVELENGTH_TREASURY_RESERVE_SATS', 14_520),
    minSweepSats: nonNegativeInteger(env, 'WAVELENGTH_TREASURY_MIN_SWEEP_SATS', 5_000),
    cooldownMs: nonNegativeInteger(env, 'WAVELENGTH_TREASURY_COOLDOWN_MS', 86_400_000),
    maxFeeSats: nonNegativeInteger(env, 'WAVELENGTH_TREASURY_MAX_FEE_SATS', 1_000),
    rewardMaxFeeSats: nonNegativeInteger(env, 'WAVELENGTH_REWARD_MAX_FEE_SATS', 210),
  };
}

function daemonHeaders(config: RunTreasuryConfig): Record<string, string> {
  return config.daemonMacaroonHex ? { Macaroon: config.daemonMacaroonHex } : {};
}

async function jsonRequest<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchFn(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${await response.text()}`);
  return await response.json() as T;
}

function journalPath(journalDir: string, sweepId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sweepId)) throw new Error('INVALID_TREASURY_SWEEP_ID');
  return join(journalDir, `${sweepId}.json`);
}

export async function loadTreasuryJournal(
  journalDir: string,
  sweepId: string,
): Promise<TreasuryJournal | null> {
  try {
    const parsed = JSON.parse(await readFile(journalPath(journalDir, sweepId), 'utf8')) as TreasuryJournal;
    if (parsed.version !== 1 || parsed.sweepId !== sweepId) throw new Error('INVALID_TREASURY_JOURNAL');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeTreasuryJournal(
  journalDir: string,
  journal: TreasuryJournal,
): Promise<void> {
  const destination = journalPath(journalDir, journal.sweepId);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
}

function previewUrl(config: RunTreasuryConfig, spendableSats: number): string {
  const params = new URLSearchParams({
    enabled: String(config.runtime.enabled),
    dryRun: String(config.runtime.dryRun),
    network: 'signet',
    destinationAddress: config.runtime.destinationAddress ?? '',
    spendableSats: String(spendableSats),
    baseReserveSats: String(config.runtime.reserveSats),
    minSweepSats: String(config.runtime.minSweepSats),
    cooldownMs: String(config.runtime.cooldownMs),
    treasuryFeeAllowanceSats: String(config.runtime.maxFeeSats),
    rewardFeeAllowanceSats: String(config.runtime.rewardMaxFeeSats),
  });
  return `${config.openStaysUrl.replace(/\/$/, '')}/wavelength-bridge/treasury/preview?${params}`;
}

function claimBody(config: RunTreasuryConfig, spendableSats: number) {
  return {
    enabled: config.runtime.enabled,
    dryRun: config.runtime.dryRun,
    network: 'signet',
    destinationAddress: config.runtime.destinationAddress ?? '',
    spendableSats,
    baseReserveSats: config.runtime.reserveSats,
    minSweepSats: config.runtime.minSweepSats,
    cooldownMs: config.runtime.cooldownMs,
    treasuryFeeAllowanceSats: config.runtime.maxFeeSats,
    rewardFeeAllowanceSats: config.runtime.rewardMaxFeeSats,
  };
}

function validatePrepared(
  sweep: TreasurySweep,
  prepared: PreparedSend,
  now: number,
): void {
  const amount = Number(prepared.amount_sat);
  const fee = Number(prepared.expected_fee_sat);
  const total = Number(prepared.expected_total_outflow_sat);
  const rail = prepared.rail.toUpperCase();
  const quoteStatus = prepared.quote_status.toUpperCase();
  if (
    sweep.network !== 'signet'
    || !signetAddress(sweep.destinationAddress)
    || prepared.destination_summary !== sweep.destinationAddress
  ) throw new TreasurySafetyError('TREASURY_DESTINATION_MISMATCH');
  if (!rail.includes('ONCHAIN') || !quoteStatus.includes('COMPLETE')) {
    throw new TreasurySafetyError('TREASURY_RAIL_MISMATCH');
  }
  if (
    !prepared.send_intent_id?.trim()
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount !== sweep.authorizedAmountSats
  ) throw new TreasurySafetyError('TREASURY_AMOUNT_MISMATCH');
  if (
    !prepared.fee_known
    || !prepared.total_outflow_known
    || !Number.isSafeInteger(fee)
    || fee < 0
    || fee > sweep.feeAllowanceSats
    || !Number.isSafeInteger(total)
    || total !== amount + fee
  ) throw new TreasurySafetyError('TREASURY_FEE_MISMATCH');
  if (total > sweep.balanceSnapshotSats - sweep.requiredReserveSats) {
    throw new TreasurySafetyError('TREASURY_RESERVE_CROSSING');
  }
  if (!Number.isSafeInteger(prepared.expires_at_unix) || prepared.expires_at_unix * 1_000 <= now + 30_000) {
    throw new TreasurySafetyError('TREASURY_QUOTE_EXPIRED');
  }
}

function journalFromPrepared(sweep: TreasurySweep, prepared: PreparedSend): TreasuryJournal {
  return {
    version: 1,
    sweepId: sweep._id,
    phase: 'prepared',
    destinationAddress: sweep.destinationAddress,
    authorizedAmountSats: sweep.authorizedAmountSats,
    preparedAmountSats: Number(prepared.amount_sat),
    preparedFeeSats: Number(prepared.expected_fee_sat),
    preparedTotalOutflowSats: Number(prepared.expected_total_outflow_sat),
    rail: 'onchain',
    expiresAtUnix: prepared.expires_at_unix,
    sendIntentId: prepared.send_intent_id.trim(),
    updatedAt: Date.now(),
  };
}

function onchainAddress(entry: any): string {
  return entry?.request?.onchain_address
    ?? entry?.request?.onchainAddress
    ?? entry?.request?.onchain?.address
    ?? '';
}

function entryComplete(entry: any): boolean {
  const status = String(entry?.status ?? '').toUpperCase();
  return status === 'COMPLETE' || status.endsWith('_COMPLETE');
}

function entryFailed(entry: any): boolean {
  const status = String(entry?.status ?? '').toUpperCase();
  return status === 'FAILED' || status.endsWith('_FAILED');
}

async function reportFailure(
  fetchFn: typeof fetch,
  openStaysUrl: string,
  headers: Record<string, string>,
  sweep: TreasurySweep,
  reason: string,
  ambiguous: boolean,
  merchantActivityId?: string,
) {
  return await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/treasury/failed`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      reason,
      ambiguous,
      merchantActivityId,
    }),
  });
}

export async function runTreasuryOnce(
  config: RunTreasuryConfig,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const openStaysUrl = config.openStaysUrl.replace(/\/$/, '');
  const daemonUrl = config.daemonUrl.replace(/\/$/, '');
  const authHeaders = { Authorization: `Bearer ${config.bridgeToken}` };
  const localHeaders = daemonHeaders(config);
  const info = await jsonRequest<{ network?: string }>(
    fetchFn,
    `${daemonUrl}/v1/daemon/get-info`,
    { method: 'POST', headers: { ...localHeaders, 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (info.network !== 'signet') throw new Error('INVALID_WAVELENGTH_DAEMON_NETWORK');
  if (!config.runtime.enabled && !config.runtime.dryRun) {
    return { status: 'disabled' };
  }
  const balance = await jsonRequest<{ confirmed_sat?: string | number }>(
    fetchFn,
    `${daemonUrl}/v1/wallet/balance`,
    { method: 'POST', headers: { ...localHeaders, 'Content-Type': 'application/json' }, body: '{}' },
  );
  const spendableSats = Number(balance.confirmed_sat);
  if (!Number.isSafeInteger(spendableSats) || spendableSats < 0) {
    throw new Error('INVALID_WAVELENGTH_BALANCE');
  }
  const preview = await jsonRequest<Record<string, unknown>>(
    fetchFn,
    previewUrl(config, spendableSats),
    { headers: authHeaders },
  );
  if (config.runtime.dryRun || !config.runtime.enabled) return preview;
  if (preview.canClaim !== true && preview.status !== 'unresolved_transfer') return preview;

  const claimed = await jsonRequest<{
    claimed: boolean;
    reason?: string;
    sweep?: TreasurySweep;
  }>(
    fetchFn,
    `${openStaysUrl}/wavelength-bridge/treasury/claim`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(claimBody(config, spendableSats)),
    },
  );
  if (!claimed.claimed || !claimed.sweep) {
    return { status: claimed.reason ?? 'not_claimed' };
  }
  const sweep = claimed.sweep;
  if (
    sweep.network !== 'signet'
    || sweep.destinationAddress !== config.runtime.destinationAddress
    || sweep.balanceSnapshotSats !== spendableSats
    || sweep.feeAllowanceSats !== config.runtime.maxFeeSats
  ) {
    throw new Error('TREASURY_CLAIM_MISMATCH');
  }
  if (sweep.status === 'reconciliation_required') {
    return { status: 'reconciliation_required', sweepId: sweep._id };
  }

  let journal = await loadTreasuryJournal(config.journalDir, sweep._id);
  if (sweep.status === 'prepared' && journal?.phase === 'dispatching' && !journal.merchantActivityId) {
    await reportFailure(
      fetchFn,
      openStaysUrl,
      authHeaders,
      sweep,
      'AMBIGUOUS_TREASURY_DISPATCH',
      true,
    );
    return { status: 'reconciliation_required', sweepId: sweep._id };
  }

  if (sweep.status === 'prepared' && (!journal || journal.phase === 'failed')) {
    let prepared: PreparedSend;
    try {
      prepared = await jsonRequest<PreparedSend>(
        fetchFn,
        `${daemonUrl}/v1/wallet/prepare-send`,
        {
          method: 'POST',
          headers: { ...localHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            onchain_address: sweep.destinationAddress,
            amount_sat: sweep.authorizedAmountSats,
            max_fee_sat: config.runtime.maxFeeSats,
            sweep_all: false,
            note: 'OpenStays Signet treasury',
          }),
        },
      );
      validatePrepared(sweep, prepared, Date.now());
    } catch (error) {
      const reason = error instanceof TreasurySafetyError
        ? error.code
        : 'TREASURY_PREPARE_FAILED';
      await reportFailure(fetchFn, openStaysUrl, authHeaders, sweep, reason, false);
      return { status: 'failed_before_dispatch', reason, sweepId: sweep._id };
    }
    journal = journalFromPrepared(sweep, prepared);
    await writeTreasuryJournal(config.journalDir, journal);
  }

  if (sweep.status === 'prepared' && journal?.phase === 'prepared') {
    journal = { ...journal, phase: 'dispatching', updatedAt: Date.now() };
    await writeTreasuryJournal(config.journalDir, journal);
    const sent = await jsonRequest<{
      entry?: { id?: string };
      actual_amount_sat?: string | number;
      actual_fee_sat?: string | number;
      actual_total_outflow_sat?: string | number;
    }>(
      fetchFn,
      `${daemonUrl}/v1/wallet/send`,
      {
        method: 'POST',
        headers: { ...localHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_intent_id: journal.sendIntentId }),
      },
    );
    const activityId = sent.entry?.id?.trim();
    if (
      !activityId
      || Number(sent.actual_amount_sat) !== journal.preparedAmountSats
      || Number(sent.actual_fee_sat) !== journal.preparedFeeSats
      || Number(sent.actual_total_outflow_sat) !== journal.preparedTotalOutflowSats
    ) {
      await reportFailure(
        fetchFn,
        openStaysUrl,
        authHeaders,
        sweep,
        'TREASURY_SEND_RESPONSE_MISMATCH',
        true,
      );
      return { status: 'reconciliation_required', sweepId: sweep._id };
    }
    journal = {
      ...journal,
      phase: 'dispatched',
      merchantActivityId: activityId,
      updatedAt: Date.now(),
    };
    await writeTreasuryJournal(config.journalDir, journal);
  }

  const preparedAmountSats = journal?.preparedAmountSats ?? sweep.preparedAmountSats;
  const preparedFeeSats = journal?.preparedFeeSats ?? sweep.preparedFeeSats;
  const preparedTotalOutflowSats =
    journal?.preparedTotalOutflowSats ?? sweep.preparedTotalOutflowSats;
  const sendIntentId = journal?.sendIntentId ?? sweep.sendIntentId;
  const merchantActivityId = journal?.merchantActivityId ?? sweep.merchantActivityId;
  if (
    !preparedAmountSats
    || preparedFeeSats === undefined
    || !preparedTotalOutflowSats
    || !sendIntentId
    || !merchantActivityId
    || journal?.rail !== 'onchain'
    || !Number.isSafeInteger(journal.expiresAtUnix)
  ) {
    await reportFailure(
      fetchFn,
      openStaysUrl,
      authHeaders,
      sweep,
      'TREASURY_DISPATCH_EVIDENCE_MISSING',
      true,
    );
    return { status: 'reconciliation_required', sweepId: sweep._id };
  }

  if (sweep.status === 'prepared') {
    await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/treasury/dispatched`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sweepId: sweep._id,
        leaseToken: sweep.leaseToken,
        network: 'signet',
        destinationAddress: sweep.destinationAddress,
        rail: journal?.rail,
        spendableSats: sweep.balanceSnapshotSats,
        preparedAmountSats,
        preparedFeeSats,
        preparedTotalOutflowSats,
        maxFeeSats: sweep.feeAllowanceSats,
        expiresAtUnix: journal?.expiresAtUnix,
        sendIntentId,
        merchantActivityId,
      }),
    });
  }

  const inspection = await jsonRequest<{ entry?: any }>(
    fetchFn,
    `${daemonUrl}/v1/wallet/inspect/activity`,
    {
      method: 'POST',
      headers: { ...localHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: merchantActivityId }),
    },
  );
  const entry = inspection.entry;
  if (
    entry?.id !== merchantActivityId
    || !String(entry?.kind ?? '').toUpperCase().endsWith('SEND')
    || onchainAddress(entry) !== sweep.destinationAddress
    || Number(entry?.amount_sat ?? entry?.amountSat) !== -preparedAmountSats
  ) {
    await reportFailure(
      fetchFn,
      openStaysUrl,
      authHeaders,
      sweep,
      'TREASURY_ACTIVITY_MISMATCH',
      true,
      merchantActivityId,
    );
    return { status: 'reconciliation_required', sweepId: sweep._id };
  }
  if (entryFailed(entry)) {
    await reportFailure(
      fetchFn,
      openStaysUrl,
      authHeaders,
      sweep,
      entry.failure_reason ?? entry.failureReason ?? 'TREASURY_ACTIVITY_FAILED',
      false,
      merchantActivityId,
    );
    return { status: 'failed', sweepId: sweep._id };
  }
  if (!entryComplete(entry)) return { status: 'dispatched', sweepId: sweep._id };

  const actualFeeSats = Number(entry.fee_sat ?? entry.feeSat);
  if (
    !Number.isSafeInteger(actualFeeSats)
    || actualFeeSats < 0
    || preparedAmountSats + actualFeeSats > sweep.balanceSnapshotSats - sweep.requiredReserveSats
  ) {
    await reportFailure(
      fetchFn,
      openStaysUrl,
      authHeaders,
      sweep,
      'TREASURY_ACTIVITY_OUTFLOW_MISMATCH',
      true,
      merchantActivityId,
    );
    return { status: 'reconciliation_required', sweepId: sweep._id };
  }
  const transactionId = entry.progress?.txid?.trim() || undefined;
  await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/treasury/completed`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sweepId: sweep._id,
      leaseToken: sweep.leaseToken,
      network: 'signet',
      destinationAddress: sweep.destinationAddress,
      merchantActivityId,
      sendIntentId,
      actualAmountSats: preparedAmountSats,
      actualFeeSats,
      actualTotalOutflowSats: preparedAmountSats + actualFeeSats,
      transactionId,
    }),
  });
  if (journal) {
    await writeTreasuryJournal(config.journalDir, {
      ...journal,
      phase: 'completed',
      transactionId,
      updatedAt: Date.now(),
    });
  }
  return {
    status: 'completed',
    sweepId: sweep._id,
    transactionId,
  };
}
