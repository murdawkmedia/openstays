import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
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
    const staleLock = join(root, '.generation-store.lock');
    const staleToken = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await mkdir(staleLock);
    await writeFile(
      join(staleLock, `lease-${staleToken}.json`),
      JSON.stringify({
        token: staleToken,
        heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const inputs = [
      { bytes: Buffer.from('concurrent-one'), release: 'release-one' },
      { bytes: Buffer.from('concurrent-two'), release: 'release-two' },
    ];

    const manifests = await Promise.all(inputs.map((input, index) =>
      commitInChild({ root, ...input, now: 1_000 + index })));

    expect(manifests.map(({ generation }) => generation).sort())
      .toEqual([1, 2]);
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
  });

  it('recovers a stale same-PID lease after a container restart', async () => {
    const root = await temporaryRoot();
    const lock = join(root, '.generation-store.lock');
    await mkdir(lock);
    const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await writeFile(join(lock, `lease-${token}.json`), JSON.stringify({
      token,
      pid: process.pid,
      heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    await expect(new GenerationStore(root, {
      leaseTimeoutMs: 100,
    }).commit(
      Buffer.from('wallet-after-crash'),
      'release-after-crash',
      1_000,
    )).resolves.toMatchObject({ generation: 1 });
    expect(await readdir(root)).not.toContain('.generation-store.lock');
  });

  it('does not steal fresh leases regardless of PID metadata', async () => {
    for (const pid of [process.pid, process.pid + 100_000]) {
      const root = await temporaryRoot();
      const lock = join(root, '.generation-store.lock');
      await mkdir(lock);
      const token = randomUUID();
      await writeFile(join(lock, `lease-${token}.json`), JSON.stringify({
        token,
        pid,
        heartbeatAt: new Date().toISOString(),
      }));
      const store = new GenerationStore(root, {
        leaseTimeoutMs: 5_000,
        lockTimeoutMs: 30,
      });

      await expect(store.commit(
        Buffer.from('must-not-publish'),
        'release-blocked',
        1_000,
      )).rejects.toThrow('BACKUP_LOCK_TIMEOUT');
      expect(await readdir(lock)).toContain(`lease-${token}.json`);
    }
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

  it('recovers the previous pair when publication stops after the archive', async () => {
    const root = await temporaryRoot();
    const previousBytes = Buffer.from('previous-wallet');
    const previous = await new GenerationStore(root).commit(
      previousBytes,
      'release-previous',
      1_000,
    );
    const failure = new Error('injected archive durability failure');
    let syncCount = 0;
    const interrupted = new GenerationStore(root, {
      directorySync: async () => {
        syncCount += 1;
        if (syncCount === 1) throw failure;
      },
    });

    await expect(interrupted.commit(
      Buffer.from('new-wallet'),
      'release-new',
      2_000,
    )).rejects.toBe(failure);
    await expect(new GenerationStore(root).loadLatest()).resolves.toEqual({
      bytes: previousBytes,
      manifest: previous,
    });
  });

  it('recovers the new pair when manifest directory sync fails', async () => {
    const root = await temporaryRoot();
    await new GenerationStore(root).commit(
      Buffer.from('previous-wallet'),
      'release-previous',
      1_000,
    );
    const newBytes = Buffer.from('new-wallet');
    const failure = new Error('injected manifest durability failure');
    let syncCount = 0;
    const interrupted = new GenerationStore(root, {
      directorySync: async () => {
        syncCount += 1;
        if (syncCount === 2) throw failure;
      },
    });

    await expect(interrupted.commit(
      newBytes,
      'release-new',
      2_000,
    )).rejects.toBe(failure);
    await expect(new GenerationStore(root).loadLatest()).resolves.toEqual({
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
