import { createHash } from 'node:crypto';
import {
  access,
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
import { createSupervisor } from '../../synology/supervisor.mjs';

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
