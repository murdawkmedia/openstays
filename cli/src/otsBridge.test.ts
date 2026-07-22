import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runOtsBridgeOnce, type OtsRunner } from './otsBridge.js';

describe('runOtsBridgeOnce', () => {
  it('verifies canonical bytes and publishes a calendar proof', async () => {
    const canonicalJson = '{"schema":"openstays.consensus-receipt.v1"}';
    const sha256 = createHash('sha256').update(canonicalJson).digest('hex');
    const runner: OtsRunner = { stamp: vi.fn(async () => ({ proofBase64: 'cHJvb2Y=', calendarCount: 2 })),
      upgrade: vi.fn(async () => null) };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/ots-bridge/pending')) return new Response(JSON.stringify({ receipts: [{
        _id: 'receipt_1', work: 'stamp', leaseToken: 'lease_1', canonicalJson, sha256,
      }] }), { status: 200 });
      if (url.endsWith('/ots-bridge/proof')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer ots-secret' });
        expect(JSON.parse(String(init?.body))).toEqual({ receiptId: 'receipt_1', leaseToken: 'lease_1', sha256,
          proofBase64: 'cHJvb2Y=', calendarCount: 2 });
        return new Response(JSON.stringify({ published: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runOtsBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'ots-secret' },
      runner, fetchFn as typeof fetch)).resolves.toEqual({ stamped: 1, anchored: 0, failed: 0 });
  });

  it('reports a hash mismatch without calling the stamper', async () => {
    const runner: OtsRunner = { stamp: vi.fn(), upgrade: vi.fn() };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/ots-bridge/pending')) return new Response(JSON.stringify({ receipts: [{
        _id: 'receipt_bad', work: 'stamp', leaseToken: 'lease_bad', canonicalJson: '{}', sha256: '0'.repeat(64),
      }] }), { status: 200 });
      if (url.endsWith('/ots-bridge/failed')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ receiptId: 'receipt_bad', leaseToken: 'lease_bad', retryable: false });
        return new Response(JSON.stringify({ failed: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(runOtsBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'ots-secret' },
      runner, fetchFn as typeof fetch)).resolves.toEqual({ stamped: 0, anchored: 0, failed: 1 });
    expect(runner.stamp).not.toHaveBeenCalled();
  });
});
