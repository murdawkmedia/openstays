import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

const scratchDirectories: string[] = [];
const checker = resolve('scripts/check-wavelength-runtime.mjs');
const requiredAssets = [
  'wavewalletdk.wasm',
  'wavewalletdk.wasm.gz',
  'wasm_exec.js',
  'sqlite-bridge.js',
  'sqlite-worker.js',
  'sqlite3.js',
  'sqlite3.wasm',
  'sqlite3-opfs-async-proxy.js',
];

function scratchDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'openstays-wave-runtime-'));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Wavelength runtime preflight', () => {
  test('fails with an actionable message when a runtime asset is missing', () => {
    const directory = scratchDirectory();
    const result = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing Wavelength browser runtime assets');
    expect(result.stderr).toContain('npm run wavelength:runtime');
    expect(result.stderr).toContain('sqlite-bridge.js');
  });

  test('accepts a complete non-empty version-matched runtime set', () => {
    const directory = scratchDirectory();
    for (const asset of requiredAssets) writeFileSync(join(directory, asset), asset);

    const result = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Wavelength browser runtime ready');
  });

  test('guards preview and live browser acceptance without breaking clean CI builds', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['wavelength:runtime:check']).toBe(
      'node scripts/check-wavelength-runtime.mjs',
    );
    expect(packageJson.scripts.prepreview).toBe(
      'npm run wavelength:runtime:check -- dist/wavewalletdk',
    );
    expect(packageJson.scripts['pretest:e2e:smoke']).toBe('npm run wavelength:runtime:check');
  });
});
