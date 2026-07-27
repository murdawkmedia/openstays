import { createHash, randomUUID } from 'node:crypto';
import * as nodeFileSystem from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const SCHEMA = 'openstays.synology-wallet-backup.v1';
const LOCK_DIRECTORY = '.generation-store.lock';
const LOCK_OWNER = 'owner.json';
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_INITIALIZATION_GRACE_MS = 30_000;
const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const ARCHIVE_PATTERN = /^generation-([1-9]\d*)\.archive$/u;
const MANIFEST_PATTERN = /^generation-([1-9]\d*)\.manifest\.json$/u;
const TEMPORARY_PATTERN =
  /^\.generation-[1-9]\d*\.(?:archive|manifest\.json)\.[^.]+\.tmp$/u;

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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function removeLock(fileSystem, lockPath, ownerPath) {
  try {
    await fileSystem.unlink(ownerPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await fileSystem.rmdir(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function reclaimAbandonedLock(fileSystem, lockPath, ownerPath) {
  let owner;
  try {
    owner = JSON.parse(await fileSystem.readFile(ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error;
    }
    let lock;
    try {
      lock = await fileSystem.stat(lockPath);
    } catch (statError) {
      if (statError?.code === 'ENOENT') return true;
      throw statError;
    }
    if (Date.now() - lock.mtimeMs < LOCK_INITIALIZATION_GRACE_MS) {
      return false;
    }
    await removeLock(fileSystem, lockPath, ownerPath);
    return true;
  }

  const validPid = owner
    && typeof owner === 'object'
    && !Array.isArray(owner)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0;
  if (!validPid) {
    const lock = await fileSystem.stat(lockPath);
    if (Date.now() - lock.mtimeMs < LOCK_INITIALIZATION_GRACE_MS) return false;
  } else if (processIsAlive(owner.pid)) {
    return false;
  }
  await removeLock(fileSystem, lockPath, ownerPath);
  return true;
}

async function acquireLock(fileSystem, root) {
  const lockPath = resolve(root, LOCK_DIRECTORY);
  const ownerPath = resolve(lockPath, LOCK_OWNER);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fileSystem.mkdir(lockPath, { mode: 0o700 });
      const owner = {
        pid: process.pid,
        token: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      try {
        await writeSynced(
          fileSystem,
          ownerPath,
          Buffer.from(`${JSON.stringify(owner)}\n`),
        );
      } catch (error) {
        await removeLock(fileSystem, lockPath, ownerPath);
        throw error;
      }
      return { lockPath, ownerPath, token: owner.token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await reclaimAbandonedLock(fileSystem, lockPath, ownerPath)) {
        continue;
      }
      if (Date.now() >= deadline) throw new Error('BACKUP_LOCK_TIMEOUT');
      await wait(LOCK_RETRY_MS);
    }
  }
}

async function releaseLock(fileSystem, lock) {
  let owner;
  try {
    owner = JSON.parse(await fileSystem.readFile(lock.ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
    }
    throw error;
  }
  if (owner.token !== lock.token) {
    throw new Error('BACKUP_LOCK_OWNERSHIP_LOST');
  }
  await removeLock(fileSystem, lock.lockPath, lock.ownerPath);
}

export class GenerationStore {
  /**
   * @param {string} root
   * @param {{
   *   retain?: number,
   *   fileSystem?: Record<string, unknown>,
   *   directorySync?: (path: string) => Promise<void>,
   * }} [options]
   */
  constructor(root, {
    retain = 12,
    fileSystem = {},
    directorySync,
  } = {}) {
    this.root = resolve(root);
    this.retain = Number.isSafeInteger(retain) && retain > 0 ? retain : 1;
    this.fileSystem = { ...nodeFileSystem, ...fileSystem };
    this.directorySync = directorySync
      ?? ((path) => syncDirectory(this.fileSystem, path));
  }

  async commit(value, release, now = Date.now()) {
    if (typeof release !== 'string' || release.trim().length === 0) {
      throw new TypeError('BACKUP_RELEASE_REQUIRED');
    }
    const createdAt = new Date(now).toISOString();
    await this.fileSystem.mkdir(this.root, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(value);
    const lock = await acquireLock(this.fileSystem, this.root);
    try {
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
        await writeSynced(
          this.fileSystem,
          manifestTemporary,
          Buffer.from(`${JSON.stringify(manifest)}\n`),
        );
        await this.fileSystem.rename(
          archiveTemporary,
          resolve(this.root, archiveName(generation)),
        );
        await this.directorySync(this.root);
        await this.fileSystem.rename(
          manifestTemporary,
          resolve(this.root, manifestName(generation)),
        );
        await this.directorySync(this.root);
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
      await releaseLock(this.fileSystem, lock);
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
