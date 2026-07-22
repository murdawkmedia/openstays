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

  it('prepares, validates, sends, and reconciles an exact 210-sat signet reward', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/daemon/get-info')) return new Response(JSON.stringify({ network: 'signet' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/pending')) return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/pending')) return new Response(JSON.stringify({ rewards: [{
        _id: 'reward_1', status: 'paying', network: 'signet', satsAmount: 210, bolt11: 'lntbs2100n1guest',
        invoiceExpiresAt: Date.now() + 600_000, leaseToken: 'lease_1',
      }] }), { status: 200 });
      if (url.endsWith('/v1/wallet/prepare-send')) return new Response(JSON.stringify({ send_intent_id: 'intent_1',
        amount_sat: '210', expected_total_outflow_sat: '211', total_outflow_known: true, rail: 'SEND_RAIL_LIGHTNING',
        payment_hash: 'reward_hash', expires_at_unix: Math.floor(Date.now() / 1000) + 600 }), { status: 200 });
      if (url.endsWith('/v1/wallet/send')) return new Response(JSON.stringify({ entry: { id: 'send_1' }, actual_amount_sat: '210' }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/dispatched')) return new Response(JSON.stringify({ dispatched: true }), { status: 200 });
      if (url.endsWith('/v1/wallet/inspect/activity')) return new Response(JSON.stringify({ entry: {
        id: 'send_1', kind: 'ENTRY_KIND_SEND', status: 'ENTRY_STATUS_COMPLETE', amount_sat: '210',
        request: { lightning_invoice: { invoice: 'lntbs2100n1guest', payment_hash: 'reward_hash' } },
        progress: { payment_hash: 'reward_hash' },
      } }), { status: 200 });
      if (url.endsWith('/wavelength-bridge/rewards/paid')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ rewardId: 'reward_1', leaseToken: 'lease_1',
          network: 'signet', satsAmount: 210, bolt11: 'lntbs2100n1guest', merchantActivityId: 'send_1', paymentHash: 'reward_hash' });
        return new Response(JSON.stringify({ paid: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token',
      daemonUrl: 'http://127.0.0.1:10031', expectedNetwork: 'signet', maxRewardFeeSats: 210 }, fetchFn as typeof fetch))
      .resolves.toEqual({ claimed: 0, invoices: 0, settlements: 0, rewardsPaid: 1, rewardsFailed: 0 });
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
});
