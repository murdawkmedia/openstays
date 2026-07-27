import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEMA = 'openstays.synology-wallet-backup.v1';
const ARCHIVE_PATTERN = /^generation-([1-9]\d*)\.archive$/u;
const MANIFEST_PATTERN = /^generation-([1-9]\d*)\.manifest\.json$/u;

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

async function verifiedPair(root, generation) {
  try {
    const manifest = JSON.parse(await readFile(
      resolve(root, manifestName(generation)),
      'utf8',
    ));
    const bytes = await readFile(resolve(root, archiveName(generation)));
    if (
      validManifest(manifest)
      && manifest.generation === generation
      && manifest.byteLength === bytes.byteLength
      && manifest.sha256 === digest(bytes)
    ) {
      return { bytes, manifest };
    }
  } catch {
    // Missing or malformed files do not form a verified generation.
  }
  return null;
}

async function writeSynced(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class GenerationStore {
  constructor(root, { retain = 12 } = {}) {
    this.root = resolve(root);
    this.retain = Number.isSafeInteger(retain) && retain > 0 ? retain : 1;
  }

  async commit(value, release, now = Date.now()) {
    if (typeof release !== 'string' || release.trim().length === 0) {
      throw new TypeError('BACKUP_RELEASE_REQUIRED');
    }
    const createdAt = new Date(now).toISOString();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(value);
    const entries = await readdir(this.root);
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
      await writeSynced(archiveTemporary, bytes);
      await writeSynced(
        manifestTemporary,
        Buffer.from(`${JSON.stringify(manifest)}\n`),
      );
      await rename(
        archiveTemporary,
        resolve(this.root, archiveName(generation)),
      );
      await syncDirectory(this.root);
      await rename(
        manifestTemporary,
        resolve(this.root, manifestName(generation)),
      );
      await syncDirectory(this.root);
    } finally {
      await Promise.allSettled([
        unlink(archiveTemporary),
        unlink(manifestTemporary),
      ]);
    }

    const loaded = await this.loadLatest();
    if (loaded.manifest.generation !== generation) {
      throw new Error('BACKUP_COMMIT_VERIFICATION_FAILED');
    }
    await this.prune();
    return manifest;
  }

  async prune() {
    const entries = await readdir(this.root);
    const generations = entries
      .map((entry) => generationFromName(entry, MANIFEST_PATTERN))
      .filter((generation) => generation !== null)
      .sort((left, right) => right - left);
    const valid = [];
    for (const generation of generations) {
      if (await verifiedPair(this.root, generation)) valid.push(generation);
    }
    for (const generation of valid.slice(this.retain)) {
      await unlink(resolve(this.root, manifestName(generation)));
      await unlink(resolve(this.root, archiveName(generation)));
    }
  }

  async loadLatest() {
    let entries;
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('BACKUP_REQUIRED');
      throw error;
    }
    const generations = entries
      .map((entry) => generationFromName(entry, MANIFEST_PATTERN))
      .filter((generation) => generation !== null)
      .sort((left, right) => right - left);

    for (const generation of generations) {
      const pair = await verifiedPair(this.root, generation);
      if (pair) return pair;
    }

    throw new Error('BACKUP_REQUIRED');
  }
}
