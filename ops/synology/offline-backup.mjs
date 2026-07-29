import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backupWallet } from '../cloudflare/container/backup.mjs';
import { GenerationStore } from './generationStore.mjs';

const DEFAULT_WALLET_DIRECTORY = '/var/lib/openstays/wavelength';
const DEFAULT_STAGING_ROOT = '/var/lib/openstays/runtime';
const DEFAULT_BACKUP_ROOT = '/var/backups/openstays';

function validBackupKey(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
    && Buffer.from(value, 'base64').byteLength === 32;
}

async function requireExactDirectory(path) {
  const expected = resolve(path);
  const metadata = await lstat(expected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('OFFLINE_BACKUP_DIRECTORY_INVALID');
  }
  if (await realpath(expected) !== expected) {
    throw new Error('OFFLINE_BACKUP_DIRECTORY_INVALID');
  }
}

/**
 * Create one verified generation from a wallet directory while no daemon is
 * running against it.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   walletDirectory?: string,
 *   stagingRoot?: string,
 *   backupRoot?: string,
 *   backupWalletImpl?: (
 *     walletDirectory: string,
 *     outputPath: string,
 *     backupKeyBase64: string,
 *   ) => PromiseLike<{ sha256: string, byteLength: number }>
 *     | { sha256: string, byteLength: number },
 *   storeFactory?: (root: string) => {
 *     commit(
 *       bytes: Uint8Array,
 *       release: string,
 *     ): Promise<Record<string, unknown>>,
 *   },
 * }} [options]
 */
export async function createOfflineBackup({
  env = process.env,
  walletDirectory = DEFAULT_WALLET_DIRECTORY,
  stagingRoot = DEFAULT_STAGING_ROOT,
  backupRoot = DEFAULT_BACKUP_ROOT,
  backupWalletImpl = backupWallet,
  storeFactory = (root) => new GenerationStore(root, { retain: 12 }),
} = {}) {
  const release = env.OPENSTAYS_RELEASE;
  if (typeof release !== 'string' || !/^[a-f0-9]{40}$/u.test(release)) {
    throw new Error('OPENSTAYS_RELEASE_INVALID');
  }
  const backupKeyBase64 = env.WALLET_BACKUP_KEY_BASE64;
  if (!validBackupKey(backupKeyBase64)) {
    throw new Error('WALLET_BACKUP_KEY_BASE64_INVALID');
  }

  await requireExactDirectory(walletDirectory);
  await requireExactDirectory(backupRoot);
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  await requireExactDirectory(stagingRoot);
  const requestDirectory = await mkdtemp(join(stagingRoot, 'offline-backup-'));
  const outputPath = join(requestDirectory, 'wallet.tar.gz.enc');
  try {
    const metadata = await backupWalletImpl(
      walletDirectory,
      outputPath,
      backupKeyBase64,
    );
    const bytes = Buffer.from(await readFile(outputPath));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      metadata?.sha256 !== digest
      || metadata?.byteLength !== bytes.byteLength
    ) {
      throw new Error('OFFLINE_BACKUP_RESULT_MISMATCH');
    }
    return await storeFactory(backupRoot).commit(bytes, release);
  } finally {
    await rm(requestDirectory, { recursive: true, force: true });
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  createOfflineBackup()
    .then((manifest) => {
      process.stdout.write(`${JSON.stringify({
        status: 'backed_up',
        ...manifest,
      })}\n`);
    })
    .catch((error) => {
      const category = error instanceof Error
        && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'OFFLINE_BACKUP_FAILED';
      process.stderr.write(`${category}\n`);
      process.exitCode = 1;
    });
}
