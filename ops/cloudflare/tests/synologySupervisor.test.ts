import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createControlServer } from '../container/control.mjs';
import { runOperator } from '../../synology/operator.mjs';
import { GenerationStore } from '../../synology/generationStore.mjs';
import {
  createMerchantSupervisorControl,
  createSupervisor,
  createSynologyRuntime,
  validateRuntimeIdentity,
} from '../../synology/supervisor.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.WALLET_BACKUP_OUTPUT_PATH;
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifest(
  bytes: Uint8Array,
  createdAt = new Date(1_000).toISOString(),
  generation = 1,
) {
  return {
    schema: 'openstays.synology-wallet-backup.v1',
    generation,
    createdAt,
    release: 'test-release',
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function controlDouble(overrides: Record<string, unknown> = {}) {
  return {
    restore: vi.fn(),
    start: vi.fn(),
    bootstrap: vi.fn(async () => ({
      mnemonic: Array.from({ length: 24 }, () => 'word'),
    })),
    backup: vi.fn(async () => Buffer.from('fresh-encrypted-wallet')),
    health: vi.fn(() => ({
      status: 'ready',
      release: 'test-release',
    })),
    stop: vi.fn(),
    ...overrides,
  };
}

function noTimer() {
  return {
    schedule: vi.fn(() => ({ timer: true })),
    clearSchedule: vi.fn(),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Synology restore-first lifecycle', () => {
  it('loads, quarantines, restores, and starts in order without deleting the live wallet', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-supervisor-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'surviving-wallet');
    const bytes = Buffer.from('verified-encrypted-wallet');
    const backup = { bytes, manifest: manifest(bytes) };
    const events: string[] = [];
    const control = controlDouble({
      restore: vi.fn(async () => {
        events.push('restore');
        await expect(access(walletDirectory)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }),
      start: vi.fn(async () => {
        events.push('start');
      }),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: vi.fn(async () => {
          events.push('load');
          return backup;
        }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          events.push('quarantine');
          await rename(from, to);
        },
      },
      ...timers,
    });

    await supervisor.start();

    expect(events).toEqual(['load', 'quarantine', 'restore', 'start']);
    expect(control.restore).toHaveBeenCalledWith(bytes, backup.manifest.sha256);
    const quarantineEntries = await readdir(quarantineRoot);
    expect(quarantineEntries).toHaveLength(1);
    expect(
      await readFile(
        join(quarantineRoot, quarantineEntries[0]!, 'wallet', 'wallet.db'),
        'utf8',
      ),
    ).toBe('surviving-wallet');
    await expect(access(walletDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('enters awaiting_bootstrap only when a backup is required', async () => {
    const control = controlDouble();
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => {
          throw new Error('BACKUP_REQUIRED');
        },
      },
      ...timers,
    });

    await supervisor.start();

    expect(supervisor.health()).toMatchObject({
      status: 'awaiting_bootstrap',
      release: 'test-release',
    });
    expect(control.restore).not.toHaveBeenCalled();
    expect(control.start).not.toHaveBeenCalled();
    expect(timers.schedule).not.toHaveBeenCalled();
  });

  it('latches concurrent start calls and restores only once', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    const loadCanFinish = deferred();
    const loadLatest = vi.fn(async () => {
      await loadCanFinish.promise;
      return { bytes, manifest: manifest(bytes) };
    });
    const control = controlDouble();
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: { loadLatest },
      ...timers,
    });

    const first = supervisor.start();
    const second = supervisor.start();

    expect(second).toBe(first);
    expect(loadLatest).toHaveBeenCalledOnce();
    loadCanFinish.resolve();
    await Promise.all([first, second]);
    expect(control.restore).toHaveBeenCalledOnce();
    expect(control.start).toHaveBeenCalledOnce();
    expect(timers.schedule).toHaveBeenCalledOnce();
  });

  it.each(['load', 'restore', 'start'])(
    'keeps the supervisor stopped when stop occurs during %s',
    async (stage) => {
      const bytes = Buffer.from('verified-encrypted-wallet');
      const entered = deferred();
      const canFinish = deferred();
      const control = controlDouble({
        restore: vi.fn(async () => {
          if (stage !== 'restore') return;
          entered.resolve();
          await canFinish.promise;
        }),
        start: vi.fn(async () => {
          if (stage !== 'start') return;
          entered.resolve();
          await canFinish.promise;
        }),
      });
      const timers = noTimer();
      const supervisor = createSupervisor({
        control,
        store: {
          loadLatest: async () => {
            if (stage === 'load') {
              entered.resolve();
              await canFinish.promise;
            }
            return { bytes, manifest: manifest(bytes) };
          },
        },
        ...timers,
      });

      const starting = supervisor.start();
      await entered.promise;
      supervisor.stop();
      canFinish.resolve();

      await expect(starting).rejects.toThrow(
        'SUPERVISOR_LIFECYCLE_ABORTED',
      );
      expect(supervisor.health()).toMatchObject({
        status: 'failed',
        failureCategory: 'stopped',
      });
      expect(timers.schedule).not.toHaveBeenCalled();
    },
  );

  it('keeps the supervisor stopped when stop occurs during quarantine durability', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-stop-during-quarantine-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    await mkdir(walletDirectory);
    const bytes = Buffer.from('verified-encrypted-wallet');
    const entered = deferred();
    const canFinish = deferred();
    const control = controlDouble();
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      directorySync: async () => {
        entered.resolve();
        await canFinish.promise;
      },
      ...timers,
    });

    const starting = supervisor.start();
    await entered.promise;
    supervisor.stop();
    canFinish.resolve();

    await expect(starting).rejects.toThrow('SUPERVISOR_LIFECYCLE_ABORTED');
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'stopped',
    });
    expect(control.restore).not.toHaveBeenCalled();
    expect(timers.schedule).not.toHaveBeenCalled();
  });

  it('fails closed when backup is missing but an uncommitted live wallet exists', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-uncommitted-wallet-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'uncommitted-wallet');
    const control = controlDouble();
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => {
          throw new Error('BACKUP_REQUIRED');
        },
      },
      walletDirectory,
      ...timers,
    });

    await expect(supervisor.start()).rejects.toThrow(
      'UNCOMMITTED_WALLET_PRESENT',
    );
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'uncommitted_wallet_present',
    });
    await expect(supervisor.bootstrap()).rejects.toThrow(
      'BOOTSTRAP_NOT_ALLOWED',
    );
    expect(control.bootstrap).not.toHaveBeenCalled();
  });

  it.each([
    ['load', 'BACKUP_VOLUME_IO_FAILED'],
    ['restore', 'RESTORE_AUTHENTICATION_FAILED'],
    ['start', 'WAVELENGTH_DAEMON_START_TIMEOUT'],
  ])('marks %s operational errors failed', async (stage, category) => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    const control = controlDouble({
      restore: vi.fn(async () => {
        if (stage === 'restore') throw new Error(category);
      }),
      start: vi.fn(async () => {
        if (stage === 'start') throw new Error(category);
      }),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => {
          if (stage === 'load') throw new Error(category);
          return { bytes, manifest: manifest(bytes) };
        },
      },
      ...timers,
    });

    await expect(supervisor.start()).rejects.toThrow(category);
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: category.toLowerCase(),
    });
  });
});

