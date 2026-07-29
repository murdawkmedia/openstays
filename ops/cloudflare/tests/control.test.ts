import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MerchantControl } from '../container/control.mjs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const {
    dirname,
    isAbsolute,
    relative,
    sep,
  } = await import('node:path');
  return {
    ...actual,
    renameSync(source: string, destination: string) {
      const relationship = relative(dirname(destination), source);
      if (
        relationship === '..'
        || relationship.startsWith(`..${sep}`)
        || isAbsolute(relationship)
      ) {
        const error = new Error(
          `EXDEV: cross-device link not permitted, rename '${source}' -> '${destination}'`,
        ) as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }
      return actual.renameSync(source, destination);
    },
  };
});

vi.mock('../container/backup.mjs', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../container/backup.mjs')
  >();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return {
    ...actual,
    backupWallet(
      _walletDirectory: string,
      outputPath: string,
      base64Key: string,
    ) {
      if (Buffer.from(base64Key, 'base64').byteLength !== 32) {
        throw new Error('BACKUP_KEY_MUST_BE_32_BYTES');
      }
      const bytes = Buffer.from('encrypted-wallet');
      writeFileSync(outputPath, bytes);
      return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
      };
    },
    restoreWallet(
      _inputPath: string,
      outputDirectory: string,
      _base64Key: string,
    ) {
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(join(outputDirectory, 'wallet.db'), 'restored-wallet');
    },
  };
});

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
  it('stages a restored wallet on the destination filesystem before atomic rename', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openstays-control-restore-'));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'state', 'wavelength');
    const backupKeyBase64 = Buffer.alloc(32, 7).toString('base64');
    mkdirSync(join(root, 'state'), { recursive: true });
    const bytes = Buffer.from('valid-test-backup');
    const control = new MerchantControl({
      walletDirectory,
      backupKeyBase64,
    });

    await control.restore(
      bytes,
      createHash('sha256').update(bytes).digest('hex'),
    );

    expect(readFileSync(join(walletDirectory, 'wallet.db'), 'utf8')).toBe(
      'restored-wallet',
    );
  });

  it('creates one signet wallet without returning or logging its password', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openstays-control-'));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const requests: Array<{ url: string; body: string }> = [];
    const words = Array.from({ length: 24 }, () => 'word');
    const fetchDaemon = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? '') });
      if (String(url).endsWith('/v1/daemon/get-info')) {
        return new Response(JSON.stringify({ code: 'FAILED_PRECONDITION' }), {
          status: 412,
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
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:10031/v1/daemon/get-info',
    );
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

  it('quiesces only the daemon while archiving a live wallet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openstays-control-backup-'));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const daemon = fakeChild();
    const worker = fakeChild();
    const children = [daemon, worker];
    const control = new MerchantControl({
      walletDirectory,
      backupKeyBase64: Buffer.alloc(32, 9).toString('base64'),
      walletPassword: 'merchant-test-password',
      release: 'test',
      daemonCommand: { file: 'waved', args: [], env: {} },
      workerCommands: [{ file: 'bridge', args: [], env: {} }],
      spawnCommand: vi.fn(() => children.shift()!),
      fetchDaemon: vi.fn(async (url: string | URL | Request) => (
        String(url).endsWith('/create')
          ? new Response(JSON.stringify({
              mnemonic: Array.from({ length: 24 }, () => 'word'),
            }))
          : new Response('{}')
      )),
      wait: vi.fn(),
    });

    await control.bootstrap();
    writeFileSync(join(walletDirectory, 'wallet.db'), 'live-wallet');
    control.backup(join(root, 'wallet.tar.gz.enc'));

    expect(daemon.kill).toHaveBeenNthCalledWith(1, 'SIGSTOP');
    expect(daemon.kill).toHaveBeenNthCalledWith(2, 'SIGCONT');
    expect(worker.kill).not.toHaveBeenCalled();
    control.stop();
  });

  it('always resumes the daemon when live-wallet archiving fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openstays-control-backup-fail-'));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const daemon = fakeChild();
    const control = new MerchantControl({
      walletDirectory,
      backupKeyBase64: Buffer.alloc(31, 9).toString('base64'),
      walletPassword: 'merchant-test-password',
      release: 'test',
      daemonCommand: { file: 'waved', args: [], env: {} },
      workerCommands: [],
      spawnCommand: vi.fn(() => daemon),
      fetchDaemon: vi.fn(async (url: string | URL | Request) => (
        String(url).endsWith('/create')
          ? new Response(JSON.stringify({
              mnemonic: Array.from({ length: 24 }, () => 'word'),
            }))
          : new Response('{}')
      )),
      wait: vi.fn(),
    });

    await control.bootstrap();
    writeFileSync(join(walletDirectory, 'wallet.db'), 'live-wallet');

    expect(() => control.backup(join(root, 'wallet.tar.gz.enc')))
      .toThrow('BACKUP_KEY_MUST_BE_32_BYTES');
    expect(daemon.kill).toHaveBeenNthCalledWith(1, 'SIGSTOP');
    expect(daemon.kill).toHaveBeenNthCalledWith(2, 'SIGCONT');
    control.stop();
  });
});
