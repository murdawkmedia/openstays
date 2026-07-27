import { describe, expect, it, vi } from 'vitest';

import {
  MerchantOperationsCoordinator,
  backupHealth,
} from '../src/merchantContainer';
import { sha256Hex, type BackupManifest } from '../src/backupManifest';

describe('merchant wallet restore safety', () => {
  it('never starts the daemon when the archive is missing', async () => {
    const start = vi.fn();
    const coordinator = new MerchantOperationsCoordinator({
      loadBackup: async () => null,
      restore: vi.fn(),
      start,
      createBackup: vi.fn(),
      commitBackup: vi.fn(),
    });
    await expect(coordinator.restoreAndStart()).rejects.toThrow('BACKUP_REQUIRED');
    expect(start).not.toHaveBeenCalled();
  });

  it('never starts the daemon when the restored ciphertext digest mismatches', async () => {
    const ciphertext = new TextEncoder().encode('encrypted-wallet');
    const manifest: BackupManifest = {
      version: 1,
      generation: 1,
      objectKey: 'wallet/1-bad.tar.gz.enc',
      sha256: '0'.repeat(64),
      byteLength: ciphertext.byteLength,
      createdAt: new Date().toISOString(),
      release: 'test',
    };
    const start = vi.fn();
    const coordinator = new MerchantOperationsCoordinator({
      loadBackup: async () => ({ manifest, ciphertext }),
      restore: vi.fn(),
      start,
      createBackup: vi.fn(),
      commitBackup: vi.fn(),
    });
    await expect(coordinator.restoreAndStart())
      .rejects.toThrow('BACKUP_DIGEST_MISMATCH');
    expect(start).not.toHaveBeenCalled();
  });

  it('restores before starting and persists dirty wallet activity', async () => {
    const ciphertext = new TextEncoder().encode('encrypted-wallet');
    const manifest: BackupManifest = {
      version: 1,
      generation: 1,
      objectKey: 'wallet/1-good.tar.gz.enc',
      sha256: await sha256Hex(ciphertext),
      byteLength: ciphertext.byteLength,
      createdAt: new Date().toISOString(),
      release: 'test',
    };
    const order: string[] = [];
    const newBackup = new TextEncoder().encode('new-encrypted-wallet');
    const coordinator = new MerchantOperationsCoordinator({
      loadBackup: async () => ({ manifest, ciphertext }),
      restore: async () => { order.push('restore'); },
      start: async () => { order.push('start'); },
      createBackup: async () => {
        order.push('backup');
        return newBackup;
      },
      commitBackup: async () => {
        order.push('commit');
        return { ...manifest, generation: 2 };
      },
    });
    await coordinator.restoreAndStart();
    coordinator.markDirty();
    await coordinator.backupIfDue(Date.now());
    expect(order).toEqual(['restore', 'start', 'backup', 'commit']);
  });

  it('does not lose wallet activity that arrives during a backup', async () => {
    const ciphertext = new TextEncoder().encode('encrypted-wallet');
    const manifest: BackupManifest = {
      version: 1,
      generation: 1,
      objectKey: 'wallet/1-good.tar.gz.enc',
      sha256: await sha256Hex(ciphertext),
      byteLength: ciphertext.byteLength,
      createdAt: new Date().toISOString(),
      release: 'test',
    };
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let backupCount = 0;
    const coordinator = new MerchantOperationsCoordinator({
      loadBackup: async () => ({ manifest, ciphertext }),
      restore: vi.fn(),
      start: vi.fn(),
      createBackup: async () => {
        backupCount += 1;
        if (backupCount === 1) await firstCanFinish;
        return new TextEncoder().encode(`backup-${backupCount}`);
      },
      commitBackup: async () => ({
        ...manifest,
        generation: backupCount + 1,
        createdAt: new Date().toISOString(),
      }),
    });
    await coordinator.restoreAndStart();
    coordinator.markDirty();
    const first = coordinator.backupIfDue(Date.now());
    coordinator.markDirty();
    releaseFirst();
    await first;
    await coordinator.backupIfDue(Date.now());
    expect(backupCount).toBe(2);
  });
});

describe('backup health', () => {
  it('fails closed when the latest verified backup is older than two minutes', () => {
    const now = Date.now();
    expect(backupHealth(now - 120_001, now)).toBe('failed');
    expect(backupHealth(now - 119_999, now)).toBe('ready');
    expect(backupHealth(undefined, now)).toBe('failed');
  });
});