describe('Synology bootstrap transaction', () => {
  it('commits and reloads exact encrypted bytes before returning recovery words', async () => {
    const events: string[] = [];
    const words = Array.from({ length: 24 }, (_, index) => `word${index}`);
    const bytes = Buffer.from('fresh-encrypted-wallet');
    const committed = manifest(bytes, new Date(2_000).toISOString());
    let latest: { bytes: Buffer; manifest: ReturnType<typeof manifest> }
      | undefined;
    const control = controlDouble({
      bootstrap: vi.fn(async () => {
        events.push('bootstrap');
        return { mnemonic: words };
      }),
      backup: vi.fn(async () => {
        events.push('backup');
        return bytes;
      }),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: vi.fn(async () => {
          if (!latest) throw new Error('BACKUP_REQUIRED');
          events.push('verify');
          return latest;
        }),
        commit: vi.fn(async (value: Buffer) => {
          events.push('commit');
          latest = { bytes: Buffer.from(value), manifest: committed };
          return committed;
        }),
      },
      now: () => 2_000,
      ...timers,
    });
    await supervisor.start();

    const result = await supervisor.bootstrap();

    expect(events).toEqual(['bootstrap', 'backup', 'commit', 'verify']);
    expect(result).toEqual({ mnemonic: words });
    expect(supervisor.health()).toMatchObject({
      status: 'ready',
      backupAgeMs: 0,
    });
    expect(timers.schedule).toHaveBeenCalledOnce();
  });

  it.each(['backup', 'commit', 'verify'])(
    'returns no recovery words and fails health when initial %s fails',
    async (failureStage) => {
      const words = Array.from({ length: 24 }, () => 'secretword');
      const bytes = Buffer.from('fresh-encrypted-wallet');
      let committed: ReturnType<typeof manifest> | undefined;
      const control = controlDouble({
        bootstrap: vi.fn(async () => ({ mnemonic: words })),
        backup: vi.fn(async () => {
          if (failureStage === 'backup') throw new Error('BACKUP_FAILED');
          return bytes;
        }),
      });
      const timers = noTimer();
      const supervisor = createSupervisor({
        control,
        store: {
          loadLatest: vi.fn(async () => {
            if (!committed) throw new Error('BACKUP_REQUIRED');
            if (failureStage === 'verify') {
              return {
                bytes: Buffer.from('different-wallet'),
                manifest: committed,
              };
            }
            return { bytes, manifest: committed };
          }),
          commit: vi.fn(async () => {
            if (failureStage === 'commit') throw new Error('COMMIT_FAILED');
            committed = manifest(bytes);
            return committed;
          }),
        },
        ...timers,
      });
      await supervisor.start();

      const error = await supervisor.bootstrap().catch((caught) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('INITIAL_BACKUP_FAILED');
      expect(error.cause).toBeUndefined();
      expect(error.message).not.toContain('secretword');
      expect(supervisor.health()).toMatchObject({
        status: 'failed',
        failureCategory: failureStage === 'backup'
          ? 'backup_failed'
          : failureStage === 'commit'
            ? 'commit_failed'
            : 'backup_verification_failed',
      });
      expect(timers.schedule).not.toHaveBeenCalled();
    },
  );

  it('allows bootstrap once and rejects concurrent or later attempts', async () => {
    let releaseBootstrap!: () => void;
    const canBootstrap = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const bytes = Buffer.from('fresh-encrypted-wallet');
    const committed = manifest(bytes);
    let latest: { bytes: Buffer; manifest: ReturnType<typeof manifest> }
      | undefined;
    const control = controlDouble({
      bootstrap: vi.fn(async () => {
        await canBootstrap;
        return { mnemonic: Array.from({ length: 24 }, () => 'word') };
      }),
      backup: vi.fn(async () => bytes),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => {
          if (!latest) throw new Error('BACKUP_REQUIRED');
          return latest;
        },
        commit: async () => {
          latest = { bytes, manifest: committed };
          return committed;
        },
      },
      ...timers,
    });
    await supervisor.start();

    const first = supervisor.bootstrap();
    await expect(supervisor.bootstrap()).rejects.toThrow(
      'BOOTSTRAP_NOT_ALLOWED',
    );
    releaseBootstrap();
    await expect(first).resolves.toMatchObject({ mnemonic: expect.any(Array) });
    await expect(supervisor.bootstrap()).rejects.toThrow(
      'BOOTSTRAP_NOT_ALLOWED',
    );
    expect(control.bootstrap).toHaveBeenCalledOnce();
  });

  it.each(['bootstrap', 'backup', 'commit', 'verify'])(
    'keeps the supervisor stopped when stop occurs during bootstrap %s',
    async (stage) => {
      const entered = deferred();
      const canFinish = deferred();
      const words = Array.from({ length: 24 }, () => 'word');
      const bytes = Buffer.from('fresh-encrypted-wallet');
      const committed = manifest(bytes);
      let latest:
        | { bytes: Buffer; manifest: ReturnType<typeof manifest> }
        | undefined;
      let loadCount = 0;
      const control = controlDouble({
        bootstrap: vi.fn(async () => {
          if (stage === 'bootstrap') {
            entered.resolve();
            await canFinish.promise;
          }
          return { mnemonic: words };
        }),
        backup: vi.fn(async () => {
          if (stage === 'backup') {
            entered.resolve();
            await canFinish.promise;
          }
          return bytes;
        }),
      });
      const timers = noTimer();
      const supervisor = createSupervisor({
        control,
        store: {
          loadLatest: async () => {
            loadCount += 1;
            if (loadCount === 1) throw new Error('BACKUP_REQUIRED');
            if (stage === 'verify') {
              entered.resolve();
              await canFinish.promise;
            }
            if (!latest) throw new Error('BACKUP_REQUIRED');
            return latest;
          },
          commit: async () => {
            if (stage === 'commit') {
              entered.resolve();
              await canFinish.promise;
            }
            latest = { bytes, manifest: committed };
            return committed;
          },
        },
        ...timers,
      });
      await supervisor.start();

      const bootstrapping = supervisor.bootstrap();
      await entered.promise;
      supervisor.stop();
      canFinish.resolve();

      await expect(bootstrapping).rejects.toThrow(
        'SUPERVISOR_LIFECYCLE_ABORTED',
      );
      expect(supervisor.health()).toMatchObject({
        status: 'failed',
        failureCategory: 'stopped',
      });
      expect(timers.schedule).not.toHaveBeenCalled();
    },
  );
});

