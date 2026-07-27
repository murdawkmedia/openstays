import { describe, expect, it } from 'vitest';

import {
  commitVerifiedBackup,
  loadVerifiedBackup,
  sha256Hex,
  type BackupManifest,
} from '../src/backupManifest';
import {
  decryptArchive,
  encryptArchive,
} from '../container/backup.mjs';

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly events: string[] = [];

  async put(key: string, value: Uint8Array) {
    this.events.push(`put:${key}`);
    this.objects.set(key, new Uint8Array(value));
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value
      ? { arrayBuffer: async () => new Uint8Array(value).buffer }
      : null;
  }

  async list() {
    return { objects: [...this.objects.keys()].map((key) => ({ key })) };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.events.push(`delete:${key}`);
      this.objects.delete(key);
    }
  }
}

class MemoryStorage {
  current?: BackupManifest;
  readonly events: string[];

  constructor(events: string[]) {
    this.events = events;
  }

  async get() {
    return this.current;
  }

  async put(_key: string, value: BackupManifest) {
    this.events.push(`manifest:${value.generation}`);
    this.current = value;
  }
}

describe('encrypted backup envelope', () => {
  it('encrypts with AES-256-GCM and rejects a wrong key or tag', () => {
    const plaintext = new TextEncoder().encode('wallet database contents');
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = encryptArchive(plaintext, key);

    expect(encrypted).not.toEqual(plaintext);
    expect(decryptArchive(encrypted, key)).toEqual(plaintext);
    expect(() => decryptArchive(encrypted, wrongKey)).toThrow();
    const tampered = new Uint8Array(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptArchive(tampered, key)).toThrow();
  });
});

describe('verified backup manifests', () => {
  it('writes immutable ciphertext, verifies it, then advances the pointer', async () => {
    const bucket = new MemoryBucket();
    const storage = new MemoryStorage(bucket.events);
    const ciphertext = new TextEncoder().encode('ciphertext');
    const digest = await sha256Hex(ciphertext);
    const manifest = await commitVerifiedBackup({
      bucket,
      storage,
      ciphertext,
      expectedSha256: digest,
      release: 'test',
      now: new Date('2026-07-26T12:00:00Z'),
    });

    expect(manifest.objectKey).toBe(`wallet/1-${digest}.tar.gz.enc`);
    expect(bucket.events).toEqual([
      `put:${manifest.objectKey}`,
      'manifest:1',
    ]);
    await expect(loadVerifiedBackup({ bucket, storage }))
      .resolves.toMatchObject({ manifest });
  });

  it('does not advance the pointer for a bad digest', async () => {
    const bucket = new MemoryBucket();
    const storage = new MemoryStorage(bucket.events);
    await expect(commitVerifiedBackup({
      bucket,
      storage,
      ciphertext: new TextEncoder().encode('ciphertext'),
      expectedSha256: '0'.repeat(64),
      release: 'test',
      now: new Date(),
    })).rejects.toThrow('BACKUP_DIGEST_MISMATCH');
    expect(storage.current).toBeUndefined();
  });

  it('retains only the seven newest verified generations', async () => {
    const bucket = new MemoryBucket();
    const storage = new MemoryStorage(bucket.events);
    for (let generation = 1; generation <= 9; generation += 1) {
      const ciphertext = new TextEncoder().encode(`ciphertext-${generation}`);
      await commitVerifiedBackup({
        bucket,
        storage,
        ciphertext,
        expectedSha256: await sha256Hex(ciphertext),
        release: 'test',
        now: new Date(Date.UTC(2026, 6, 26, 12, generation)),
      });
    }
    expect([...bucket.objects.keys()]).toHaveLength(7);
    expect([...bucket.objects.keys()]).toContain(storage.current!.objectKey);
  });
});
