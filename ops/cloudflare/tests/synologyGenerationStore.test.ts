import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

async function commitInChild(input: {
  root: string;
  bytes: Buffer;
  release: string;
  now: number;
}) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    '..',
    'synology',
    'generationStore.mjs',
  )).href;
  const script = `
    const [moduleUrl, root, content, release, now] = process.argv.slice(1);
    const { GenerationStore } = await import(moduleUrl);
    const manifest = await new GenerationStore(root).commit(
      Buffer.from(content, 'base64'),
      release,
      Number(now),
    );
    process.stdout.write(JSON.stringify(manifest));
  `;
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    moduleUrl,
    input.root,
    input.bytes.toString('base64'),
    input.release,
    String(input.now),
  ]);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(JSON.parse(stdout) as Record<string, unknown>);
      } else {
        reject(new Error(`child commit exited ${code}: ${stderr}`));
      }
    });
  });
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

  it('serializes concurrent commits and acknowledges their exact pairs', async () => {
    const root = await temporaryRoot();
    const inputs = Array.from({ length: 8 }, (_, index) => ({
      bytes: Buffer.from(`concurrent-${index + 1}`),
      release: `release-${index + 1}`,
    }));

    const manifests = await Promise.all(inputs.map((input, index) =>
      commitInChild({ root, ...input, now: 1_000 + index })));

    expect(manifests.map(({ generation }) => generation).sort())
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [index, manifest] of manifests.entries()) {
      const storedManifest = JSON.parse(await readFile(
        join(root, `generation-${manifest.generation}.manifest.json`),
        'utf8',
      ));
      expect(storedManifest).toEqual(manifest);
      expect(await readFile(
        join(root, `generation-${manifest.generation}.archive`),
      )).toEqual(inputs[index]?.bytes);
      expect(manifest.release).toBe(inputs[index]?.release);
    }
    expect(
      (await readdir(root)).filter((entry) => entry.endsWith('.claim')),
    ).toEqual([]);
  });

  it('never reuses an orphaned generation claim', async () => {
    const root = await temporaryRoot();
    const orphan = join(root, 'generation-7.claim');
    await writeFile(orphan, '{"crashed":true}\n');
    const stale = new Date(Date.now() - (2 * 24 * 60 * 60 * 1_000));
    await utimes(orphan, stale, stale);
    const store = new GenerationStore(root);

    await expect(store.commit(
      Buffer.from('wallet-eight'),
      'release-eight',
      8_000,
    )).resolves.toMatchObject({ generation: 8 });
    await expect(store.commit(
      Buffer.from('wallet-nine'),
      'release-nine',
      9_000,
    )).resolves.toMatchObject({ generation: 9 });
    expect(await readFile(orphan, 'utf8')).toBe('{"crashed":true}\n');
  });

  it('recovers exactly across every injected publication boundary', async () => {
    const cases = [
      ['archive-temp-write-fsync', 'previous'],
      ['manifest-temp-write-fsync', 'previous'],
      ['archive-rename', 'previous'],
      ['archive-directory-sync', 'previous'],
      ['manifest-rename', 'new'],
      ['manifest-directory-sync', 'new'],
      ['cleanup-unlink', 'new'],
    ] as const;

    for (const [boundary, expected] of cases) {
      const root = await temporaryRoot();
      const previousBytes = Buffer.from(`previous-${boundary}`);
      const previous = await new GenerationStore(root).commit(
        previousBytes,
        'release-previous',
        1_000,
      );
      const newBytes = Buffer.from(`new-${boundary}`);
      const failure = new Error(`injected ${boundary}`);
      const interrupted = new GenerationStore(root, {
        retain: 1,
        failureInjector: async (current: string) => {
          if (current === boundary) throw failure;
        },
      });

      await expect(interrupted.commit(
        newBytes,
        'release-new',
        2_000,
      )).rejects.toBe(failure);
      const recovered = await new GenerationStore(root).loadLatest();
      if (expected === 'previous') {
        expect(recovered).toEqual({ bytes: previousBytes, manifest: previous });
      } else {
        expect(recovered).toEqual({
          bytes: newBytes,
          manifest: {
            schema: 'openstays.synology-wallet-backup.v1',
            generation: 2,
            createdAt: '1970-01-01T00:00:02.000Z',
            release: 'release-new',
            byteLength: newBytes.byteLength,
            sha256: createHash('sha256').update(newBytes).digest('hex'),
          },
        });
      }
    }
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

  it('propagates operational read errors instead of falling back', async () => {
    const root = await temporaryRoot();
    const writer = new GenerationStore(root);
    await writer.commit(Buffer.from('wallet-one'), 'release-1', 1_000);
    await writer.commit(Buffer.from('wallet-two'), 'release-2', 2_000);
    const failure = Object.assign(new Error('injected read failure'), {
      code: 'EIO',
    });
    const reader = new GenerationStore(root, {
      fileSystem: {
        async readFile(path: string, encoding?: BufferEncoding) {
          if (path.endsWith('generation-2.manifest.json')) throw failure;
          return readFile(path, encoding);
        },
      },
    });

    await expect(reader.loadLatest()).rejects.toBe(failure);
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

  it('never prunes a generation that still has a claim', async () => {
    const root = await temporaryRoot();
    const writer = new GenerationStore(root, { retain: 3 });
    for (let generation = 1; generation <= 3; generation += 1) {
      await writer.commit(
        Buffer.from(`wallet-${generation}`),
        `release-${generation}`,
        generation * 1_000,
      );
    }
    await writeFile(
      join(root, 'generation-1.claim'),
      '{"inFlight":true}\n',
    );

    await new GenerationStore(root, { retain: 1 }).commit(
      Buffer.from('wallet-four'),
      'release-four',
      4_000,
    );

    const entries = await readdir(root);
    expect(entries).toContain('generation-1.claim');
    expect(entries).toContain('generation-1.archive');
    expect(entries).toContain('generation-1.manifest.json');
    expect(entries).toContain('generation-4.archive');
    expect(entries).not.toContain('generation-2.archive');
    expect(entries).not.toContain('generation-3.archive');
  });

  it('removes only stale invalid artifacts after a verified generation exists', async () => {
    const root = await temporaryRoot();
    const store = new GenerationStore(root, { retain: 3 });
    await store.commit(Buffer.from('wallet-one'), 'release-1', 1_000);
    const stale = new Date(Date.now() - (2 * 24 * 60 * 60 * 1_000));
    await utimes(join(root, 'generation-1.archive'), stale, stale);
    await utimes(join(root, 'generation-1.manifest.json'), stale, stale);
    const staleArtifacts = [
      '.generation-40.archive.interrupted.tmp',
      'generation-41.archive',
      'generation-42.archive',
      'generation-42.manifest.json',
    ];
    for (const entry of staleArtifacts) {
      const path = join(root, entry);
      await writeFile(path, entry.endsWith('.json') ? '{}' : 'invalid');
      await utimes(path, stale, stale);
    }
    const recentOrphan = 'generation-43.archive';
    await writeFile(join(root, recentOrphan), 'recent-orphan');

    const latest = await store.commit(
      Buffer.from('wallet-latest'),
      'release-latest',
      2_000,
    );

    const entries = await readdir(root);
    for (const entry of staleArtifacts) expect(entries).not.toContain(entry);
    expect(entries).toContain(recentOrphan);
    expect(entries).toContain('generation-1.archive');
    expect(entries).toContain('generation-1.manifest.json');
    await expect(new GenerationStore(root).loadLatest()).resolves
      .toMatchObject({ manifest: latest });
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