describe('Synology backup scheduling and health', () => {
  it('coalesces overlapping backups so only one can run at a time', async () => {
    const original = Buffer.from('verified-encrypted-wallet');
    const fresh = Buffer.from('fresh-encrypted-wallet');
    let latest = { bytes: original, manifest: manifest(original) };
    let releaseBackup!: () => void;
    const canFinish = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    const control = controlDouble({
      backup: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await canFinish;
        active -= 1;
        return fresh;
      }),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => latest,
        commit: async () => {
          latest = {
            bytes: fresh,
            manifest: manifest(fresh, new Date(2_000).toISOString(), 2),
          };
          return latest.manifest;
        },
      },
      now: () => 2_000,
      ...timers,
    });
    await supervisor.start();

    const first = supervisor.backupNow();
    const second = supervisor.backupNow();
    releaseBackup();

    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      latest.manifest,
      latest.manifest,
    ]);
    expect(maximumActive).toBe(1);
    expect(control.backup).toHaveBeenCalledOnce();
  });

  it('fails closed when backup age exceeds the stale threshold or control fails', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    let currentTime = 121_000;
    let controlStatus = {
      status: 'ready',
      release: 'test-release',
      failureCategory: undefined as string | undefined,
    };
    const control = controlDouble({
      health: vi.fn(() => controlStatus),
    });
    const timers = noTimer();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({
          bytes,
          manifest: manifest(bytes, new Date(1_000).toISOString()),
        }),
      },
      now: () => currentTime,
      staleAfterMs: 120_000,
      ...timers,
    });
    await supervisor.start();

    expect(supervisor.health()).toMatchObject({
      status: 'ready',
      backupAgeMs: 120_000,
    });
    currentTime += 1;
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      backupAgeMs: 120_001,
      failureCategory: 'backup_stale',
    });
    controlStatus = {
      status: 'failed',
      release: 'test-release',
      failureCategory: 'required_process_exited',
    };
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'required_process_exited',
    });
    await expect(supervisor.backupNow()).rejects.toThrow('MERCHANT_NOT_READY');
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'required_process_exited',
    });
  });

  it('clears the periodic timer and stops control', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    const timer = { timer: true };
    const schedule = vi.fn(() => timer);
    const clearSchedule = vi.fn();
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      schedule,
      clearSchedule,
    });
    await supervisor.start();

    supervisor.stop();

    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(clearSchedule).toHaveBeenCalledWith(timer);
    expect(control.stop).toHaveBeenCalledOnce();
  });

  it('clears the periodic timer when a scheduled backup fails', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    let tick!: () => void;
    const timer = { timer: true };
    const schedule = vi.fn((callback: () => void) => {
      tick = callback;
      return timer;
    });
    const clearSchedule = vi.fn();
    const control = controlDouble({
      backup: vi.fn(async () => {
        throw new Error('BACKUP_FAILED');
      }),
    });
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      schedule,
      clearSchedule,
    });
    await supervisor.start();

    tick();

    await vi.waitFor(() => {
      expect(clearSchedule).toHaveBeenCalledWith(timer);
    });
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'backup_failed',
    });
  });

  it('cannot leave a failed lifecycle ready when timer cancellation throws', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    let tick!: () => void;
    const control = controlDouble({
      backup: vi.fn(async () => {
        throw new Error('BACKUP_FAILED');
      }),
    });
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      schedule: (callback: () => void) => {
        tick = callback;
        return { timer: true };
      },
      clearSchedule: () => {
        throw new Error('TIMER_CANCEL_FAILED');
      },
    });
    await supervisor.start();

    tick();

    await vi.waitFor(() => {
      expect(supervisor.health()).toMatchObject({
        status: 'failed',
        failureCategory: 'backup_failed',
      });
    });
    expect(control.stop).toHaveBeenCalledOnce();
  });

  it('cannot leave a stopped lifecycle ready when timer cancellation throws', async () => {
    const bytes = Buffer.from('verified-encrypted-wallet');
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      schedule: () => ({ timer: true }),
      clearSchedule: () => {
        throw new Error('TIMER_CANCEL_FAILED');
      },
    });
    await supervisor.start();

    expect(() => supervisor.stop()).not.toThrow();
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'stopped',
    });
    expect(control.stop).toHaveBeenCalledOnce();
  });
});

