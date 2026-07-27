export type BackupManifest = {
  version: 1;
  generation: number;
  objectKey: string;
  sha256: string;
  byteLength: number;
  createdAt: string;
  release: string;
};

type StoredObject = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type BackupBucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  list(options?: { prefix?: string }): Promise<{
    objects: Array<{ key: string }>;
  }>;
  delete(keys: string | string[]): Promise<unknown>;
};

export type ManifestStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: BackupManifest): Promise<unknown>;
};

const CURRENT_MANIFEST_KEY = 'wallet-backup-manifest';
const RETAIN_GENERATIONS = 7;

function validManifest(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return manifest.version === 1
    && Number.isSafeInteger(manifest.generation)
    && Number(manifest.generation) > 0
    && typeof manifest.objectKey === 'string'
    && /^wallet\/[1-9]\d*-[a-f0-9]{64}\.tar\.gz\.enc$/u
      .test(manifest.objectKey)
    && typeof manifest.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(manifest.sha256)
    && Number.isSafeInteger(manifest.byteLength)
    && Number(manifest.byteLength) > 0
    && typeof manifest.createdAt === 'string'
    && !Number.isNaN(Date.parse(manifest.createdAt))
    && typeof manifest.release === 'string'
    && manifest.release.length > 0;
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function currentManifest(
  storage: ManifestStorage,
): Promise<BackupManifest | undefined> {
  const value = await storage.get(CURRENT_MANIFEST_KEY);
  if (value === undefined) return undefined;
  if (!validManifest(value)) throw new Error('BACKUP_MANIFEST_INVALID');
  return value;
}

export async function loadVerifiedBackup(input: {
  bucket: BackupBucket;
  storage: ManifestStorage;
}): Promise<{
  manifest: BackupManifest;
  ciphertext: Uint8Array;
} | null> {
  const manifest = await currentManifest(input.storage);
  if (!manifest) return null;
  const object = await input.bucket.get(manifest.objectKey);
  if (!object) throw new Error('BACKUP_OBJECT_MISSING');
  const ciphertext = new Uint8Array(await object.arrayBuffer());
  if (
    ciphertext.byteLength !== manifest.byteLength
    || await sha256Hex(ciphertext) !== manifest.sha256
  ) {
    throw new Error('BACKUP_DIGEST_MISMATCH');
  }
  return { manifest, ciphertext };
}

function generationFromKey(key: string): number | null {
  const match = /^wallet\/([1-9]\d*)-[a-f0-9]{64}\.tar\.gz\.enc$/u.exec(key);
  return match ? Number(match[1]) : null;
}

async function pruneOldBackups(
  bucket: BackupBucket,
  current: BackupManifest,
): Promise<void> {
  const listed = await bucket.list({ prefix: 'wallet/' });
  const backups = listed.objects
    .map(({ key }) => ({ key, generation: generationFromKey(key) }))
    .filter(
      (entry): entry is { key: string; generation: number } =>
        entry.generation !== null,
    )
    .sort((left, right) => right.generation - left.generation);
  const keep = new Set(
    backups.slice(0, RETAIN_GENERATIONS).map((entry) => entry.key),
  );
  keep.add(current.objectKey);
  const removable = backups
    .filter((entry) => !keep.has(entry.key))
    .map((entry) => entry.key);
  if (removable.length > 0) await bucket.delete(removable);
}

export async function commitVerifiedBackup(input: {
  bucket: BackupBucket;
  storage: ManifestStorage;
  ciphertext: Uint8Array;
  expectedSha256: string;
  release: string;
  now: Date;
}): Promise<BackupManifest> {
  const ciphertext = new Uint8Array(input.ciphertext);
  const actualSha256 = await sha256Hex(ciphertext);
  if (actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw new Error('BACKUP_DIGEST_MISMATCH');
  }
  const previous = await currentManifest(input.storage);
  const generation = (previous?.generation ?? 0) + 1;
  const objectKey = `wallet/${generation}-${actualSha256}.tar.gz.enc`;
  await input.bucket.put(objectKey, ciphertext);

  const uploaded = await input.bucket.get(objectKey);
  if (!uploaded) throw new Error('BACKUP_UPLOAD_MISSING');
  const uploadedBytes = new Uint8Array(await uploaded.arrayBuffer());
  if (
    uploadedBytes.byteLength !== ciphertext.byteLength
    || await sha256Hex(uploadedBytes) !== actualSha256
  ) {
    throw new Error('BACKUP_UPLOAD_VERIFICATION_FAILED');
  }

  const manifest: BackupManifest = {
    version: 1,
    generation,
    objectKey,
    sha256: actualSha256,
    byteLength: ciphertext.byteLength,
    createdAt: input.now.toISOString(),
    release: input.release,
  };
  await input.storage.put(CURRENT_MANIFEST_KEY, manifest);
  await pruneOldBackups(input.bucket, manifest);
  return manifest;
}
