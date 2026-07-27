import { createHash } from 'node:crypto';
import {
  accessSync,
  constants as fileSystemConstants,
  mkdirSync,
} from 'node:fs';
import * as nodeFileSystem from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  createControlServer,
  MerchantControl,
} from '../cloudflare/container/control.mjs';
import { GenerationStore } from './generationStore.mjs';

function errorCategory(error, fallback = 'supervisor_operation_failed') {
  return error instanceof Error
    && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message.toLowerCase()
    : fallback;
}

function redactedCategory(value, fallback) {
  return typeof value === 'string'
    && /^[a-z][a-z0-9_]+$/u.test(value)
    ? value
    : fallback;
}

function lifecycleAbort() {
  const error = new Error('SUPERVISOR_LIFECYCLE_ABORTED');
  error.lifecycleAbort = true;
  return error;
}

function isLifecycleAbort(error) {
  return error?.lifecycleAbort === true;
}

function backupBytes(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (
    value
    && typeof value === 'object'
    && (Buffer.isBuffer(value.bytes) || value.bytes instanceof Uint8Array)
  ) {
    return Buffer.from(value.bytes);
  }
  throw new Error('BACKUP_BYTES_REQUIRED');
}

function verifiedAt(manifest) {
  const value = Date.parse(manifest?.createdAt);
  if (!Number.isFinite(value)) throw new Error('BACKUP_CREATED_AT_INVALID');
  return value;
}

function sameVerifiedBackup(loaded, bytes, committedManifest) {
  try {
    return loaded
      && Buffer.from(loaded.bytes).equals(bytes)
      && isDeepStrictEqual(loaded.manifest, committedManifest);
  } catch {
    return false;
  }
}

