import { describe, expect, it, vi } from 'vitest';
import { runWaveBridgeOnce } from './waveBridge.js';

describe('runWaveBridgeOnce', () => {
  it('creates a daemon invoice and publishes it to OpenStays', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/daemon/get-info')) {
        return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/pending')) {
        return new Response(JSON.stringify({ requests: [{
          _id: 'request_1', status: 'claimed', network: 'signet', satsAmount: 21_000, expiresAt: 2_000_000_000_000,
          bookingId: 'booking_1',
        }] }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [] }), { status: 200 });
      if (url.endsWith('/v1/wallet/recv')) {
        return new Response(JSON.stringify({ invoice: 'lntbs_invoice', entry: { id: 'activity_1' } }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/invoice')) {
        return new Response(JSON.stringify({ published: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token', daemonUrl: 'http://127.0.0.1:10031',
      expectedNetwork: 'signet', daemonMacaroonHex: 'aabbcc',
    }, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, invoices: 1, settlements: 0, rewardsPaid: 0, rewardsFailed: 0 });

    const recv = calls.find((call) => call.url.endsWith('/v1/wallet/recv'))!;
    expect(recv.init?.headers).toMatchObject({ Macaroon: 'aabbcc' });
    expect(JSON.parse(String(recv.init?.body))).toEqual({ amt_sat: 21_000, memo: 'OpenStays booking booking_1' });
    const publish = calls.find((call) => call.url.endsWith('/wavelength-bridge/invoice'))!;
    expect(publish.init?.headers).toMatchObject({ Authorization: 'Bearer bridge-token' });
    expect(JSON.parse(String(publish.init?.body))).toMatchObject({
      requestId: 'request_1', network: 'signet', bolt11: 'lntbs_invoice', bridgeActivityId: 'activity_1', satsAmount: 21_000,
    });
  });

  it('reports only an exact completed receive settlement', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) {
        return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/pending')) {
        return new Response(JSON.stringify({ requests: [{
          _id: 'request_2', status: 'invoice_ready', network: 'signet', satsAmount: 42_000, bolt11: 'lntbs_paid',
          bridgeActivityId: 'activity_2', expiresAt: 2_000_000_000_000,
        }] }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [] }), { status: 200 });
      if (url.endsWith('/v1/wallet/inspect/activity')) {
        expect(JSON.parse(String(init?.body))).toEqual({ id: 'activity_2' });
        return new Response(JSON.stringify({ entry: {
          id: 'activity_2', kind: 'ENTRY_KIND_RECV', status: 'ENTRY_STATUS_COMPLETE', amount_sat: '42000',
          request: { lightning_invoice: { invoice: 'lntbs_paid', payment_hash: 'hash_2' } },
          progress: { payment_hash: 'hash_2' },
        } }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/settled')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          requestId: 'request_2', bolt11: 'lntbs_paid', bridgeActivityId: 'activity_2',
          paymentHash: 'hash_2', satsAmount: 42_000, network: 'signet',
        });
        return new Response(JSON.stringify({ settled: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token', daemonUrl: 'http://127.0.0.1:10031',
      expectedNetwork: 'signet', daemonMacaroonHex: 'aabbcc',
    }, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, invoices: 0, settlements: 1, rewardsPaid: 0, rewardsFailed: 0 });
  });

  it('reports an exact terminal failed receive so OpenStays can issue a fresh invoice', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [{
        _id: 'request_failed', status: 'invoice_ready', network: 'signet', satsAmount: 1_000,
        bolt11: 'lntbs10u1failed', bridgeActivityId: 'receive_failed', expiresAt: Date.now() + 600_000,
      }] }), { status: 200 });
      if (url.endsWith('/v1/wallet/inspect/activity')) return new Response(JSON.stringify({ entry: {
        id: 'receive_failed', kind: 'ENTRY_KIND_RECV', status: 'ENTRY_STATUS_FAILED', amount_sat: '1000',
        failure_reason: 'receive intent already used',
        request: { lightning_invoice: { invoice: 'lntbs10u1failed' } },
      } }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/failed')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          requestId: 'request_failed', network: 'signet', bolt11: 'lntbs10u1failed',
          bridgeActivityId: 'receive_failed', satsAmount: 1_000, terminalStatus: 'failed',
          reason: 'receive intent already used',
        });
        return new Response(JSON.stringify({ failed: true }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [] }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet',
    }, fetchFn as typeof fetch)).resolves.toEqual({
      claimed: 1, invoices: 0, settlements: 0, rewardsPaid: 0, rewardsFailed: 0,
    });
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/wavelength-bridge/failed'))).toBe(true);
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/wavelength-bridge/settled'))).toBe(false);
  });

  it('rejects a daemon/request network mismatch before creating an invoice', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/daemon/get-info')) {
        return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/pending')) {
        return new Response(JSON.stringify({ requests: [{
          _id: 'request_mainnet', status: 'claimed', network: 'mainnet', satsAmount: 210,
          expiresAt: 2_000_000_000_000,
        }] }), { status: 200 });
      }
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [] }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet',
      daemonMacaroonHex: 'aabbcc',
    }, fetchFn as typeof fetch)).rejects.toThrow('WAVELENGTH_REQUEST_NETWORK_MISMATCH');
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/v1/wallet/recv'))).toBe(false);
  });

  it('prepares, validates, sends, and reconciles an exact 1000-sat signet reward', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [{
        _id: 'reward_1', status: 'paying', network: 'signet', satsAmount: 1_000, bolt11: 'lntbs10u1guest',
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: 'lease_1',
      }] }), { status: 200 });
      if (url.endsWith('/v1/wallet/prepare-send')) return new Response(JSON.stringify({ send_intent_id: 'intent_1',
        amount_sat: '1000', expected_total_outflow_sat: '1001', total_outflow_known: true, rail: 'SEND_RAIL_LIGHTNING',
        payment_hash: 'reward_hash', expires_at_unix: Math.floor(Date.now() / 1000) + 600 }), { status: 200 });
      if (url.endsWith('/v1/wallet/send')) return new Response(JSON.stringify({ entry: { id: 'send_1' }, actual_amount_sat: '1000' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/dispatched')) return new Response(JSON.stringify({ dispatched: true }), { status: 200 });
      if (url.endsWith('/v1/wallet/inspect/activity')) return new Response(JSON.stringify({ entry: {
        id: 'send_1', kind: 'ENTRY_KIND_SEND', status: 'ENTRY_STATUS_COMPLETE', amount_sat: '-1000',
        request: { lightning_invoice: { invoice: 'lntbs10u1guest', payment_hash: 'reward_hash' } },
        progress: { payment_hash: 'reward_hash' },
      } }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/paid')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ rewardId: 'reward_1', leaseToken: 'lease_1',
          network: 'signet', satsAmount: 1_000, bolt11: 'lntbs10u1guest', merchantActivityId: 'send_1', paymentHash: 'reward_hash' });
        return new Response(JSON.stringify({ paid: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet', maxRewardFeeSats: 210 }, fetchFn as typeof fetch))
      .resolves.toEqual({ claimed: 0, invoices: 0, settlements: 0, rewardsPaid: 1, rewardsFailed: 0 });
  });

  it('does not reconcile a reward unless the completed activity is an exact outgoing 1000 sats', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [{
        _id: 'reward_wrong_direction', status: 'paying', network: 'signet', satsAmount: 1_000, bolt11: 'lntbs10u1guest',
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: 'lease_1', merchantActivityId: 'send_1', paymentHash: 'reward_hash',
      }] }), { status: 200 });
      if (url.endsWith('/v1/wallet/inspect/activity')) return new Response(JSON.stringify({ entry: {
        id: 'send_1', kind: 'ENTRY_KIND_SEND', status: 'ENTRY_STATUS_COMPLETE', amount_sat: '1000',
        request: { lightning_invoice: { invoice: 'lntbs10u1guest', payment_hash: 'reward_hash' } },
        progress: { payment_hash: 'reward_hash' },
      } }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    await expect(runWaveBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet' }, fetchFn as typeof fetch))
      .resolves.toEqual({ claimed: 0, invoices: 0, settlements: 0, rewardsPaid: 0, rewardsFailed: 0 });
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/wavelength-bridge/rewards/paid'))).toBe(false);
  });

  it.each([999, 1_001])('rejects a %i-sat reward before preparing a payment', async (satsAmount) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [{
        _id: `reward_${satsAmount}`, status: 'paying', network: 'signet', satsAmount, bolt11: 'lntbs1invalid',
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: 'lease_invalid',
      }] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/failed')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ retryable: false, reason: 'INVALID_SIGNET_REWARD' });
        return new Response(JSON.stringify({ failed: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet' }, fetchFn as typeof fetch))
      .resolves.toMatchObject({ rewardsPaid: 0, rewardsFailed: 1 });
    expect(calls.some(({ url }) => url.endsWith('/v1/wallet/prepare-send'))).toBe(false);
    expect(calls.some(({ url }) => url.endsWith('/wavelength-bridge/rewards/paid'))).toBe(false);
  });

  it('keeps a reward retryable when the daemon returns a transient server error', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [{
        _id: 'reward_retry', status: 'paying', network: 'signet', satsAmount: 1_000, bolt11: 'lntbs10u1retry',
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: 'lease_retry',
      }] }), { status: 200 });
      if (url.endsWith('/v1/wallet/prepare-send')) return new Response('temporarily unavailable', { status: 503 });
      if (url.endsWith('/wavelength-bridge/rewards/failed')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ rewardId: 'reward_retry', retryable: true });
        return new Response(JSON.stringify({ failed: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet' }, fetchFn as typeof fetch))
      .resolves.toMatchObject({ rewardsPaid: 0, rewardsFailed: 1 });
  });

  it('rejects a mainnet daemon before claiming work', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/daemon/get-info')) {
        return new Response(JSON.stringify({ network: 'mainnet' }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet',
      daemonMacaroonHex: 'aabbcc',
    }, fetchFn as typeof fetch)).rejects.toThrow('INVALID_WAVELENGTH_DAEMON_NETWORK');
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('/wavelength-bridge/pending'))).toBe(false);
  });

  it('runs the configured treasury dry-run after booking and reward reconciliation', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/daemon/get-info')) return Response.json({ network: 'signet' });
      if (url.endsWith('/wavelength-bridge/pending')) return Response.json({ requests: [] });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return Response.json({ rewards: [] });
      if (url.endsWith('/v1/wallet/balance')) return Response.json({ confirmed_sat: '40000' });
      if (url.includes('/wavelength-bridge/treasury/preview?')) {
        return Response.json({ status: 'dry_run', canClaim: false, authorizedAmountSats: 24_480 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example',
      bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031',
      expectedNetwork: 'signet',
      treasuryRuntime: {
        enabled: true,
        dryRun: true,
        destinationAddress: 'tb1pytpd7rg5nf08ty0mn7wscvplgztnggzhz4kgr7c32dy2cs9r6mqst883u6',
        reserveSats: 14_520,
        minSweepSats: 5_000,
        cooldownMs: 86_400_000,
        maxFeeSats: 1_000,
        rewardMaxFeeSats: 210,
      },
      treasuryJournalDir: 'unused-in-dry-run',
    } as any, fetchFn as typeof fetch)).resolves.toMatchObject({
      treasuryStatus: 'dry_run',
    });
  });
});
