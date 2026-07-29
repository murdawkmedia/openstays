import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadTreasuryRuntimeConfig,
  runTreasuryOnce,
  type TreasuryJournal,
} from './waveTreasury.js';

const DESTINATION = 'tb1pytpd7rg5nf08ty0mn7wscvplgztnggzhz4kgr7c32dy2cs9r6mqst883u6';
const tempDirs: string[] = [];

async function journalDir() {
  const value = await mkdtemp(join(tmpdir(), 'openstays-treasury-'));
  tempDirs.push(value);
  return value;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function runtime(overrides: Record<string, string | undefined> = {}) {
  return loadTreasuryRuntimeConfig({
    WAVELENGTH_TREASURY_ENABLED: 'true',
    WAVELENGTH_TREASURY_DRY_RUN: 'true',
    WAVELENGTH_TREASURY_ADDRESS: DESTINATION,
    WAVELENGTH_TREASURY_RESERVE_SATS: '14520',
    WAVELENGTH_TREASURY_MIN_SWEEP_SATS: '5000',
    WAVELENGTH_TREASURY_COOLDOWN_MS: '86400000',
    WAVELENGTH_TREASURY_MAX_FEE_SATS: '1000',
    WAVELENGTH_REWARD_MAX_FEE_SATS: '210',
    ...overrides,
  });
}

describe('Wavelength treasury runtime configuration', () => {
  it('defaults to disabled dry-run and rejects mainnet-shaped destinations when enabled', () => {
    expect(loadTreasuryRuntimeConfig({})).toMatchObject({
      enabled: false,
      dryRun: true,
      reserveSats: 14_520,
      minSweepSats: 5_000,
      cooldownMs: 86_400_000,
    });
    expect(() => runtime({ WAVELENGTH_TREASURY_ADDRESS: 'bc1pmainnet' }))
      .toThrow('WAVELENGTH_TREASURY_ADDRESS');
  });
});

describe('runTreasuryOnce', () => {
  it('reports a dry-run preview without claiming or preparing a send', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/v1/daemon/get-info')) {
        return Response.json({ network: 'signet' });
      }
      if (url.endsWith('/v1/wallet/balance')) {
        return Response.json({ confirmed_sat: '40000' });
      }
      if (url.includes('/wavelength-bridge/treasury/preview?')) {
        return Response.json({
          status: 'dry_run',
          canClaim: false,
          requiredReserveSats: 14_520,
          authorizedAmountSats: 24_480,
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runTreasuryOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      runtime: runtime(),
      journalDir: await journalDir(),
    }, fetchFn as typeof fetch)).resolves.toMatchObject({
      status: 'dry_run',
      authorizedAmountSats: 24_480,
    });
    expect(calls.some((url) => url.endsWith('/treasury/claim'))).toBe(false);
    expect(calls.some((url) => url.endsWith('/v1/wallet/prepare-send'))).toBe(false);
  });

  it('journals, dispatches, and reconciles one exact bounded on-chain send', async () => {
    const dir = await journalDir();
    const calls: Array<{ url: string; body?: any }> = [];
    const quoteExpiresAtUnix = Math.floor(Date.now() / 1_000) + 600;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/v1/daemon/get-info')) return Response.json({ network: 'signet' });
      if (url.endsWith('/v1/wallet/balance')) return Response.json({ confirmed_sat: '40000' });
      if (url.includes('/wavelength-bridge/treasury/preview?')) {
        return Response.json({ status: 'eligible', canClaim: true, requiredReserveSats: 15_020, authorizedAmountSats: 23_980 });
      }
      if (url.endsWith('/wavelength-bridge/treasury/claim')) {
        return Response.json({ claimed: true, sweep: {
          _id: 'sweep_1', status: 'prepared', leaseToken: 'lease_1', network: 'signet',
          destinationAddress: DESTINATION, balanceSnapshotSats: 40_000,
          requiredReserveSats: 15_020, authorizedAmountSats: 23_980,
          feeAllowanceSats: 1_000,
        } });
      }
      if (url.endsWith('/v1/wallet/prepare-send')) {
        expect(body).toEqual({
          onchain_address: DESTINATION,
          amount_sat: 23_980,
          max_fee_sat: 1_000,
          sweep_all: false,
          note: 'OpenStays Signet treasury',
        });
        return Response.json({
          send_intent_id: 'intent_1',
          amount_sat: '23980',
          expected_fee_sat: '300',
          fee_known: true,
          expected_total_outflow_sat: '24280',
          total_outflow_known: true,
          rail: 'SEND_RAIL_ONCHAIN',
          quote_status: 'SEND_QUOTE_STATUS_COMPLETE',
          destination_summary: DESTINATION,
          expires_at_unix: quoteExpiresAtUnix,
        });
      }
      if (url.endsWith('/v1/wallet/send')) {
        expect(body).toEqual({ send_intent_id: 'intent_1' });
        return Response.json({
          entry: { id: 'activity_1' },
          actual_amount_sat: '23980',
          actual_fee_sat: '300',
          actual_total_outflow_sat: '24280',
        });
      }
      if (url.endsWith('/wavelength-bridge/treasury/dispatched')) {
        expect(body).toMatchObject({
          sweepId: 'sweep_1',
          destinationAddress: DESTINATION,
          rail: 'onchain',
          preparedAmountSats: 23_980,
          preparedFeeSats: 300,
          preparedTotalOutflowSats: 24_280,
          expiresAtUnix: quoteExpiresAtUnix,
          sendIntentId: 'intent_1',
          merchantActivityId: 'activity_1',
        });
        return Response.json({ dispatched: true, duplicate: false });
      }
      if (url.endsWith('/v1/wallet/inspect/activity')) {
        return Response.json({ entry: {
          id: 'activity_1',
          kind: 'ENTRY_KIND_SEND',
          status: 'ENTRY_STATUS_COMPLETE',
          amount_sat: '-23980',
          fee_sat: '300',
          request: { onchain_address: DESTINATION },
          progress: { txid: 'signet_tx_1' },
        } });
      }
      if (url.endsWith('/wavelength-bridge/treasury/completed')) {
        expect(body).toMatchObject({
          sweepId: 'sweep_1',
          actualAmountSats: 23_980,
          actualFeeSats: 300,
          actualTotalOutflowSats: 24_280,
          transactionId: 'signet_tx_1',
        });
        return Response.json({ completed: true, duplicate: false });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runTreasuryOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      runtime: runtime({ WAVELENGTH_TREASURY_DRY_RUN: 'false' }),
      journalDir: dir,
    }, fetchFn as typeof fetch)).resolves.toMatchObject({
      status: 'completed',
      sweepId: 'sweep_1',
      transactionId: 'signet_tx_1',
    });

    const journal = JSON.parse(await readFile(join(dir, 'sweep_1.json'), 'utf8')) as TreasuryJournal;
    expect(journal).toMatchObject({
      phase: 'completed',
      sweepId: 'sweep_1',
      sendIntentId: 'intent_1',
      merchantActivityId: 'activity_1',
      expiresAtUnix: quoteExpiresAtUnix,
      rail: 'onchain',
    });
    expect(calls.filter(({ url }) => url.endsWith('/v1/wallet/send'))).toHaveLength(1);
  });

  it('rejects an excessive quote before writing a dispatch journal or sending', async () => {
    const dir = await journalDir();
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return Response.json({ network: 'signet' });
      if (url.endsWith('/v1/wallet/balance')) return Response.json({ confirmed_sat: '40000' });
      if (url.includes('/wavelength-bridge/treasury/preview?')) return Response.json({ status: 'eligible', canClaim: true });
      if (url.endsWith('/wavelength-bridge/treasury/claim')) return Response.json({ claimed: true, sweep: {
        _id: 'sweep_fee', status: 'prepared', leaseToken: 'lease_fee', network: 'signet',
        destinationAddress: DESTINATION, balanceSnapshotSats: 40_000,
        requiredReserveSats: 14_520, authorizedAmountSats: 24_480, feeAllowanceSats: 1_000,
      } });
      if (url.endsWith('/v1/wallet/prepare-send')) return Response.json({
        send_intent_id: 'intent_fee', amount_sat: '24480', expected_fee_sat: '1001',
        fee_known: true, expected_total_outflow_sat: '25481', total_outflow_known: true,
        rail: 'SEND_RAIL_ONCHAIN', quote_status: 'SEND_QUOTE_STATUS_COMPLETE',
        destination_summary: DESTINATION, expires_at_unix: Math.floor(Date.now() / 1_000) + 600,
      });
      if (url.endsWith('/wavelength-bridge/treasury/failed')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          sweepId: 'sweep_fee',
          ambiguous: false,
          reason: 'TREASURY_FEE_MISMATCH',
        });
        return Response.json({ failed: true, reconciliationRequired: false });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runTreasuryOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      runtime: runtime({ WAVELENGTH_TREASURY_DRY_RUN: 'false' }),
      journalDir: dir,
    }, fetchFn as typeof fetch)).resolves.toMatchObject({ status: 'failed_before_dispatch' });
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/v1/wallet/send'))).toBe(false);
  });

  it('never retries an ambiguous send after a crash-before-response journal', async () => {
    const dir = await journalDir();
    const journal: TreasuryJournal = {
      version: 1,
      sweepId: 'sweep_ambiguous',
      phase: 'dispatching',
      destinationAddress: DESTINATION,
      authorizedAmountSats: 10_000,
      preparedAmountSats: 10_000,
      preparedFeeSats: 200,
      preparedTotalOutflowSats: 10_200,
      expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
      rail: 'onchain',
      sendIntentId: 'intent_ambiguous',
      updatedAt: Date.now(),
    };
    await writeFile(join(dir, 'sweep_ambiguous.json'), JSON.stringify(journal), 'utf8');
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return Response.json({ network: 'signet' });
      if (url.endsWith('/v1/wallet/balance')) return Response.json({ confirmed_sat: '30000' });
      if (url.includes('/wavelength-bridge/treasury/preview?')) return Response.json({ status: 'unresolved_transfer', canClaim: false });
      if (url.endsWith('/wavelength-bridge/treasury/claim')) return Response.json({ claimed: true, resumed: true, sweep: {
        _id: 'sweep_ambiguous', status: 'prepared', leaseToken: 'lease_ambiguous', network: 'signet',
        destinationAddress: DESTINATION, balanceSnapshotSats: 30_000,
        requiredReserveSats: 14_520, authorizedAmountSats: 10_000, feeAllowanceSats: 1_000,
      } });
      if (url.endsWith('/wavelength-bridge/treasury/failed')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          sweepId: 'sweep_ambiguous',
          ambiguous: true,
        });
        return Response.json({ failed: true, reconciliationRequired: true });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runTreasuryOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      runtime: runtime({ WAVELENGTH_TREASURY_DRY_RUN: 'false' }),
      journalDir: dir,
    }, fetchFn as typeof fetch)).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/v1/wallet/send'))).toBe(false);
  });

  it('rejects mainnet before contacting OpenStays', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/daemon/get-info')) return Response.json({ network: 'mainnet' });
      throw new Error(`unexpected ${url}`);
    });
    await expect(runTreasuryOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      runtime: runtime(),
      journalDir: await journalDir(),
    }, fetchFn as typeof fetch)).rejects.toThrow('INVALID_WAVELENGTH_DAEMON_NETWORK');
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('/wavelength-bridge/treasury'))).toBe(false);
  });
});
