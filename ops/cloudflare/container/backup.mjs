import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('OSWB1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function asKey(value) {
  const key = Buffer.from(value);
  if (key.byteLength !== 32) throw new Error('BACKUP_KEY_MUST_BE_32_BYTES');
  return key;
}

export function encryptArchive(plaintext, rawKey) {
  const key = asKey(rawKey);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([MAGIC, nonce, tag, ciphertext]));
}

export function decryptArchive(envelope, rawKey) {
  const key = asKey(rawKey);
  const bytes = Buffer.from(envelope);
  if (
    bytes.byteLength <= MAGIC.byteLength + NONCE_BYTES + TAG_BYTES
    || !bytes.subarray(0, MAGIC.byteLength).equals(MAGIC)
  ) {
    throw new Error('BACKUP_ENVELOPE_INVALID');
  }
  const nonceStart = MAGIC.byteLength;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    bytes.subarray(nonceStart, tagStart),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(tagStart, ciphertextStart));
  return new Uint8Array(Buffer.concat([
    decipher.update(bytes.subarray(ciphertextStart)),
    decipher.final(),
  ]));
}

export function deterministicTarGzip(walletDirectory) {
  const result = spawnSync('tar', [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    '-',
    '-C',
    resolve(walletDirectory),
    '.',
  ], {
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout?.byteLength) {
    throw new Error('BACKUP_ARCHIVE_FAILED');
  }
  return new Uint8Array(result.stdout);
}

export function backupWallet(walletDirectory, outputPath, base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  const envelope = encryptArchive(deterministicTarGzip(walletDirectory), key);
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), envelope, { mode: 0o600 });
  return {
    sha256: createHash('sha256').update(envelope).digest('hex'),
    byteLength: envelope.byteLength,
  };
}

export function restoreWallet(inputPath, outputDirectory, base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  const archive = decryptArchive(readFileSync(resolve(inputPath)), key);
  mkdirSync(resolve(outputDirectory), { recursive: true });
  const result = spawnSync('tar', [
    '-xzf',
    '-',
    '-C',
    resolve(outputDirectory),
    '--no-same-owner',
    '--no-same-permissions',
  ], {
    input: Buffer.from(archive),
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('BACKUP_RESTORE_FAILED');
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , walletDirectory, outputPath] = process.argv;
  const key = process.env.WALLET_BACKUP_KEY_BASE64 ?? '';
  if (!walletDirectory || !outputPath || !key) {
    process.stderr.write('wallet directory, output path, and backup key are required\n');
    process.exitCode = 2;
  } else {
    const result = backupWallet(walletDirectory, outputPath, key);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
