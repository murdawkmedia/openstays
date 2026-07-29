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
import { basename, dirname, join, resolve } from 'node:path';
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
    this.stopping = false;
  }

  async restore(ciphertext, expectedSha256) {
    if (this.restored || existsSync(this.options.walletDirectory)) {
      throw new Error('RESTORE_ALREADY_ATTEMPTED');
    }
    if (sha256(ciphertext) !== expectedSha256) {
      throw new Error('BACKUP_DIGEST_MISMATCH');
    }
    const walletParent = dirname(resolve(this.options.walletDirectory));
    mkdirSync(walletParent, { recursive: true });
    const staging = mkdtempSync(join(walletParent, '.openstays-wallet-'));
    const archivePath = join(staging, 'wallet.tar.gz.enc');
    const extracted = join(staging, 'wallet');
    try {
      writeFileSync(archivePath, ciphertext, { mode: 0o600 });
      restoreWallet(
        archivePath,
        extracted,
        this.options.backupKeyBase64,
      );
      renameSync(extracted, this.options.walletDirectory);
      chmodSync(this.options.walletDirectory, 0o700);
      this.restored = true;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  spawnRequired(command) {
    const spawnCommand = this.options.spawnCommand ?? spawn;
    const child = spawnCommand(command.file, command.args ?? [], {
      cwd: command.cwd,
      env: command.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const failRequiredProcess = () => {
      if (this.stopping) return;
      this.status = 'failed';
      this.failureCategory = 'required_process_exited';
      this.stop();
    };
    child.once('error', failRequiredProcess);
    child.once('exit', (code) => {
      if (code !== 0) failRequiredProcess();
    });
    this.processes.push(child);
  }

  async waitForDaemon() {
    const fetchDaemon = this.options.fetchDaemon ?? fetch;
    const wait = this.options.wait ?? ((delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await fetchDaemon(
          'http://127.0.0.1:10031/v1/daemon/get-info',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          },
        );
        // Before wallet creation, Wavelength may answer this probe with
        // FAILED_PRECONDITION. Any HTTP response proves the loopback gateway
        // is listening; the create/unlock call below remains authoritative.
        return;
      } catch {
        // The loopback gateway is still starting.
      }
      await wait(200);
    }
    throw new Error('WAVELENGTH_DAEMON_START_TIMEOUT');
  }

  async walletLifecycle(path) {
    const password = this.options.walletPassword ?? '';
    if (Buffer.byteLength(password, 'utf8') < 8) {
      throw new Error('WAVELENGTH_WALLET_PASSWORD_TOO_SHORT');
    }
    const fetchDaemon = this.options.fetchDaemon ?? fetch;
    const response = await fetchDaemon(
      `http://127.0.0.1:10031/v1/wallet/${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_password: Buffer.from(password, 'utf8').toString('base64'),
        }),
      },
    );
    if (!response.ok) {
      if (this.options.diagnosticLifecycleErrors) {
        const diagnostic = await response.clone().text();
        process.stderr.write(
          `merchant-daemon-diagnostic: ${diagnostic.slice(0, 2_000)}\n`,
        );
      }
      throw new Error(
        `WAVELENGTH_WALLET_${path.toUpperCase()}_FAILED_HTTP_${response.status}`,
      );
    }
    return await response.json();
  }

  startWorkers() {
    for (const command of this.options.workerCommands) {
      this.spawnRequired(command);
    }
  }

  async start() {
    if (!this.restored) throw new Error('RESTORE_REQUIRED');
    this.spawnRequired(this.options.daemonCommand);
    await this.waitForDaemon();
    await this.walletLifecycle('unlock');
    this.startWorkers();
    this.status = 'ready';
  }

  async bootstrap() {
    if (this.restored || existsSync(this.options.walletDirectory)) {
      throw new Error('BOOTSTRAP_ALREADY_ATTEMPTED');
    }
    mkdirSync(this.options.walletDirectory, { recursive: true, mode: 0o700 });
    this.spawnRequired(this.options.daemonCommand);
    await this.waitForDaemon();
    const created = await this.walletLifecycle('create');
    if (
      !Array.isArray(created.mnemonic)
      || created.mnemonic.length !== 24
      || created.mnemonic.some((word) => (
        typeof word !== 'string' || !/^[a-z]+$/u.test(word)
      ))
    ) {
      throw new Error('WAVELENGTH_CREATE_RESPONSE_INVALID');
    }
    this.restored = true;
    this.startWorkers();
    this.status = 'ready';
    return { mnemonic: created.mnemonic };
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
    this.stopping = true;
    for (const child of this.processes) child.kill('SIGTERM');
    this.processes = [];
  }
}

/**
 * @param {{
 *   health(): Record<string, unknown>,
 *   bootstrap(): Promise<{ mnemonic: string[] }>,
 *   backup(outputPath: string): Promise<{
 *     bytes?: Uint8Array,
 *     sha256: string,
 *     byteLength: number,
 *   }> | {
 *     bytes?: Uint8Array,
 *     sha256: string,
 *     byteLength: number,
 *   },
 *   restore?(ciphertext: Uint8Array, expectedSha256: string): Promise<void>,
 *   start?(): Promise<void>,
 *   stop(): void,
 * }} control
 * @param {string} token
 */
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
        if (
          typeof control.restore !== 'function'
          || typeof control.start !== 'function'
        ) {
          json(response, 404, { error: 'NOT_FOUND' });
          return;
        }
        const digest = String(request.headers['x-backup-sha256'] ?? '');
        await control.restore(await readBounded(request), digest);
        await control.start();
        json(response, 200, { status: 'ready' });
        return;
      }
      if (request.method === 'POST' && request.url === '/bootstrap') {
        const result = await control.bootstrap();
        json(response, 201, result);
        return;
      }
      if (request.method === 'POST' && request.url === '/backup') {
        const configuredOutputPath = resolve(
          process.env.WALLET_BACKUP_OUTPUT_PATH
            ?? '/run/openstays/wallet.tar.gz.enc',
        );
        const outputDirectory = dirname(configuredOutputPath);
        mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
        const requestDirectory = mkdtempSync(join(
          outputDirectory,
          `.${basename(configuredOutputPath)}-`,
        ));
        const outputPath = join(
          requestDirectory,
          basename(configuredOutputPath),
        );
        let result;
        let ciphertext;
        try {
          result = await control.backup(outputPath);
          ciphertext = result.bytes
            ? Buffer.from(result.bytes)
            : readFileSync(outputPath);
          if (
            result.sha256 !== sha256(ciphertext)
            || result.byteLength !== ciphertext.byteLength
          ) {
            throw new Error('BACKUP_RESULT_MISMATCH');
          }
        } finally {
          rmSync(requestDirectory, { recursive: true, force: true });
        }
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
    } catch (error) {
      const category = error instanceof Error
        && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'CONTROL_OPERATION_FAILED';
      process.stderr.write(`merchant-control: ${category.toLowerCase()}\n`);
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
    OTS_COMMAND: '/usr/local/bin/ots',
  };
  const control = new MerchantControl({
    walletDirectory,
    backupKeyBase64: process.env.WALLET_BACKUP_KEY_BASE64,
    walletPassword: process.env.WAVELENGTH_WALLET_PASSWORD,
    diagnosticLifecycleErrors:
      process.env.OPENSTAYS_DIAGNOSTIC_LIFECYCLE_ERRORS === 'true',
    release: process.env.OPENSTAYS_RELEASE ?? 'unknown',
    daemonCommand: {
      file: '/usr/local/bin/waved',
      args: [
        '--network=signet',
        `--datadir=${walletDirectory}`,
        `--logdir=${join(walletDirectory, 'logs')}`,
        '--wallet.esploraurl=https://mempool.space/signet/api',
        '--rpc.listenaddr=127.0.0.1:10029',
        '--rpc.gateway.listenaddr=127.0.0.1:10031',
        '--rpc.notls',
        '--rpc.no-macaroons',
      ],
      env: childEnv,
    },
    workerCommands: [
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
