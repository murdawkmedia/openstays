import { createHash, randomUUID } from 'node:crypto';
import * as nodeFileSystem from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const SCHEMA = 'openstays.synology-wallet-backup.v1';
const LOCK_DIRECTORY = '.generation-store.lock';
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 30_000;
const LEASE_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const ARCHIVE_PATTERN = /^generation-([1-9]\d*)\.archive$/u;
const MANIFEST_PATTERN = /^generation-([1-9]\d*)\.manifest\.json$/u;
const TEMPORARY_PATTERN =
  /^\.generation-[1-9]\d*\.(?:archive|manifest\.json)\.[^.]+\.tmp$/u;
const LEASE_PATTERN = /^lease-([a-f0-9-]+)\.json$/u;

function archiveName(generation) {
  return `generation-${generation}.archive`;
}

function manifestName(generation) {
  return `generation-${generation}.manifest.json`;
}

function generationFromName(entry, pattern) {
  const match = pattern.exec(entry);
  if (!match) return null;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) && generation > 0
    ? generation
    : null;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameManifest(left, right) {
  return left.schema === right.schema
    && left.generation === right.generation
    && left.createdAt === right.createdAt
    && left.release === right.release
    && left.byteLength === right.byteLength
    && left.sha256 === right.sha256;
}

function validManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return false;
  }
  const createdAt = typeof manifest.createdAt === 'string'
    ? Date.parse(manifest.createdAt)
    : Number.NaN;
  return manifest.schema === SCHEMA
    && Number.isSafeInteger(manifest.generation)
    && manifest.generation > 0
    && Number.isSafeInteger(manifest.byteLength)
    && manifest.byteLength >= 0
    && typeof manifest.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(manifest.sha256)
    && typeof manifest.release === 'string'
    && manifest.release.trim().length > 0
    && Number.isFinite(createdAt)
    && new Date(createdAt).toISOString() === manifest.createdAt;
}

