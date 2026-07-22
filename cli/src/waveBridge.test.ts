import { describe, expect, it, vi } from 'vitest';
import { runWaveBridgeOnce } from './waveBridge.js';

describe('runWaveBridgeOnce', () => {
  it('creates a daemon invoice and publishes it to OpenStays', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/wavelength-bridge/pending')) {
        return new Response(JSON.stringify({ requests: [{
          _id: 'request_1', status: 'claimed', satsAmount: 21_000, expiresAt: 2_000_000_000_000,
          bookingId: 'booking_1',
        }] }), { status: 200 });
      }
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
    }, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, invoices: 1, settlements: 0 });

    const recv = calls.find((call) => call.url.endsWith('/v1/wallet/recv'))!;
    expect(JSON.parse(String(recv.init?.body))).toEqual({ amt_sat: 21_000, memo: 'OpenStays booking booking_1' });
    const publish = calls.find((call) => call.url.endsWith('/wavelength-bridge/invoice'))!;
    expect(publish.init?.headers).toMatchObject({ Authorization: 'Bearer bridge-token' });
    expect(JSON.parse(String(publish.init?.body))).toMatchObject({
      requestId: 'request_1', bolt11: 'lntbs_invoice', bridgeActivityId: 'activity_1', satsAmount: 21_000,
    });
  });

  it('reports only an exact completed receive settlement', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/wavelength-bridge/pending')) {
        return new Response(JSON.stringify({ requests: [{
          _id: 'request_2', status: 'invoice_ready', satsAmount: 42_000, bolt11: 'lntbs_paid',
          bridgeActivityId: 'activity_2', expiresAt: 2_000_000_000_000,
        }] }), { status: 200 });
      }
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
          paymentHash: 'hash_2', satsAmount: 42_000,
        });
        return new Response(JSON.stringify({ settled: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runWaveBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-token', daemonUrl: 'http://127.0.0.1:10031',
    }, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, invoices: 0, settlements: 1 });
  });
});