describe('Synology quarantine durability', () => {
  it('rejects a quarantine root equal to or nested under the live wallet', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-invalid-quarantine-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    await mkdir(walletDirectory);
    const bytes = Buffer.from('verified-encrypted-wallet');

    for (const quarantineRoot of [
      walletDirectory,
      join(walletDirectory, 'quarantine'),
    ]) {
      const control = controlDouble();
      const supervisor = createSupervisor({
        control,
        store: {
          loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
        },
        walletDirectory,
        quarantineRoot,
        ...noTimer(),
      });

      await expect(supervisor.start()).rejects.toThrow(
        'QUARANTINE_ROOT_INVALID',
      );
      expect(control.restore).not.toHaveBeenCalled();
    }
  });

  it('fsyncs quarantine metadata and both rename parents before restore', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-quarantine-sync-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'preserved');
    const bytes = Buffer.from('verified-encrypted-wallet');
    const events: string[] = [];
    const synced: string[] = [];
    const control = controlDouble({
      restore: vi.fn(async () => {
        events.push('restore');
      }),
      start: vi.fn(async () => {
        events.push('start');
      }),
    });
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          events.push('rename');
          await rename(from, to);
        },
      },
      directorySync: async (path: string) => {
        synced.push(path);
        events.push(`sync:${relative(root, path) || '.'}`);
      },
      ...noTimer(),
    });

    await supervisor.start();

    const renameIndex = events.indexOf('rename');
    const restoreIndex = events.indexOf('restore');
    expect(renameIndex).toBeGreaterThan(0);
    expect(restoreIndex).toBeGreaterThan(renameIndex);
    expect(events.slice(renameIndex + 1, restoreIndex))
      .toEqual(expect.arrayContaining([
        'sync:.',
        expect.stringMatching(/^sync:quarantine[/\\].+/u),
      ]));
    expect(synced.filter((path) => path === quarantineRoot).length)
      .toBeGreaterThanOrEqual(2);
    expect(
      synced.some((path) => (
        dirname(path) === quarantineRoot && path !== quarantineRoot
      )),
    ).toBe(true);
  });

  it('fsyncs both rename parents when stop occurs exactly after the wallet move', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-stop-after-rename-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'preserved');
    const bytes = Buffer.from('verified-encrypted-wallet');
    const postRenameSyncs: string[] = [];
    let renamed = false;
    let supervisor!: ReturnType<typeof createSupervisor>;
    const control = controlDouble();
    supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          await rename(from, to);
          renamed = true;
          supervisor.stop();
        },
      },
      directorySync: async (path: string) => {
        if (renamed) postRenameSyncs.push(path);
      },
      ...noTimer(),
    });

    await expect(supervisor.start()).rejects.toThrow(
      'SUPERVISOR_LIFECYCLE_ABORTED',
    );

    expect(postRenameSyncs).toEqual(expect.arrayContaining([
      root,
      expect.stringMatching(
        new RegExp(`^${quarantineRoot.replaceAll('\\', '\\\\')}`),
      ),
    ]));
    expect(control.restore).not.toHaveBeenCalled();
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'stopped',
    });
    const reservations = await readdir(quarantineRoot);
    expect(
      await readFile(
        join(quarantineRoot, reservations[0]!, 'wallet', 'wallet.db'),
        'utf8',
      ),
    ).toBe('preserved');
  });

  it('attempts the second parent fsync when stop occurs during the first', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-stop-during-post-rename-sync-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    const bytes = Buffer.from('verified-encrypted-wallet');
    const firstSyncStarted = deferred();
    const firstSyncCanFinish = deferred();
    const postRenameSyncs: string[] = [];
    let renamed = false;
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          await rename(from, to);
          renamed = true;
        },
      },
      directorySync: async (path: string) => {
        if (!renamed) return;
        postRenameSyncs.push(path);
        if (postRenameSyncs.length === 1) {
          firstSyncStarted.resolve();
          await firstSyncCanFinish.promise;
        }
      },
      ...noTimer(),
    });

    const starting = supervisor.start();
    await firstSyncStarted.promise;
    supervisor.stop();
    firstSyncCanFinish.resolve();

    await expect(starting).rejects.toThrow(
      'SUPERVISOR_LIFECYCLE_ABORTED',
    );
    expect(postRenameSyncs).toHaveLength(2);
    expect(postRenameSyncs).toEqual(expect.arrayContaining([
      root,
      expect.stringMatching(
        new RegExp(`^${quarantineRoot.replaceAll('\\', '\\\\')}`),
      ),
    ]));
    expect(control.restore).not.toHaveBeenCalled();
  });

  it('attempts both parent fsyncs when the destination parent sync fails', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-both-post-rename-syncs-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'preserved');
    const bytes = Buffer.from('verified-encrypted-wallet');
    const postRenameSyncs: string[] = [];
    let renamed = false;
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          await rename(from, to);
          renamed = true;
        },
      },
      directorySync: (path: string) => {
        if (!renamed) return Promise.resolve();
        postRenameSyncs.push(path);
        if (path !== root) {
          throw new Error('DESTINATION_PARENT_FSYNC_FAILED');
        }
        return Promise.resolve();
      },
      ...noTimer(),
    });

    await expect(supervisor.start()).rejects.toThrow(
      'DESTINATION_PARENT_FSYNC_FAILED',
    );

    expect(postRenameSyncs).toHaveLength(2);
    expect(postRenameSyncs).toContain(root);
    expect(control.restore).not.toHaveBeenCalled();
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'destination_parent_fsync_failed',
    });
    const reservations = await readdir(quarantineRoot);
    expect(
      await readFile(
        join(quarantineRoot, reservations[0]!, 'wallet', 'wallet.db'),
        'utf8',
      ),
    ).toBe('preserved');
  });

  it('fails before restore when quarantine metadata cannot be fsynced', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-quarantine-sync-failure-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    const bytes = Buffer.from('verified-encrypted-wallet');
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      directorySync: vi.fn(async () => {
        throw new Error('QUARANTINE_FSYNC_FAILED');
      }),
      ...noTimer(),
    });

    await expect(supervisor.start()).rejects.toThrow(
      'QUARANTINE_FSYNC_FAILED',
    );
    expect(supervisor.health()).toMatchObject({
      status: 'failed',
      failureCategory: 'quarantine_fsync_failed',
    });
    expect(control.restore).not.toHaveBeenCalled();
  });

  it('fails closed and preserves the moved wallet when post-rename fsync fails', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-post-rename-sync-failure-')));
    temporaryDirectories.push(root);
    const walletDirectory = join(root, 'wallet');
    const quarantineRoot = join(root, 'quarantine');
    await mkdir(walletDirectory);
    await writeFile(join(walletDirectory, 'wallet.db'), 'preserved');
    const bytes = Buffer.from('verified-encrypted-wallet');
    let renamed = false;
    const control = controlDouble();
    const supervisor = createSupervisor({
      control,
      store: {
        loadLatest: async () => ({ bytes, manifest: manifest(bytes) }),
      },
      walletDirectory,
      quarantineRoot,
      fileSystem: {
        access,
        mkdir,
        rename: async (from: string, to: string) => {
          await rename(from, to);
          renamed = true;
        },
      },
      directorySync: async () => {
        if (renamed) throw new Error('POST_RENAME_FSYNC_FAILED');
      },
      ...noTimer(),
    });

    await expect(supervisor.start()).rejects.toThrow(
      'POST_RENAME_FSYNC_FAILED',
    );
    expect(control.restore).not.toHaveBeenCalled();
    await expect(access(walletDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const reservations = await readdir(quarantineRoot);
    expect(reservations).toHaveLength(1);
    expect(
      await readFile(
        join(quarantineRoot, reservations[0]!, 'wallet', 'wallet.db'),
        'utf8',
      ),
    ).toBe('preserved');
  });
});