async function verifiedPair(fileSystem, root, generation) {
  let manifestText;
  try {
    manifestText = await fileSystem.readFile(
      resolve(root, manifestName(generation)),
      'utf8',
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!validManifest(manifest) || manifest.generation !== generation) {
    return null;
  }
  let bytes;
  try {
    bytes = await fileSystem.readFile(resolve(root, archiveName(generation)));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (
    manifest.byteLength !== bytes.byteLength
    || manifest.sha256 !== digest(bytes)
  ) {
    return null;
  }
  return { bytes, manifest };
}

async function writeSynced(fileSystem, path, bytes) {
  const file = await fileSystem.open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(fileSystem, path) {
  if (process.platform === 'win32') return;
  const directory = await fileSystem.open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function leaseName(token) {
  return `lease-${token}.json`;
}

function sameDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function refreshLease(fileSystem, lock) {
  const before = await fileSystem.stat(lock.path);
  if (!sameDirectory(before, lock.identity)) {
    throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
  }
  const temporary = resolve(
    lock.path,
    `.${leaseName(lock.token)}.${randomUUID()}.tmp`,
  );
  const metadata = {
    token: lock.token,
    heartbeatAt: new Date(lock.clock()).toISOString(),
  };
  try {
    await writeSynced(
      fileSystem,
      temporary,
      Buffer.from(`${JSON.stringify(metadata)}\n`),
    );
    await fileSystem.rename(temporary, resolve(lock.path, leaseName(lock.token)));
  } finally {
    await Promise.allSettled([fileSystem.unlink(temporary)]);
  }
  const after = await fileSystem.stat(lock.path);
  if (!sameDirectory(after, lock.identity)) {
    throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
  }
}

async function freshestLease(fileSystem, lockPath) {
  let entries;
  try {
    entries = await fileSystem.readdir(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let freshest = Number.NaN;
  for (const entry of entries) {
    const match = LEASE_PATTERN.exec(entry);
    if (!match) continue;
    try {
      const metadata = JSON.parse(await fileSystem.readFile(
        resolve(lockPath, entry),
        'utf8',
      ));
      const heartbeat = Date.parse(metadata.heartbeatAt);
      if (metadata.token === match[1] && Number.isFinite(heartbeat)) {
        freshest = Number.isNaN(freshest)
          ? heartbeat
          : Math.max(freshest, heartbeat);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  if (Number.isFinite(freshest)) return freshest;
  try {
    return (await fileSystem.stat(lockPath)).mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function takeOverStaleLock(fileSystem, root, lockPath) {
  const tombstone = resolve(
    root,
    `.generation-store-lock-${randomUUID()}.tombstone`,
  );
  try {
    await fileSystem.rename(lockPath, tombstone);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await fileSystem.rm(tombstone, { recursive: true, force: true });
  return true;
}

async function acquireLock(fileSystem, root, options) {
  const lockPath = resolve(root, LOCK_DIRECTORY);
  const deadline = options.clock() + options.lockTimeoutMs;

  while (true) {
    try {
      await fileSystem.mkdir(lockPath, { mode: 0o700 });
      const lock = {
        path: lockPath,
        token: randomUUID(),
        identity: await fileSystem.stat(lockPath),
        clock: options.clock,
      };
      try {
        await refreshLease(fileSystem, lock);
      } catch (error) {
        await takeOverStaleLock(fileSystem, root, lockPath);
        throw error;
      }
      return lock;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const heartbeat = await freshestLease(fileSystem, lockPath);
      if (
        heartbeat !== null
        && options.clock() - heartbeat <= options.leaseTimeoutMs
      ) {
        if (options.clock() >= deadline) throw new Error('BACKUP_LOCK_TIMEOUT');
        await options.wait(LOCK_RETRY_MS);
        continue;
      }
      await takeOverStaleLock(fileSystem, root, lockPath);
    }
  }
}

function startHeartbeat(fileSystem, lock, intervalMs) {
  let failure;
  let pending = Promise.resolve();
  const refresh = async () => {
    if (failure) throw failure;
    pending = pending.then(() => refreshLease(fileSystem, lock)).catch((error) => {
      failure = error;
    });
    await pending;
    if (failure) throw failure;
  };
  const timer = setInterval(() => {
    void refresh().catch(() => {});
  }, intervalMs);
  timer.unref();
  return {
    refresh,
    async stop() {
      clearInterval(timer);
      await pending;
      if (failure) throw failure;
    },
  };
}

async function releaseLock(fileSystem, root, lock) {
  const current = await fileSystem.stat(lock.path);
  if (!sameDirectory(current, lock.identity)) {
    throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
  }
  const lease = JSON.parse(await fileSystem.readFile(
    resolve(lock.path, leaseName(lock.token)),
    'utf8',
  ));
  if (lease.token !== lock.token) throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
  const tombstone = resolve(
    root,
    `.generation-store-lock-${lock.token}.tombstone`,
  );
  await fileSystem.rename(lock.path, tombstone);
  await fileSystem.rm(tombstone, { recursive: true, force: true });
}

export class GenerationStore {
  /**
   * @param {string} root
   * @param {{
   *   retain?: number,
   *   fileSystem?: Record<string, unknown>,
   *   directorySync?: (path: string) => Promise<void>,
   *   leaseTimeoutMs?: number,
   *   heartbeatIntervalMs?: number,
   *   lockTimeoutMs?: number,
   *   clock?: () => number,
   *   wait?: (milliseconds: number) => Promise<void>,
   *   failureInjector?: (boundary: string) => Promise<void>,
   * }} [options]
   */
  constructor(root, {
    retain = 12,
    fileSystem = {},
    directorySync,
    leaseTimeoutMs = LEASE_TIMEOUT_MS,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    lockTimeoutMs = LOCK_TIMEOUT_MS,
    clock = Date.now,
    wait: waitFor = wait,
    failureInjector = async () => {},
  } = {}) {
    this.root = resolve(root);
    this.retain = Number.isSafeInteger(retain) && retain > 0 ? retain : 1;
    this.fileSystem = { ...nodeFileSystem, ...fileSystem };
    this.directorySync = directorySync
      ?? ((path) => syncDirectory(this.fileSystem, path));
    this.leaseTimeoutMs = leaseTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.lockTimeoutMs = lockTimeoutMs;
    this.clock = clock;
    this.wait = waitFor;
    this.failureInjector = failureInjector;
  }

  async commit(value, release, now = Date.now()) {
    if (typeof release !== 'string' || release.trim().length === 0) {
      throw new TypeError('BACKUP_RELEASE_REQUIRED');
    }
    const createdAt = new Date(now).toISOString();
    await this.fileSystem.mkdir(this.root, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(value);
    const lock = await acquireLock(this.fileSystem, this.root, {
      leaseTimeoutMs: this.leaseTimeoutMs,
      lockTimeoutMs: this.lockTimeoutMs,
      clock: this.clock,
      wait: this.wait,
    });
    const heartbeat = startHeartbeat(
      this.fileSystem,
      lock,
      this.heartbeatIntervalMs,
    );
    try {
      await heartbeat.refresh();
      const entries = await this.fileSystem.readdir(this.root);
      const generation = entries.reduce((highest, entry) => {
        const candidate = generationFromName(entry, ARCHIVE_PATTERN)
          ?? generationFromName(entry, MANIFEST_PATTERN);
        return candidate === null ? highest : Math.max(highest, candidate);
      }, 0) + 1;
      const manifest = {
        schema: SCHEMA,
        generation,
        createdAt,
        release,
        byteLength: bytes.byteLength,
        sha256: digest(bytes),
      };
      const suffix = randomUUID();
      const archiveTemporary = resolve(
        this.root,
        `.${archiveName(generation)}.${suffix}.tmp`,
      );
      const manifestTemporary = resolve(
        this.root,
        `.${manifestName(generation)}.${suffix}.tmp`,
      );

      try {
        await writeSynced(this.fileSystem, archiveTemporary, bytes);
        await this.failureInjector('archive-temp-write-fsync');
        await writeSynced(
          this.fileSystem,
          manifestTemporary,
          Buffer.from(`${JSON.stringify(manifest)}\n`),
        );
        await this.failureInjector('manifest-temp-write-fsync');
        await this.fileSystem.rename(
          archiveTemporary,
          resolve(this.root, archiveName(generation)),
        );
        await this.failureInjector('archive-rename');
        await this.directorySync(this.root);
        await this.failureInjector('archive-directory-sync');
        await heartbeat.refresh();
        await this.fileSystem.rename(
          manifestTemporary,
          resolve(this.root, manifestName(generation)),
        );
        await this.failureInjector('manifest-rename');
        await this.directorySync(this.root);
        await this.failureInjector('manifest-directory-sync');
        await heartbeat.refresh();
      } finally {
        await Promise.allSettled([
          this.fileSystem.unlink(archiveTemporary),
          this.fileSystem.unlink(manifestTemporary),
        ]);
      }

      const loaded = await verifiedPair(
        this.fileSystem,
        this.root,
        generation,
      );
      if (
        !loaded
        || !sameManifest(loaded.manifest, manifest)
        || !loaded.bytes.equals(bytes)
      ) {
        throw new Error('BACKUP_COMMIT_VERIFICATION_FAILED');
      }
      await this.prune();
      const retained = await verifiedPair(
        this.fileSystem,
        this.root,
        generation,
      );
      if (
        !retained
        || !sameManifest(retained.manifest, manifest)
        || !retained.bytes.equals(bytes)
      ) {
        throw new Error('BACKUP_COMMIT_VERIFICATION_FAILED');
      }
      return manifest;
    } finally {
      let heartbeatError;
      try {
        await heartbeat.stop();
      } catch (error) {
        heartbeatError = error;
      }
      await releaseLock(this.fileSystem, this.root, lock);
      if (heartbeatError) throw heartbeatError;
    }
  }

  async prune() {
    const entries = await this.fileSystem.readdir(this.root);
    const generations = entries
      .map((entry) => generationFromName(entry, MANIFEST_PATTERN))
      .filter((generation) => generation !== null)
      .sort((left, right) => right - left);
    const valid = [];
    for (const generation of generations) {
      if (await verifiedPair(this.fileSystem, this.root, generation)) {
        valid.push(generation);
      }
    }
    if (valid.length === 0) return;
    const retained = new Set(valid.slice(0, this.retain));
    let changed = false;
    for (const generation of valid.slice(this.retain)) {
      await this.fileSystem.unlink(
        resolve(this.root, manifestName(generation)),
      );
      await this.failureInjector('cleanup-unlink');
      await this.fileSystem.unlink(
        resolve(this.root, archiveName(generation)),
      );
      changed = true;
    }

    const staleBefore = Date.now() - ARTIFACT_MAX_AGE_MS;
    for (const entry of entries) {
      const generation = generationFromName(entry, ARCHIVE_PATTERN)
        ?? generationFromName(entry, MANIFEST_PATTERN);
      const cleanupCandidate = TEMPORARY_PATTERN.test(entry)
        || (generation !== null && !retained.has(generation));
      if (!cleanupCandidate) continue;
      const path = resolve(this.root, entry);
      let metadata;
      try {
        metadata = await this.fileSystem.stat(path);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (metadata.mtimeMs > staleBefore) continue;
      try {
        await this.fileSystem.unlink(path);
        await this.failureInjector('cleanup-unlink');
        changed = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    if (changed) await this.directorySync(this.root);
  }

  async loadLatest() {
    let entries;
    try {
      entries = await this.fileSystem.readdir(this.root);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('BACKUP_REQUIRED');
      throw error;
    }
    const generations = entries
      .map((entry) => generationFromName(entry, MANIFEST_PATTERN))
      .filter((generation) => generation !== null)
      .sort((left, right) => right - left);

    for (const generation of generations) {
      const pair = await verifiedPair(this.fileSystem, this.root, generation);
      if (pair) return pair;
    }

    throw new Error('BACKUP_REQUIRED');
  }
}
