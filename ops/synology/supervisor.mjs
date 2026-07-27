import * as nodeFileSystem from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

function errorCategory(error, fallback = 'supervisor_operation_failed') {
  return error instanceof Error
    && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message.toLowerCase()
    : fallback;
}

function backupBytes(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (
    value
    && typeof value === 'object'
    && (Buffer.isBuffer(value.bytes) || value.bytes instanceof Uint8Array)
  ) {
    return Buffer.from(value.bytes);
  }
  throw new Error('BACKUP_BYTES_REQUIRED');
}

function verifiedAt(manifest) {
  const value = Date.parse(manifest?.createdAt);
  if (!Number.isFinite(value)) throw new Error('BACKUP_CREATED_AT_INVALID');
  return value;
}

function sameVerifiedBackup(loaded, bytes, committedManifest) {
  return loaded
    && Buffer.isBuffer(Buffer.from(loaded.bytes))
    && Buffer.from(loaded.bytes).equals(bytes)
    && isDeepStrictEqual(loaded.manifest, committedManifest);
}

async function exists(fileSystem, path) {
  try {
    await fileSystem.access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function timestampName(value) {
  return new Date(value).toISOString().replaceAll(':', '-');
}

/**
 * Restore-first lifecycle and verified backup coordination for the Synology
 * merchant process.
 *
 * @param {{
 *   control: Record<string, any>,
 *   store: Record<string, any>,
 *   backupIntervalMs?: number,
 *   staleAfterMs?: number,
 *   now?: () => number,
 *   schedule?: (callback: () => void, intervalMs: number) => any,
 *   clearSchedule?: (timer: any) => void,
 *   fileSystem?: Record<string, any>,
 *   walletDirectory?: string,
 *   quarantineRoot?: string,
 * }} options
 */
export function createSupervisor({
  control,
  store,
  backupIntervalMs = 60_000,
  staleAfterMs = 120_000,
  now = Date.now,
  schedule = setInterval,
  clearSchedule = clearInterval,
  fileSystem = {},
  walletDirectory = control?.walletDirectory
    ?? control?.options?.walletDirectory,
  quarantineRoot = walletDirectory
    ? resolve(dirname(walletDirectory), 'quarantine')
    : undefined,
} = {}) {
  if (!control || !store) throw new TypeError('SUPERVISOR_DEPENDENCIES_REQUIRED');
  const fs = { ...nodeFileSystem, ...fileSystem };
  const liveWallet = walletDirectory
    ? resolve(walletDirectory)
    : undefined;
  let state = 'starting';
  let failureCategory;
  let lastVerifiedBackupAt;
  let timer;
  let backupInFlight;

  function safeControlHealth() {
    try {
      const value = control.health();
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {
        status: 'failed',
        failureCategory: 'control_health_failed',
      };
    }
  }

  function stopControlAfterFailure() {
    try {
      control.stop();
    } catch {
      // The original operational failure remains authoritative.
    }
  }

  function fail(error, fallback) {
    state = 'failed';
    failureCategory = errorCategory(error, fallback);
    stopControlAfterFailure();
  }

  function ensureTimer() {
    if (timer !== undefined) return;
    timer = schedule(() => {
      void backupNow().catch(() => undefined);
    }, backupIntervalMs);
  }

  async function quarantineLiveWallet(timestamp) {
    if (!liveWallet || !await exists(fs, liveWallet)) return undefined;
    if (!quarantineRoot) throw new Error('QUARANTINE_ROOT_REQUIRED');
    await fs.mkdir(quarantineRoot, {
      recursive: true,
      mode: 0o700,
    });
    const prefix = `${basename(liveWallet)}-${timestampName(timestamp)}`;
    let reservation;
    for (let suffix = 0; suffix < 1_000; suffix += 1) {
      const candidate = resolve(
        quarantineRoot,
        suffix === 0 ? prefix : `${prefix}-${suffix}`,
      );
      try {
        await fs.mkdir(candidate, { mode: 0o700 });
        reservation = candidate;
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    if (!reservation) throw new Error('QUARANTINE_PATH_UNAVAILABLE');
    const preservedWallet = join(reservation, basename(liveWallet));
    await fs.rename(liveWallet, preservedWallet);
    return preservedWallet;
  }

  async function start() {
    if (state !== 'starting') throw new Error('SUPERVISOR_ALREADY_STARTED');
    let loaded;
    try {
      loaded = await store.loadLatest();
    } catch (error) {
      if (error instanceof Error && error.message === 'BACKUP_REQUIRED') {
        state = 'awaiting_bootstrap';
        return;
      }
      fail(error);
      throw error;
    }

    try {
      await quarantineLiveWallet(now());
      await control.restore(loaded.bytes, loaded.manifest.sha256);
      await control.start();
      lastVerifiedBackupAt = verifiedAt(loaded.manifest);
      state = 'ready';
      ensureTimer();
    } catch (error) {
      fail(error);
      throw error;
    }
  }

  async function createVerifiedBackup() {
    const timestamp = now();
    const bytes = backupBytes(await control.backup());
    const release = safeControlHealth().release;
    if (typeof release !== 'string' || release.trim().length === 0) {
      throw new Error('BACKUP_RELEASE_REQUIRED');
    }
    const committedManifest = await store.commit(bytes, release, timestamp);
    const loaded = await store.loadLatest();
    if (!sameVerifiedBackup(loaded, bytes, committedManifest)) {
      throw new Error('BACKUP_VERIFICATION_FAILED');
    }
    lastVerifiedBackupAt = verifiedAt(loaded.manifest);
    return { bytes, manifest: loaded.manifest };
  }

  async function runSerializedBackup() {
    if (backupInFlight) return backupInFlight;
    backupInFlight = createVerifiedBackup();
    try {
      return await backupInFlight;
    } finally {
      backupInFlight = undefined;
    }
  }

  async function bootstrap() {
    if (state !== 'awaiting_bootstrap') {
      throw new Error('BOOTSTRAP_NOT_ALLOWED');
    }
    state = 'bootstrapping';
    let created;
    try {
      created = await control.bootstrap();
    } catch (error) {
      fail(error, 'bootstrap_failed');
      throw error;
    }
    if (
      !Array.isArray(created?.mnemonic)
      || created.mnemonic.length !== 24
      || created.mnemonic.some((word) => (
        typeof word !== 'string' || word.length === 0
      ))
    ) {
      const error = new Error('INVALID_BOOTSTRAP_RESPONSE');
      fail(error);
      throw error;
    }

    try {
      await runSerializedBackup();
    } catch (cause) {
      const error = new Error('INITIAL_BACKUP_FAILED', { cause });
      fail(error);
      throw error;
    }

    state = 'ready';
    try {
      ensureTimer();
    } catch (error) {
      fail(error, 'backup_schedule_failed');
      throw error;
    }
    return { mnemonic: [...created.mnemonic] };
  }

  async function backupNow() {
    if (state !== 'ready') throw new Error('MERCHANT_NOT_READY');
    const controlHealth = safeControlHealth();
    if (controlHealth.status !== 'ready') {
      const error = new Error('MERCHANT_NOT_READY');
      state = 'failed';
      failureCategory =
        controlHealth.failureCategory ?? 'control_not_ready';
      stopControlAfterFailure();
      throw error;
    }
    try {
      return (await runSerializedBackup()).manifest;
    } catch (error) {
      fail(error, 'backup_failed');
      throw error;
    }
  }

  async function backup() {
    const manifest = await backupNow();
    const loaded = await store.loadLatest();
    if (!isDeepStrictEqual(loaded.manifest, manifest)) {
      const error = new Error('BACKUP_VERIFICATION_FAILED');
      fail(error);
      throw error;
    }
    return {
      bytes: Buffer.from(loaded.bytes),
      sha256: manifest.sha256,
      byteLength: manifest.byteLength,
    };
  }

  function health() {
    const controlHealth = safeControlHealth();
    const release = controlHealth.release;
    if (state === 'awaiting_bootstrap') {
      return { status: 'awaiting_bootstrap', release };
    }
    if (state === 'starting' || state === 'bootstrapping') {
      return { status: 'starting', release };
    }
    if (state === 'failed') {
      return {
        status: 'failed',
        failureCategory,
        release,
        backupAgeMs: lastVerifiedBackupAt === undefined
          ? undefined
          : Math.max(0, now() - lastVerifiedBackupAt),
      };
    }
    if (state === 'stopped') {
      return {
        status: 'failed',
        failureCategory: 'stopped',
        release,
      };
    }
    if (controlHealth.status !== 'ready') {
      return {
        status: 'failed',
        failureCategory:
          controlHealth.failureCategory ?? 'control_not_ready',
        release,
      };
    }
    const backupAgeMs = lastVerifiedBackupAt === undefined
      ? undefined
      : Math.max(0, now() - lastVerifiedBackupAt);
    if (backupAgeMs === undefined || backupAgeMs > staleAfterMs) {
      return {
        status: 'failed',
        failureCategory: 'backup_stale',
        release,
        backupAgeMs,
      };
    }
    return { status: 'ready', release, backupAgeMs };
  }

  function stop() {
    if (timer !== undefined) {
      clearSchedule(timer);
      timer = undefined;
    }
    state = 'stopped';
    control.stop();
  }

  return {
    start,
    bootstrap,
    backupNow,
    backup,
    health,
    stop,
  };
}
