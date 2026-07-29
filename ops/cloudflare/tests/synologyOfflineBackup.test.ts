import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createOfflineBackup } from '../../synology/offline-backup.mjs';

describe('Synology offline wallet backup', () => {
  it('commits exact encrypted bytes while the merchant is stopped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openstays-offline-backup-'));
    const walletDirectory = join(root, 'state', 'wavelength');
    const stagingRoot = join(root, 'state', 'runtime');
    const backupRoot = join(root, 'backups');
    await mkdir(walletDirectory, { recursive: true });
    await mkdir(backupRoot);
    await writeFile(join(walletDirectory, 'wallet.db'), 'wallet');
    const encrypted = Buffer.from('encrypted-wallet');
    const commit = vi.fn(async (
      bytes: Buffer,
      release: string,
    ) => ({
      generation: 67,
      createdAt: new Date(0).toISOString(),
      release,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));

    const result = await createOfflineBackup({
      env: {
        OPENSTAYS_RELEASE: 'a'.repeat(40),
        WALLET_BACKUP_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      },
      walletDirectory,
      stagingRoot,
      backupRoot,
      backupWalletImpl: vi.fn(async (_wallet, outputPath) => {
        await writeFile(outputPath, encrypted);
        return {
          byteLength: encrypted.byteLength,
          sha256: createHash('sha256').update(encrypted).digest('hex'),
        };
      }),
      storeFactory: vi.fn(() => ({ commit })),
    });

    expect(commit).toHaveBeenCalledWith(encrypted, 'a'.repeat(40));
    expect(result).toMatchObject({
      generation: 67,
      release: 'a'.repeat(40),
      byteLength: encrypted.byteLength,
    });
    expect(await readdir(stagingRoot)).toEqual([]);
  });

  it('rejects an invalid backup key before touching durable state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openstays-offline-key-'));
    const walletDirectory = join(root, 'state', 'wavelength');
    const stagingRoot = join(root, 'state', 'runtime');
    const backupRoot = join(root, 'backups');
    await mkdir(walletDirectory, { recursive: true });
    await mkdir(backupRoot);
    const backupWalletImpl = vi.fn();

    await expect(createOfflineBackup({
      env: {
        OPENSTAYS_RELEASE: 'a'.repeat(40),
        WALLET_BACKUP_KEY_BASE64: Buffer.alloc(31).toString('base64'),
      },
      walletDirectory,
      stagingRoot,
      backupRoot,
      backupWalletImpl,
      storeFactory: vi.fn(),
    })).rejects.toThrow('WALLET_BACKUP_KEY_BASE64_INVALID');

    expect(backupWalletImpl).not.toHaveBeenCalled();
  });
});
