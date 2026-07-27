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
import { join } from 'node:path';

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
      expect(error.message).not.toContain('secretword');
      expect(supervisor.health()).toMatchObject({
        status: 'failed',
        failureCategory: 'initial_backup_failed',
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
});
