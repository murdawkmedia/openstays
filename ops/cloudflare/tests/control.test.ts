import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MerchantControl } from '../container/control.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    kill(signal: string): boolean;
  };
  child.kill = vi.fn(() => true);
  return child;
}

describe('merchant wallet bootstrap control', () => {
  it('creates one signet wallet without returning or logging its password', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openstays-control-'));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const requests: Array<{ url: string; body: string }> = [];
    const words = Array.from({ length: 24 }, () => 'word');
    const fetchDaemon = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? '') });
      if (String(url).endsWith('/status')) {
        return new Response(JSON.stringify({ state: 'needs_wallet' }), {
          status: 200,
        });
      }
      if (String(url).endsWith('/create')) {
        return new Response(JSON.stringify({ mnemonic: words }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 404 });
    });
    const control = new MerchantControl({
      walletDirectory,
      backupKeyBase64: Buffer.alloc(32).toString('base64'),
      walletPassword: 'merchant-test-password',
      release: 'test',
      daemonCommand: { file: 'waved', args: [], env: {} },
      workerCommands: [{ file: 'bridge', args: [], env: {} }],
      spawnCommand: vi.fn(() => fakeChild()),
      fetchDaemon,
      wait: vi.fn(),
    });

    const created = await control.bootstrap();
    expect(created).toEqual({ mnemonic: words });
    expect(JSON.stringify(created)).not.toContain('merchant-test-password');
    const createRequest = requests.find(({ url }) => url.endsWith('/create'));
    expect(createRequest?.body).not.toContain('merchant-test-password');
    expect(JSON.parse(createRequest?.body ?? '{}')).toEqual({
      wallet_password: Buffer.from('merchant-test-password').toString('base64'),
    });
    await expect(control.bootstrap()).rejects.toThrow(
      'BOOTSTRAP_ALREADY_ATTEMPTED',
    );
    control.stop();
  });
});