describe('control server interface', () => {
  it('awaits an asynchronous duck-typed backup implementation', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-control-server-')));
    temporaryDirectories.push(root);
    const outputPath = join(root, 'wallet.archive');
    process.env.WALLET_BACKUP_OUTPUT_PATH = outputPath;
    const bytes = Buffer.from('encrypted-wallet');
    const api = {
      restore: vi.fn(),
      start: vi.fn(),
      bootstrap: vi.fn(),
      backup: vi.fn(async (path: string) => {
        await Promise.resolve();
        await writeFile(path, bytes);
        return { sha256: sha256(bytes), byteLength: bytes.byteLength };
      }),
      health: vi.fn(() => ({ status: 'ready', release: 'test-release' })),
      stop: vi.fn(),
    };
    const server = createControlServer(api, 'test-token');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/backup`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
        },
      );
      expect(response.status).toBe(201);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get('x-backup-sha256')).toBe(sha256(bytes));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('isolates concurrent asynchronous backups in unique temporary directories', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-concurrent-control-backup-')));
    temporaryDirectories.push(root);
    process.env.WALLET_BACKUP_OUTPUT_PATH = join(root, 'wallet.archive');
    const bothStarted = deferred();
    const outputPaths: string[] = [];
    let calls = 0;
    const api = {
      restore: vi.fn(),
      start: vi.fn(),
      bootstrap: vi.fn(),
      backup: vi.fn(async (path: string) => {
        calls += 1;
        const bytes = Buffer.from(`encrypted-wallet-${calls}`);
        outputPaths.push(path);
        if (calls === 2) bothStarted.resolve();
        await bothStarted.promise;
        await writeFile(path, bytes);
        return { sha256: sha256(bytes), byteLength: bytes.byteLength };
      }),
      health: vi.fn(() => ({ status: 'ready', release: 'test-release' })),
      stop: vi.fn(),
    };
    const server = createControlServer(api, 'test-token');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
    }

    try {
      const responses = await Promise.all([1, 2].map(() => fetch(
        `http://127.0.0.1:${address.port}/backup`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
        },
      )));
      expect(responses.map(({ status }) => status)).toEqual([201, 201]);
      const bodies = await Promise.all(responses.map(async (response) =>
        Buffer.from(await response.arrayBuffer()).toString('utf8')));
      expect(bodies.sort()).toEqual([
        'encrypted-wallet-1',
        'encrypted-wallet-2',
      ]);
      expect(new Set(outputPaths).size).toBe(2);
      for (const path of outputPaths) {
        expect(dirname(path)).not.toBe(root);
        await expect(access(dirname(path))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each(['digest', 'length'])(
    'rejects a backup %s mismatch and always removes its unique temporary directory',
    async (mismatch) => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const root = await import('node:fs/promises').then(({ mkdtemp }) =>
        mkdtemp(join(tmpdir(), 'openstays-control-backup-mismatch-')));
      temporaryDirectories.push(root);
      process.env.WALLET_BACKUP_OUTPUT_PATH = join(root, 'wallet.archive');
      const bytes = Buffer.from('encrypted-wallet');
      let outputPath = '';
      const api = {
        restore: vi.fn(),
        start: vi.fn(),
        bootstrap: vi.fn(),
        backup: vi.fn(async (path: string) => {
          outputPath = path;
          await writeFile(path, bytes);
          return {
            sha256: mismatch === 'digest'
              ? '0'.repeat(64)
              : sha256(bytes),
            byteLength: mismatch === 'length'
              ? bytes.byteLength + 1
              : bytes.byteLength,
          };
        }),
        health: vi.fn(() => ({ status: 'ready', release: 'test-release' })),
        stop: vi.fn(),
      };
      const server = createControlServer(api, 'test-token');
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/backup`,
          {
            method: 'POST',
            headers: { Authorization: 'Bearer test-token' },
          },
        );
        expect(response.status).toBe(503);
        expect(outputPath).not.toBe('');
        expect(dirname(outputPath)).not.toBe(root);
        await expect(access(dirname(outputPath))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => error ? reject(error) : resolve()));
      }
    },
  );
});

describe('Synology operator and container binding contract', () => {
  it.each(['health', 'bootstrap', 'backup'])(
    'sends the %s command to loopback with the control bearer token',
    async (command) => {
      const fetchImpl = vi.fn(async (
        _url: Parameters<typeof fetch>[0],
        _request?: Parameters<typeof fetch>[1],
      ) => {
        const backupBytes = Buffer.from('encrypted-wallet');
        return new Response(
          command === 'backup'
          ? backupBytes
          : JSON.stringify(command === 'bootstrap'
            ? { mnemonic: Array.from({ length: 24 }, () => 'word') }
            : { status: 'ready', release: 'test-release' }),
        {
          status: command === 'bootstrap' || command === 'backup' ? 201 : 200,
          headers: command === 'backup'
              ? {
                'Content-Type': 'application/octet-stream',
                'X-Backup-Sha256': sha256(backupBytes),
                'Content-Length': String(backupBytes.byteLength),
              }
            : { 'Content-Type': 'application/json' },
        },
        );
      });
      const writes: string[] = [];

      await runOperator([command], {
        env: {
          CONTAINER_CONTROL_TOKEN: 'test-control-token',
          CONTROL_PORT: '8181',
        },
        fetchImpl,
        write: (value: string) => {
          writes.push(value);
          return true;
        },
      });

      const [url, request] = fetchImpl.mock.calls[0]!;
      expect(url).toBe(`http://127.0.0.1:8181/${command}`);
      expect(request).toMatchObject({
        method: command === 'health' ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer test-control-token',
        },
      });
      expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(
        '0.0.0.0',
      );
      expect(writes.join('')).not.toContain('test-control-token');
    },
  );

  it.each([
    { arguments_: [] },
    { arguments_: ['restore'] },
    { arguments_: ['health', 'extra'] },
    { arguments_: ['HEALTH'] },
  ])('rejects unsupported operator arguments: $arguments_', async ({
    arguments_,
  }) => {
    const fetchImpl = vi.fn();

    await expect(runOperator(arguments_, {
      env: { CONTAINER_CONTROL_TOKEN: 'test-control-token' },
      fetchImpl,
      write: vi.fn(),
    })).rejects.toThrow('OPERATOR_COMMAND_INVALID');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prints recovery words only after a successful bootstrap response', async () => {
    const writes: string[] = [];
    const mnemonic = Array.from({ length: 24 }, (_, index) => `word${index}`);

    await expect(runOperator(['bootstrap'], {
      env: { CONTAINER_CONTROL_TOKEN: 'test-control-token' },
      fetchImpl: vi.fn(async () => new Response(
        JSON.stringify({ mnemonic }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )),
      write: (value: string) => {
        writes.push(value);
        return true;
      },
    })).rejects.toThrow('OPERATOR_REQUEST_FAILED');
    expect(writes.join('')).not.toContain('word0');

    await runOperator(['bootstrap'], {
      env: { CONTAINER_CONTROL_TOKEN: 'test-control-token' },
      fetchImpl: vi.fn(async () => new Response(
        JSON.stringify({ mnemonic }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      )),
      write: (value: string) => {
        writes.push(value);
        return true;
      },
    });
    expect(writes.join('')).toContain('word0');
    expect(writes.join('')).toContain('word23');
  });

  it('requires a non-empty control token before making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(runOperator(['health'], {
      env: {},
      fetchImpl,
      write: vi.fn(),
    })).rejects.toThrow('CONTAINER_CONTROL_TOKEN_REQUIRED');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails the health command when supervisor health is unavailable', async () => {
    const write = vi.fn();

    await expect(runOperator(['health'], {
      env: { CONTAINER_CONTROL_TOKEN: 'test-control-token' },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        status: 'failed',
        failureCategory: 'backup_stale',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
      write,
    })).rejects.toThrow('OPERATOR_HEALTH_FAILED');

    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing backup key',
      change: { WALLET_BACKUP_KEY_BASE64: undefined },
      category: 'WALLET_BACKUP_KEY_BASE64_REQUIRED',
    },
    {
      name: 'invalid backup key',
      change: { WALLET_BACKUP_KEY_BASE64: 'not-base64' },
      category: 'WALLET_BACKUP_KEY_BASE64_INVALID',
    },
    {
      name: 'short wallet password',
      change: { WAVELENGTH_WALLET_PASSWORD: 'short' },
      category: 'WAVELENGTH_WALLET_PASSWORD_TOO_SHORT',
    },
    {
      name: 'control token containing a newline',
      change: { CONTAINER_CONTROL_TOKEN: 'bad\ntoken' },
      category: 'CONTAINER_CONTROL_TOKEN_INVALID',
    },
  ])('rejects $name before opening the runtime listener', ({
    change,
    category,
  }) => {
    const env = {
      CONTAINER_CONTROL_TOKEN: 'runtime-token',
      OPENSTAYS_RELEASE: 'test-release',
      OPENSTAYS_UID: String(process.getuid?.() ?? 1_000),
      OPENSTAYS_GID: String(process.getgid?.() ?? 1_000),
      WALLET_BACKUP_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
      WAVELENGTH_WALLET_PASSWORD: 'test-password',
      ...change,
    };

    expect(() => createSynologyRuntime({ env })).toThrow(category);
  });

  it('packages a private bridge-mode container with exact durable roots', async () => {
    const compose = await readFile(
      join(process.cwd(), '../synology/docker-compose.yml'),
      'utf8',
    );
    const dockerfile = await readFile(
      join(process.cwd(), 'container/Dockerfile'),
      'utf8',
    );

    expect(compose).not.toMatch(/^\s*ports\s*:/mu);
    expect(compose).toContain('network_mode: bridge');
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('mem_limit: 2g');
    expect(compose).toContain(
      'user: "${OPENSTAYS_UID}:${OPENSTAYS_GID}"',
    );
    expect(compose).toContain('healthcheck:');
    expect(compose).toContain(
      '/volume1/docker/openstays-merchant/state:/var/lib/openstays',
    );
    expect(compose).toContain(
      '/volume2/openstays-wallet-backups:/var/backups/openstays',
    );
    expect(dockerfile).toContain(
      'COPY --chown=node:node ops/synology/*.mjs /app/synology/',
    );
    expect(dockerfile).toContain(
      '/app/cloudflare/container/',
    );
    expect(dockerfile).not.toMatch(/^\s*EXPOSE\s+/mu);
  });

  it('adapts path-based MerchantControl backups into verified supervisor bytes', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-merchant-adapter-')));
    temporaryDirectories.push(root);
    const store = new GenerationStore(join(root, 'generations'));
    const stagingRoot = join(root, 'staging');
    await mkdir(stagingRoot);
    const words = Array.from({ length: 24 }, (_, index) => `word${index}`);
    const backupPaths: string[] = [];
    let backupNumber = 0;
    let periodicTick: (() => void) | undefined;
    const merchant = {
      restore: vi.fn(),
      start: vi.fn(),
      bootstrap: vi.fn(async () => ({ mnemonic: words })),
      backup: vi.fn(async (outputPath: string) => {
        backupNumber += 1;
        backupPaths.push(outputPath);
        const bytes = Buffer.from(`encrypted-wallet-${backupNumber}`);
        await writeFile(outputPath, bytes);
        return {
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
        };
      }),
      health: vi.fn(() => ({
        status: 'ready',
        release: 'test-release',
      })),
      stop: vi.fn(),
    };
    const control = createMerchantSupervisorControl(merchant, {
      stagingRoot,
    });
    const supervisor = createSupervisor({
      control,
      store,
      schedule: (callback: () => void) => {
        periodicTick = callback;
        return { timer: true };
      },
      clearSchedule: vi.fn(),
    });

    await supervisor.start();
    const result = await supervisor.bootstrap();
    expect(result).toEqual({ mnemonic: words });
    expect((await store.loadLatest()).bytes).toEqual(
      Buffer.from('encrypted-wallet-1'),
    );

    await supervisor.backupNow();
    periodicTick!();
    for (let attempt = 0; attempt < 50 && backupNumber < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(backupNumber).toBe(3);
    let latestBytes = (await store.loadLatest()).bytes;
    for (
      let attempt = 0;
      attempt < 50
        && !latestBytes.equals(Buffer.from('encrypted-wallet-3'));
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      latestBytes = (await store.loadLatest()).bytes;
    }
    expect(new Set(backupPaths).size).toBe(3);
    for (const outputPath of backupPaths) {
      await expect(access(dirname(outputPath))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
    expect(latestBytes).toEqual(Buffer.from('encrypted-wallet-3'));
  });

  it('rejects mismatched MerchantControl metadata and removes staging bytes', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-merchant-adapter-mismatch-')));
    temporaryDirectories.push(root);
    const stagingRoot = join(root, 'staging');
    const merchant = {
      restore: vi.fn(),
      start: vi.fn(),
      bootstrap: vi.fn(),
      backup: vi.fn(async (outputPath: string) => {
        const bytes = Buffer.from('encrypted-wallet');
        await writeFile(outputPath, bytes);
        return {
          sha256: '0'.repeat(64),
          byteLength: bytes.byteLength,
        };
      }),
      health: vi.fn(),
      stop: vi.fn(),
    };
    const control = createMerchantSupervisorControl(merchant, {
      stagingRoot,
    });

    await expect(control.backup()).rejects.toThrow(
      'BACKUP_RESULT_MISMATCH',
    );
    expect(await readdir(stagingRoot)).toEqual([]);
  });

  it.each([
    {
      env: { OPENSTAYS_UID: '0', OPENSTAYS_GID: '1000' },
      category: 'OPENSTAYS_UID_ROOT_FORBIDDEN',
    },
    {
      env: { OPENSTAYS_UID: 'abc', OPENSTAYS_GID: '1000' },
      category: 'OPENSTAYS_UID_INVALID',
    },
    {
      env: { OPENSTAYS_UID: '1000', OPENSTAYS_GID: '0' },
      category: 'OPENSTAYS_GID_ROOT_FORBIDDEN',
    },
  ])('rejects an unsafe runtime identity: $category', ({
    env,
    category,
  }) => {
    expect(() => validateRuntimeIdentity(env, {
      getuid: () => Number(env.OPENSTAYS_UID),
      getgid: () => Number(env.OPENSTAYS_GID),
    })).toThrow(category);
  });

  it('rejects an actual root process even when configured IDs are non-root', () => {
    expect(() => validateRuntimeIdentity({
      OPENSTAYS_UID: '1000',
      OPENSTAYS_GID: '1000',
    }, {
      getuid: () => 0,
      getgid: () => 1_000,
    })).toThrow('RUNTIME_ROOT_FORBIDDEN');
  });

  it('routes authenticated loopback control requests through the supervisor', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-runtime-routing-')));
    temporaryDirectories.push(root);
    process.env.WALLET_BACKUP_OUTPUT_PATH = join(root, 'wallet.archive');
    const bytes = Buffer.from('verified-supervisor-backup');
    const supervisor = {
      start: vi.fn(),
      health: vi.fn(() => ({
        status: 'awaiting_bootstrap',
        release: 'test-release',
      })),
      bootstrap: vi.fn(async () => ({
        mnemonic: Array.from({ length: 24 }, () => 'word'),
      })),
      backup: vi.fn(async () => ({
        bytes,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      })),
      stop: vi.fn(),
    };
    const runtime = createSynologyRuntime({
      env: { CONTAINER_CONTROL_TOKEN: 'runtime-token' },
      port: 0,
      supervisor,
    });
    const address = await runtime.start();

    try {
      expect(address.address).toBe('127.0.0.1');
      const headers = { Authorization: 'Bearer runtime-token' };
      const unauthorized = await fetch(
        `http://127.0.0.1:${address.port}/health`,
      );
      expect(unauthorized.status).toBe(401);
      const health = await fetch(
        `http://127.0.0.1:${address.port}/health`,
        { headers },
      );
      expect(await health.json()).toMatchObject({
        status: 'awaiting_bootstrap',
      });
      const bootstrap = await fetch(
        `http://127.0.0.1:${address.port}/bootstrap`,
        { method: 'POST', headers },
      );
      expect(bootstrap.status).toBe(201);
      const backup = await fetch(
        `http://127.0.0.1:${address.port}/backup`,
        { method: 'POST', headers },
      );
      expect(backup.status).toBe(201);
      expect(Buffer.from(await backup.arrayBuffer())).toEqual(bytes);
      expect(supervisor.start).toHaveBeenCalledOnce();
      expect(supervisor.bootstrap).toHaveBeenCalledOnce();
      expect(supervisor.backup).toHaveBeenCalledOnce();
    } finally {
      await runtime.stop();
    }
    expect(supervisor.stop).toHaveBeenCalledOnce();
  });

  it('keeps the packaged supervisor entrypoint alive on authenticated loopback health', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(join(tmpdir(), 'openstays-runtime-entrypoint-')));
    temporaryDirectories.push(root);
    const probe = await import('node:http').then(({ createServer }) =>
      createServer());
    await new Promise<void>((resolve) =>
      probe.listen(0, '127.0.0.1', resolve));
    const probeAddress = probe.address();
    if (!probeAddress || typeof probeAddress === 'string') {
      throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
    }
    const port = probeAddress.port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => error ? reject(error) : resolve()));
    const appRoot = join(root, 'app');
    await mkdir(join(appRoot, 'synology'), { recursive: true });
    await mkdir(join(appRoot, 'cloudflare', 'container'), {
      recursive: true,
    });
    await mkdir(join(appRoot, 'container'), { recursive: true });
    for (const name of ['supervisor.mjs', 'generationStore.mjs', 'operator.mjs']) {
      await copyFile(
        join(process.cwd(), '..', 'synology', name),
        join(appRoot, 'synology', name),
      );
    }
    for (const name of ['control.mjs', 'backup.mjs']) {
      await copyFile(
        join(process.cwd(), 'container', name),
        join(appRoot, 'cloudflare', 'container', name),
      );
      await copyFile(
        join(process.cwd(), 'container', name),
        join(appRoot, 'container', name),
      );
    }
    const token = 'spawned-runtime-token';
    const stderr: string[] = [];
    const child = spawn(
      process.execPath,
      [join(appRoot, 'synology', 'supervisor.mjs')],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          CONTAINER_CONTROL_TOKEN: token,
          CONTROL_PORT: String(port),
          OPENSTAYS_RELEASE: 'test-release',
          OPENSTAYS_BACKUP_ROOT: join(root, 'backups'),
          OPENSTAYS_QUARANTINE_ROOT: join(root, 'quarantine'),
          WAVELENGTH_WALLET_DIRECTORY: join(root, 'state', 'wavelength'),
          WALLET_BACKUP_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
          WAVELENGTH_WALLET_PASSWORD: 'test-password',
          OPENSTAYS_UID: String(process.getuid?.() ?? 1_000),
          OPENSTAYS_GID: String(process.getgid?.() ?? 1_000),
        },
      },
    );
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (value) => stderr.push(String(value)));

    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (child.exitCode !== null) break;
        try {
          response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(child.exitCode).toBeNull();
      expect(response?.status).toBe(200);
      expect(await response!.json()).toMatchObject({
        status: 'awaiting_bootstrap',
        release: 'test-release',
      });
      expect(stderr.join('')).not.toContain(token);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
      });
    }
  });
});
