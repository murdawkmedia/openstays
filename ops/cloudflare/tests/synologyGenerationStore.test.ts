import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GenerationStore,
} from '../../synology/generationStore.mjs';

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openstays-generations-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('Synology wallet backup generations', () => {
  it('requires a backup when no verified pair exists', async () => {
    const root = join(await temporaryRoot(), 'not-created-yet');
    const store = new GenerationStore(root);

    await expect(store.loadLatest()).rejects.toThrow('BACKUP_REQUIRED');
  });

  it('publishes and reloads a verified generation', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root, { retain: 3 });
    const bytes = Buffer.from('encrypted-wallet');

    const manifest = await store.commit(bytes, 'release-1', 1_000);

    expect(manifest).toMatchObject({
      schema: 'openstays.synology-wallet-backup.v1',
      generation: 1,
      createdAt: '1970-01-01T00:00:01.000Z',
      release: 'release-1',
      byteLength: bytes.byteLength,
    });
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(store.loadLatest()).resolves.toEqual({ bytes, manifest });
  });

  it('rejects a corrupted archive when no valid pair remains', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root);
    const manifest = await store.commit(
      Buffer.from('verified-wallet'),
      'release-1',
      1_000,
    );
    await writeFile(
      join(root, `generation-${manifest.generation}.archive`),
      Buffer.from('tampered-wallet'),
    );

    await expect(store.loadLatest()).rejects.toThrow('BACKUP_REQUIRED');
  });

  it('falls back to the newest older valid generation', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root);
    const firstBytes = Buffer.from('wallet-one');
    const first = await store.commit(firstBytes, 'release-1', 1_000);
    const second = await store.commit(
      Buffer.from('wallet-two'),
      'release-2',
      2_000,
    );
    await writeFile(
      join(root, `generation-${second.generation}.archive`),
      Buffer.from('tamper-two'),
    );
    const entriesBeforeLoad = await readdir(root);

    await expect(store.loadLatest()).resolves.toEqual({
      bytes: firstBytes,
      manifest: first,
    });
    expect(await readdir(root)).toEqual(entriesBeforeLoad);
  });

  it('retains a bounded set of valid generations', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root, { retain: 3 });
    const committed: number[] = [];

    for (let generation = 1; generation <= 4; generation += 1) {
      const manifest = await store.commit(
        Buffer.from(`wallet-${generation}`),
        `release-${generation}`,
        generation * 1_000,
      );
      committed.push(manifest.generation);
    }

    expect(committed).toEqual([1, 2, 3, 4]);
    const entries = await readdir(root);
    expect(
      entries.filter((entry) => entry.endsWith('.archive')),
    ).toHaveLength(3);
    expect(
      entries.filter((entry) => entry.endsWith('.manifest.json')),
    ).toHaveLength(3);
    await expect(store.loadLatest()).resolves.toMatchObject({
      manifest: { generation: 4 },
    });
  });

  it('ignores interrupted files without reusing an archive generation', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root);
    const firstBytes = Buffer.from('wallet-one');
    const first = await store.commit(firstBytes, 'release-1', 1_000);
    await writeFile(
      join(root, '.generation-99.archive.interrupted.tmp'),
      Buffer.from('temporary-archive'),
    );
    await writeFile(
      join(root, '.generation-99.manifest.json.interrupted.tmp'),
      Buffer.from('{}'),
    );
    await writeFile(
      join(root, 'generation-8.archive'),
      Buffer.from('orphan-archive'),
    );

    await expect(store.loadLatest()).resolves.toEqual({
      bytes: firstBytes,
      manifest: first,
    });
    await expect(
      store.commit(Buffer.from('wallet-next'), 'release-2', 2_000),
    ).resolves.toMatchObject({ generation: 9 });
  });

  it('rejects a manifest with a non-ISO creation time', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root);
    const manifest = await store.commit(
      Buffer.from('wallet-one'),
      'release-1',
      1_000,
    );
    const path = join(
      root,
      `generation-${manifest.generation}.manifest.json`,
    );
    const stored = JSON.parse(await readFile(path, 'utf8')) as {
      createdAt: string;
    };
    stored.createdAt = 'not-an-ISO-time';
    await writeFile(path, `${JSON.stringify(stored)}\n`);

    await expect(store.loadLatest()).rejects.toThrow('BACKUP_REQUIRED');
  });
});
