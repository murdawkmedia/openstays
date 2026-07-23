import { statSync } from 'node:fs';
import { resolve } from 'node:path';

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

const runtimeDirectory = resolve(process.argv[2] ?? 'public/wavewalletdk');
const missingAssets = requiredAssets.filter((asset) => {
  try {
    return !statSync(resolve(runtimeDirectory, asset)).isFile() ||
      statSync(resolve(runtimeDirectory, asset)).size === 0;
  } catch {
    return true;
  }
});

if (missingAssets.length > 0) {
  process.stderr.write(
    `Missing Wavelength browser runtime assets in ${runtimeDirectory}: ${missingAssets.join(', ')}.\n` +
    'Run `npm run wavelength:runtime`, then rebuild or restart the preview.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Wavelength browser runtime ready: ${runtimeDirectory}\n`);
}