async function exists(fileSystem, path) {
  try {
    await fileSystem.access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function syncDirectory(fileSystem, path) {
  if (process.platform === 'win32') return;
  const directory = await fileSystem.open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function timestampName(value) {
  return new Date(value).toISOString().replaceAll(':', '-');
}

function isEqualOrNested(parent, candidate) {
  const relationship = relative(parent, candidate);
  return relationship === ''
    || (
      relationship !== '..'
      && !relationship.startsWith(`..${sep}`)
      && !isAbsolute(relationship)
    );
}

/**
 * Restore-first lifecycle and verified backup coordination for the Synology
 * merchant process.
 *
 * @param {{
 *   control: Record<string, any>,
 *   store: Record<string, any>,
 *   backupIntervalMs?: number,
 *   staleAfterMs?: number,
 *   now?: () => number,
 *   schedule?: (callback: () => void, intervalMs: number) => any,
 *   clearSchedule?: (timer: any) => void,
 *   fileSystem?: Record<string, any>,
 *   directorySync?: (path: string) => Promise<void>,
 *   walletDirectory?: string,
 *   quarantineRoot?: string,
 * }} options
 */
export function createSupervisor({
  control,
  store,
  backupIntervalMs = 60_000,
  staleAfterMs = 120_000,
  now = Date.now,
  schedule = setInterval,
  clearSchedule = clearInterval,
  fileSystem = {},
  directorySync,
  walletDirectory = control?.walletDirectory
    ?? control?.options?.walletDirectory,
  quarantineRoot = walletDirectory
    ? resolve(dirname(walletDirectory), 'quarantine')
    : undefined,
} = {}) {
  if (!control || !store) throw new TypeError('SUPERVISOR_DEPENDENCIES_REQUIRED');
  const fs = { ...nodeFileSystem, ...fileSystem };
  const sync = directorySync ?? ((path) => syncDirectory(fs, path));
  const liveWallet = walletDirectory
    ? resolve(walletDirectory)
    : undefined;
  const quarantine = quarantineRoot
    ? resolve(quarantineRoot)
    : undefined;
  let state = 'starting';
  let failureCategory;
  let lastVerifiedBackupAt;
  let timer;
  let backupInFlight;
  let backupGeneration;
  let startInFlight;
  let lifecycleGeneration = 0;

  function safeControlHealth() {
    try {
      const value = control.health();
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {
        status: 'failed',
        failureCategory: 'control_health_failed',
      };
    }
  }

  function stopControlAfterFailure() {
    try {
      control.stop();
    } catch {
      // The original operational failure remains authoritative.
    }
  }

  function clearTimer() {
    if (timer === undefined) return;
    const activeTimer = timer;
    timer = undefined;
    try {
      clearSchedule(activeTimer);
    } catch {
      // Terminal lifecycle state still prevents a late callback from backing up.
    }
  }

  function failWithCategory(category) {
    if (state === 'stopped' || state === 'failed') return;
    lifecycleGeneration += 1;
    clearTimer();
    state = 'failed';
    failureCategory = redactedCategory(
      category,
      'supervisor_operation_failed',
    );
    stopControlAfterFailure();
  }

  function fail(error, fallback) {
    failWithCategory(errorCategory(error, fallback));
  }

  function assertActive(generation) {
    if (
      generation !== lifecycleGeneration
      || state === 'stopped'
      || state === 'failed'
    ) {
      throw lifecycleAbort();
    }
  }

  function ensureTimer() {
    if (timer !== undefined) return;
    timer = schedule(() => {
      void backupNow().catch(() => undefined);
    }, backupIntervalMs);
  }

  function validateQuarantineRoot() {
    if (!liveWallet || !quarantine) return;
    if (isEqualOrNested(liveWallet, quarantine)) {
      throw new Error('QUARANTINE_ROOT_INVALID');
    }
  }

  async function quarantineLiveWallet(timestamp, generation) {
    if (!liveWallet) return undefined;
    validateQuarantineRoot();
    const liveExists = await exists(fs, liveWallet);
    assertActive(generation);
    if (!liveExists) return undefined;
    if (!quarantine) throw new Error('QUARANTINE_ROOT_REQUIRED');

    await fs.mkdir(quarantine, {
      recursive: true,
      mode: 0o700,
    });
    assertActive(generation);
    await sync(quarantine);
    assertActive(generation);
    await sync(dirname(quarantine));
    assertActive(generation);

    const prefix = `${basename(liveWallet)}-${timestampName(timestamp)}`;
    let reservation;
    for (let suffix = 0; suffix < 1_000; suffix += 1) {
      const candidate = resolve(
        quarantine,
        suffix === 0 ? prefix : `${prefix}-${suffix}`,
      );
      try {
        await fs.mkdir(candidate, { mode: 0o700 });
        assertActive(generation);
        reservation = candidate;
        break;
      } catch (error) {
        assertActive(generation);
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    if (!reservation) throw new Error('QUARANTINE_PATH_UNAVAILABLE');

    await sync(reservation);
    assertActive(generation);
    await sync(quarantine);
    assertActive(generation);
    const preservedWallet = join(reservation, basename(liveWallet));
    await fs.rename(liveWallet, preservedWallet);
    const parentSyncs = await Promise.allSettled([
      Promise.resolve().then(() => sync(reservation)),
      Promise.resolve().then(() => sync(dirname(liveWallet))),
    ]);
    const durabilityFailure = parentSyncs.find(
      ({ status }) => status === 'rejected',
    );
    if (durabilityFailure) {
      throw durabilityFailure.reason instanceof Error
        ? durabilityFailure.reason
        : new Error('QUARANTINE_DURABILITY_FAILED');
    }
    assertActive(generation);
    return preservedWallet;
  }

  async function runStart(generation) {
    let loaded;
    try {
      loaded = await store.loadLatest();
      assertActive(generation);
    } catch (error) {
      if (isLifecycleAbort(error)) throw error;
      if (error instanceof Error && error.message === 'BACKUP_REQUIRED') {
        try {
          if (liveWallet) {
            const liveExists = await exists(fs, liveWallet);
            assertActive(generation);
            if (liveExists) throw new Error('UNCOMMITTED_WALLET_PRESENT');
          }
          assertActive(generation);
          state = 'awaiting_bootstrap';
          return;
        } catch (missingBackupError) {
          if (isLifecycleAbort(missingBackupError)) {
            throw missingBackupError;
          }
          fail(missingBackupError);
          throw missingBackupError;
        }
      }
      fail(error);
      throw error;
    }

    try {
      await quarantineLiveWallet(now(), generation);
      assertActive(generation);
      await control.restore(loaded.bytes, loaded.manifest.sha256);
      assertActive(generation);
      await control.start();
      assertActive(generation);
      lastVerifiedBackupAt = verifiedAt(loaded.manifest);
      state = 'ready';
      ensureTimer();
    } catch (error) {
      if (isLifecycleAbort(error)) throw error;
      fail(error);
      throw error;
    }
  }

  function start() {
    if (startInFlight) return startInFlight;
    if (state !== 'starting') {
      return Promise.reject(new Error('SUPERVISOR_ALREADY_STARTED'));
    }
    const generation = lifecycleGeneration;
    let operation;
    operation = runStart(generation).finally(() => {
      if (startInFlight === operation) startInFlight = undefined;
    });
    startInFlight = operation;
    return operation;
  }

  async function createVerifiedBackup(generation) {
    assertActive(generation);
    const timestamp = now();
    const bytes = backupBytes(await control.backup());
    assertActive(generation);
    const controlHealth = safeControlHealth();
    if (controlHealth.status !== 'ready') {
      throw new Error('MERCHANT_NOT_READY');
    }
    const release = controlHealth.release;
    if (typeof release !== 'string' || release.trim().length === 0) {
      throw new Error('BACKUP_RELEASE_REQUIRED');
    }
    const committedManifest = await store.commit(bytes, release, timestamp);
    assertActive(generation);
    const loaded = await store.loadLatest();
    assertActive(generation);
    if (!sameVerifiedBackup(loaded, bytes, committedManifest)) {
      throw new Error('BACKUP_VERIFICATION_FAILED');
    }
    lastVerifiedBackupAt = verifiedAt(loaded.manifest);
    return { bytes, manifest: loaded.manifest };
  }

  async function runSerializedBackup(generation) {
    if (backupInFlight) {
      if (backupGeneration !== generation) throw lifecycleAbort();
      return backupInFlight;
    }
    backupGeneration = generation;
    const operation = createVerifiedBackup(generation);
    backupInFlight = operation;
    try {
      const result = await operation;
      assertActive(generation);
      return result;
    } finally {
      if (backupInFlight === operation) {
        backupInFlight = undefined;
        backupGeneration = undefined;
      }
    }
  }

  async function runBootstrap(generation) {
    let created;
    try {
      created = await control.bootstrap();
      assertActive(generation);
    } catch (error) {
      if (isLifecycleAbort(error)) throw error;
      fail(error, 'bootstrap_failed');
      throw error;
    }
    if (
      !Array.isArray(created?.mnemonic)
      || created.mnemonic.length !== 24
      || created.mnemonic.some((word) => (
        typeof word !== 'string' || word.length === 0
      ))
    ) {
      const error = new Error('INVALID_BOOTSTRAP_RESPONSE');
      fail(error);
      throw error;
    }

    try {
      await runSerializedBackup(generation);
      assertActive(generation);
    } catch (cause) {
      if (isLifecycleAbort(cause)) throw cause;
      fail(cause, 'initial_backup_failed');
      throw new Error('INITIAL_BACKUP_FAILED');
    }

    state = 'ready';
    try {
      ensureTimer();
    } catch (error) {
      fail(error, 'backup_schedule_failed');
      throw error;
    }
    return { mnemonic: [...created.mnemonic] };
  }

  function bootstrap() {
    if (state !== 'awaiting_bootstrap') {
      return Promise.reject(new Error('BOOTSTRAP_NOT_ALLOWED'));
    }
    state = 'bootstrapping';
    return runBootstrap(lifecycleGeneration);
  }

  async function backupNow() {
    if (state !== 'ready') throw new Error('MERCHANT_NOT_READY');
    const generation = lifecycleGeneration;
    const controlHealth = safeControlHealth();
    if (controlHealth.status !== 'ready') {
      failWithCategory(redactedCategory(
        controlHealth.failureCategory,
        'control_not_ready',
      ));
      throw new Error('MERCHANT_NOT_READY');
    }
    try {
      const result = await runSerializedBackup(generation);
      assertActive(generation);
      return result.manifest;
    } catch (error) {
      if (isLifecycleAbort(error)) throw error;
      fail(error, 'backup_failed');
      throw error;
    }
  }

  async function backup() {
    const generation = lifecycleGeneration;
    try {
      const manifest = await backupNow();
      assertActive(generation);
      const loaded = await store.loadLatest();
      assertActive(generation);
      if (!isDeepStrictEqual(loaded.manifest, manifest)) {
        throw new Error('BACKUP_VERIFICATION_FAILED');
      }
      return {
        bytes: Buffer.from(loaded.bytes),
        sha256: manifest.sha256,
        byteLength: manifest.byteLength,
      };
    } catch (error) {
      if (isLifecycleAbort(error)) throw error;
      fail(error);
      throw error;
    }
  }

  function health() {
    const controlHealth = safeControlHealth();
    const release = controlHealth.release;
    if (state === 'awaiting_bootstrap') {
      return { status: 'awaiting_bootstrap', release };
    }
    if (state === 'starting' || state === 'bootstrapping') {
      return { status: 'starting', release };
    }
    if (state === 'failed') {
      return {
        status: 'failed',
        failureCategory,
        release,
        backupAgeMs: lastVerifiedBackupAt === undefined
          ? undefined
          : Math.max(0, now() - lastVerifiedBackupAt),
      };
    }
    if (state === 'stopped') {
      return {
        status: 'failed',
        failureCategory: 'stopped',
        release,
      };
    }
    if (controlHealth.status !== 'ready') {
      return {
        status: 'failed',
        failureCategory: redactedCategory(
          controlHealth.failureCategory,
          'control_not_ready',
        ),
        release,
      };
    }
    const backupAgeMs = lastVerifiedBackupAt === undefined
      ? undefined
      : Math.max(0, now() - lastVerifiedBackupAt);
    if (backupAgeMs === undefined || backupAgeMs > staleAfterMs) {
      return {
        status: 'failed',
        failureCategory: 'backup_stale',
        release,
        backupAgeMs,
      };
    }
    return { status: 'ready', release, backupAgeMs };
  }

  function stop() {
    if (state === 'stopped') return;
    lifecycleGeneration += 1;
    clearTimer();
    state = 'stopped';
    control.stop();
  }

  return {
    start,
    bootstrap,
    backupNow,
    backup,
    health,
    stop,
  };
}

const LOOPBACK_HOST = '127.0.0.1';

function requiredValue(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

function controlToken(env) {
  const token = requiredValue(env, 'CONTAINER_CONTROL_TOKEN');
  if (/[\r\n]/u.test(token)) {
    throw new Error('CONTAINER_CONTROL_TOKEN_INVALID');
  }
  return token;
}

function validBackupKey(env) {
  const encoded = requiredValue(env, 'WALLET_BACKUP_KEY_BASE64');
  if (
    !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/u.test(encoded)
    || Buffer.from(encoded, 'base64').byteLength !== 32
  ) {
    throw new Error('WALLET_BACKUP_KEY_BASE64_INVALID');
  }
  return encoded;
}

function numericIdentity(env, name) {
  const raw = requiredValue(env, name);
  if (!/^[0-9]+$/u.test(raw)) throw new Error(`${name}_INVALID`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name}_INVALID`);
  if (value === 0) throw new Error(`${name}_ROOT_FORBIDDEN`);
  return value;
}

export function validateRuntimeIdentity(
  env,
  {
    getuid = process.getuid,
    getgid = process.getgid,
  } = {},
) {
  const expectedUid = numericIdentity(env, 'OPENSTAYS_UID');
  const expectedGid = numericIdentity(env, 'OPENSTAYS_GID');
  if (typeof getuid === 'function') {
    const actualUid = getuid();
    if (actualUid === 0) throw new Error('RUNTIME_ROOT_FORBIDDEN');
    if (actualUid !== expectedUid) throw new Error('OPENSTAYS_UID_MISMATCH');
  }
  if (typeof getgid === 'function') {
    const actualGid = getgid();
    if (actualGid === 0) throw new Error('RUNTIME_ROOT_FORBIDDEN');
    if (actualGid !== expectedGid) throw new Error('OPENSTAYS_GID_MISMATCH');
  }
  return { uid: expectedUid, gid: expectedGid };
}

function ensureWritableStorage(walletDirectory, quarantineRoot, backupRoot) {
  const stateRoot = dirname(walletDirectory);
  if (
    isEqualOrNested(walletDirectory, quarantineRoot)
    || isEqualOrNested(stateRoot, backupRoot)
    || isEqualOrNested(backupRoot, stateRoot)
  ) {
    throw new Error('RUNTIME_STORAGE_LAYOUT_INVALID');
  }
  for (const root of [stateRoot, quarantineRoot, backupRoot]) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    accessSync(
      root,
      fileSystemConstants.R_OK
        | fileSystemConstants.W_OK
        | fileSystemConstants.X_OK,
    );
  }
}

export function createMerchantSupervisorControl(
  merchant,
  {
    stagingRoot = '/var/lib/openstays/runtime',
    fileSystem = nodeFileSystem,
  } = {},
) {
  if (
    !merchant
    || typeof merchant.restore !== 'function'
    || typeof merchant.start !== 'function'
    || typeof merchant.bootstrap !== 'function'
    || typeof merchant.backup !== 'function'
    || typeof merchant.health !== 'function'
    || typeof merchant.stop !== 'function'
  ) {
    throw new Error('MERCHANT_CONTROL_INVALID');
  }
  const root = resolve(stagingRoot);

  return {
    walletDirectory:
      merchant.walletDirectory ?? merchant.options?.walletDirectory,
    restore: (bytes, digest) => merchant.restore(bytes, digest),
    start: () => merchant.start(),
    bootstrap: () => merchant.bootstrap(),
    async backup() {
      await fileSystem.mkdir(root, { recursive: true, mode: 0o700 });
      const requestDirectory = await fileSystem.mkdtemp(
        join(root, '.supervisor-backup-'),
      );
      await fileSystem.chmod(requestDirectory, 0o700);
      const outputPath = join(requestDirectory, 'wallet.tar.gz.enc');
      try {
        const metadata = await merchant.backup(outputPath);
        const bytes = Buffer.from(await fileSystem.readFile(outputPath));
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (
          metadata?.sha256 !== digest
          || metadata?.byteLength !== bytes.byteLength
        ) {
          throw new Error('BACKUP_RESULT_MISMATCH');
        }
        return bytes;
      } finally {
        await fileSystem.rm(requestDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
    health: () => merchant.health(),
    stop: () => merchant.stop(),
  };
}

function runtimePort(value) {
  if (value === undefined || value === '') return 8_080;
  if (!/^[0-9]+$/u.test(String(value))) {
    throw new Error('CONTROL_PORT_INVALID');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CONTROL_PORT_INVALID');
  }
  return port;
}

function defaultRuntimeSupervisor(env) {
  validateRuntimeIdentity(env);
  const walletDirectory = resolve(
    env.WAVELENGTH_WALLET_DIRECTORY
      ?? '/var/lib/openstays/wavelength',
  );
  const quarantineRoot = resolve(
    env.OPENSTAYS_QUARANTINE_ROOT
      ?? '/var/lib/openstays/quarantine',
  );
  const backupRoot = resolve(
    env.OPENSTAYS_BACKUP_ROOT
      ?? '/var/backups/openstays',
  );
  ensureWritableStorage(walletDirectory, quarantineRoot, backupRoot);
  const walletPassword = requiredValue(
    env,
    'WAVELENGTH_WALLET_PASSWORD',
  );
  if (Buffer.byteLength(walletPassword, 'utf8') < 8) {
    throw new Error('WAVELENGTH_WALLET_PASSWORD_TOO_SHORT');
  }
  const release = requiredValue(env, 'OPENSTAYS_RELEASE');
  const backupKeyBase64 = validBackupKey(env);
  const cli = '/app/cli/dist/index.js';
  const childEnv = {
    ...env,
    WAVELENGTH_DAEMON_URL: 'http://127.0.0.1:10031',
    WAVELENGTH_EXPECTED_NETWORK: 'signet',
    OTS_COMMAND: '/usr/local/bin/ots',
  };
  const merchant = new MerchantControl({
    walletDirectory,
    backupKeyBase64,
    walletPassword,
    diagnosticLifecycleErrors:
      env.OPENSTAYS_DIAGNOSTIC_LIFECYCLE_ERRORS === 'true',
    release,
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
      {
        file: process.execPath,
        args: [cli, 'wave-bridge'],
        env: childEnv,
      },
      {
        file: process.execPath,
        args: [cli, 'ots-bridge'],
        env: childEnv,
      },
      {
        file: process.execPath,
        args: [cli, 'mail-bridge'],
        env: childEnv,
      },
    ],
  });
  const stagingRoot = dirname(
    resolve(
      env.WALLET_BACKUP_OUTPUT_PATH
        ?? '/var/lib/openstays/runtime/wallet.tar.gz.enc',
    ),
  );
  const control = createMerchantSupervisorControl(merchant, {
    stagingRoot,
  });
  const store = new GenerationStore(backupRoot, { retain: 12 });
  return createSupervisor({
    control,
    store,
    walletDirectory,
    quarantineRoot,
  });
}

/**
 * Compose the executable Synology supervisor around the authenticated control
 * server. The HTTP listener is fixed to container loopback and is never
 * reachable through a published host port.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   supervisor?: Record<string, any>,
 *   port?: number,
 *   serverFactory?: typeof createControlServer,
 * }} options
 */
export function createSynologyRuntime({
  env = process.env,
  supervisor,
  port,
  serverFactory = createControlServer,
} = {}) {
  const token = controlToken(env);
  const resolvedSupervisor = supervisor ?? defaultRuntimeSupervisor(env);
  const listenPort = port ?? runtimePort(env.CONTROL_PORT);
  const server = serverFactory(resolvedSupervisor, token);
  let listening = false;
  let startInFlight;
  let stopInFlight;

  function start() {
    if (startInFlight) return startInFlight;
    startInFlight = (async () => {
      try {
        await resolvedSupervisor.start();
        await new Promise((resolveListen, rejectListen) => {
          const onError = (error) => {
            server.off('listening', onListening);
            rejectListen(error);
          };
          const onListening = () => {
            server.off('error', onError);
            listening = true;
            resolveListen();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(listenPort, LOOPBACK_HOST);
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('CONTROL_LISTENER_ADDRESS_INVALID');
        }
        return address;
      } catch (error) {
        try {
          resolvedSupervisor.stop();
        } catch {
          // Preserve the startup failure as the operator-facing cause.
        }
        throw error;
      }
    })();
    return startInFlight;
  }

  function stop() {
    if (stopInFlight) return stopInFlight;
    stopInFlight = (async () => {
      resolvedSupervisor.stop();
      if (!listening) return;
      await new Promise((resolveClose, rejectClose) =>
        server.close((error) => error
          ? rejectClose(error)
          : resolveClose()));
      listening = false;
    })();
    return stopInFlight;
  }

  return { start, stop };
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let runtime;
  try {
    runtime = createSynologyRuntime();
    await runtime.start();
    const shutdown = () => {
      void runtime.stop()
        .then(() => {
          process.exitCode = 0;
        })
        .catch(() => {
          process.exitCode = 1;
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    const category = error instanceof Error
      && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message.toLowerCase()
      : 'runtime_start_failed';
    process.stderr.write(`synology-supervisor: ${category}\n`);
    process.exitCode = 1;
  }
}
