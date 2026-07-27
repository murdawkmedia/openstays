import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { backupWallet, restoreWallet } from './backup.mjs';

const HOST = '127.0.0.1';
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

function authorized(header, expected) {
  if (!header?.startsWith('Bearer ') || !expected) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBounded(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class MerchantControl {
  constructor(options) {
    this.options = options;
    this.processes = [];
    this.status = 'starting';
    this.failureCategory = undefined;
    this.restored = false;
  }

  async restore(ciphertext, expectedSha256) {
    if (this.restored || existsSync(this.options.walletDirectory)) {
      throw new Error('RESTORE_ALREADY_ATTEMPTED');
    }
    if (sha256(ciphertext) !== expectedSha256) {
      throw new Error('BACKUP_DIGEST_MISMATCH');
    }
    const staging = mkdtempSync(join(tmpdir(), 'openstays-wallet-'));
    const archivePath = join(staging, 'wallet.tar.gz.enc');
    const extracted = join(staging, 'wallet');
    try {
      writeFileSync(archivePath, ciphertext, { mode: 0o600 });
      restoreWallet(
        archivePath,
        extracted,
        this.options.backupKeyBase64,
      );
      mkdirSync(dirname(this.options.walletDirectory), { recursive: true });
      renameSync(extracted, this.options.walletDirectory);
      chmodSync(this.options.walletDirectory, 0o700);
      this.restored = true;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  start() {
    if (!this.restored) throw new Error('RESTORE_REQUIRED');
    const failRequiredProcess = () => {
      this.status = 'failed';
      this.failureCategory = 'required_process_exited';
      this.stop();
    };
    for (const command of this.options.commands) {
      const child = spawn(command.file, command.args ?? [], {
        cwd: command.cwd,
        env: command.env,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.once('error', failRequiredProcess);
      child.once('exit', (code) => {
        if (code !== 0) failRequiredProcess();
      });
      this.processes.push(child);
    }
    this.status = 'ready';
  }

  backup(outputPath) {
    if (this.status !== 'ready') throw new Error('MERCHANT_NOT_READY');
    return backupWallet(
      this.options.walletDirectory,
      outputPath,
      this.options.backupKeyBase64,
    );
  }

  health() {
    return {
      status: this.status,
      failureCategory: this.failureCategory,
      release: this.options.release,
    };
  }

  stop() {
    for (const child of this.processes) child.kill('SIGTERM');
    this.processes = [];
  }
}

export function createControlServer(control, token) {
  return createServer(async (request, response) => {
    try {
      if (!authorized(request.headers.authorization, token)) {
        json(response, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        json(response, 200, control.health());
        return;
      }
      if (request.method === 'POST' && request.url === '/restore') {
        const digest = String(request.headers['x-backup-sha256'] ?? '');
        await control.restore(await readBounded(request), digest);
        control.start();
        json(response, 202, { status: 'starting' });
        return;
      }
      if (request.method === 'POST' && request.url === '/backup') {
        const outputPath = resolve(
          process.env.WALLET_BACKUP_OUTPUT_PATH
            ?? '/run/openstays/wallet.tar.gz.enc',
        );
        const result = control.backup(outputPath);
        const ciphertext = readFileSync(outputPath);
        rmSync(outputPath, { force: true });
        response.writeHead(201, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Backup-Sha256': result.sha256,
          'Content-Length': String(result.byteLength),
        });
        response.end(ciphertext);
        return;
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch {
      json(response, 503, { error: 'CONTROL_OPERATION_FAILED' });
    }
  });
}

if (process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const walletDirectory = process.env.WAVELENGTH_WALLET_DIRECTORY
    ?? '/var/lib/openstays/wavelength';
  const cli = '/app/cli/dist/index.js';
  const childEnv = {
    ...process.env,
    WAVELENGTH_DAEMON_URL: 'http://127.0.0.1:10031',
    WAVELENGTH_EXPECTED_NETWORK: 'signet',
    WAVELENGTH_DAEMON_MACAROON_PATH: join(
      walletDirectory,
      'data',
      'signet',
      'admin.macaroon',
    ),
    OTS_COMMAND: '/usr/local/bin/ots',
  };
  const control = new MerchantControl({
    walletDirectory,
    backupKeyBase64: process.env.WALLET_BACKUP_KEY_BASE64,
    release: process.env.OPENSTAYS_RELEASE ?? 'unknown',
    commands: [
      {
        file: '/usr/local/bin/waved',
        args: [
          '--network=signet',
          `--datadir=${walletDirectory}`,
          `--logdir=${join(walletDirectory, 'logs')}`,
          `--wallet.password_file=${process.env.WAVELENGTH_WALLET_PASSWORD_FILE
            ?? join(walletDirectory, 'merchant-wallet.password')}`,
          '--wallet.esploraurl=https://mempool.space/signet/api',
          '--rpc.listenaddr=127.0.0.1:10029',
          '--rpc.gateway.listenaddr=127.0.0.1:10031',
          '--rpc.notls',
        ],
        env: childEnv,
      },
      { file: process.execPath, args: [cli, 'wave-bridge'], env: childEnv },
      { file: process.execPath, args: [cli, 'ots-bridge'], env: childEnv },
      { file: process.execPath, args: [cli, 'mail-bridge'], env: childEnv },
    ],
  });
  const server = createControlServer(
    control,
    process.env.CONTAINER_CONTROL_TOKEN ?? '',
  );
  server.listen(Number(process.env.CONTROL_PORT ?? 8_080), HOST);
  const shutdown = () => {
    control.stop();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
