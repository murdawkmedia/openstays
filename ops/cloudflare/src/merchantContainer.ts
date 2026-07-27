import { Container } from '@cloudflare/containers';

import {
  commitVerifiedBackup,
  loadVerifiedBackup,
  sha256Hex,
  type BackupBucket,
  type BackupManifest,
  type ManifestStorage,
} from './backupManifest';

const BACKUP_STALE_MS = 2 * 60_000;
const BACKUP_INTERVAL_MS = 60_000;

type VerifiedBackup = {
  manifest: BackupManifest;
  ciphertext: Uint8Array;
};

type Dependencies = {
  loadBackup(): Promise<VerifiedBackup | null>;
  restore(backup: VerifiedBackup): Promise<void>;
  start(): Promise<void>;
  bootstrap?(): Promise<{ mnemonic: string[] }>;
  createBackup(): Promise<Uint8Array>;
  commitBackup(input: {
    ciphertext: Uint8Array;
    sha256: string;
    now: number;
  }): Promise<BackupManifest>;
};

export function backupHealth(
  lastVerifiedBackupAt: number | undefined,
  now: number,
): 'ready' | 'failed' {
  return (
    typeof lastVerifiedBackupAt === 'number'
    && lastVerifiedBackupAt >= now - BACKUP_STALE_MS
  ) ? 'ready' : 'failed';
}

export class MerchantOperationsCoordinator {
  private dirtyVersion = 0;
  private backedUpVersion = 0;
  private started = false;
  private backupInFlight: Promise<BackupManifest | null> | null = null;
  private lastVerifiedBackupAt?: number;

  constructor(private readonly dependencies: Dependencies) {}

  async restoreAndStart(): Promise<void> {
    if (this.started) throw new Error('MERCHANT_ALREADY_STARTED');
    const backup = await this.dependencies.loadBackup();
    if (!backup) throw new Error('BACKUP_REQUIRED');
    if (
      backup.ciphertext.byteLength !== backup.manifest.byteLength
      || await sha256Hex(backup.ciphertext) !== backup.manifest.sha256
    ) {
      throw new Error('BACKUP_DIGEST_MISMATCH');
    }
    await this.dependencies.restore(backup);
    await this.dependencies.start();
    this.started = true;
    this.lastVerifiedBackupAt = Date.parse(backup.manifest.createdAt);
  }

  async bootstrapFresh(): Promise<{ mnemonic: string[] }> {
    if (this.started) throw new Error('MERCHANT_ALREADY_STARTED');
    if (await this.dependencies.loadBackup()) {
      throw new Error('BACKUP_ALREADY_EXISTS');
    }
    if (!this.dependencies.bootstrap) {
      throw new Error('BOOTSTRAP_UNAVAILABLE');
    }
    const created = await this.dependencies.bootstrap();
    if (
      created.mnemonic.length !== 24
      || created.mnemonic.some((word) => !/^[a-z]+$/u.test(word))
    ) {
      throw new Error('INVALID_BOOTSTRAP_RESPONSE');
    }
    this.started = true;
    this.dirtyVersion += 1;
    await this.backupIfDue(Date.now());
    return created;
  }

  isStarted(): boolean {
    return this.started;
  }

  resetForRestart(): void {
    this.started = false;
    this.backupInFlight = null;
  }

  markDirty(): void {
    if (!this.started) throw new Error('MERCHANT_NOT_READY');
    this.dirtyVersion += 1;
  }

  async backupIfDue(now: number): Promise<BackupManifest | null> {
    if (!this.started) throw new Error('MERCHANT_NOT_READY');
    if (
      this.dirtyVersion === this.backedUpVersion
      && this.lastVerifiedBackupAt !== undefined
      && now - this.lastVerifiedBackupAt < BACKUP_INTERVAL_MS
    ) {
      return null;
    }
    if (this.backupInFlight) return this.backupInFlight;
    const targetVersion = this.dirtyVersion;
    this.backupInFlight = this.createAndCommitBackup(now, targetVersion);
    try {
      return await this.backupInFlight;
    } finally {
      this.backupInFlight = null;
    }
  }

  health(now: number): {
    status: 'ready' | 'failed';
    backupAgeMs?: number;
  } {
    const status = backupHealth(this.lastVerifiedBackupAt, now);
    return {
      status,
      backupAgeMs: this.lastVerifiedBackupAt === undefined
        ? undefined
        : Math.max(0, now - this.lastVerifiedBackupAt),
    };
  }

  private async createAndCommitBackup(
    now: number,
    targetVersion: number,
  ): Promise<BackupManifest> {
    const ciphertext = await this.dependencies.createBackup();
    const manifest = await this.dependencies.commitBackup({
      ciphertext,
      sha256: await sha256Hex(ciphertext),
      now,
    });
    this.lastVerifiedBackupAt = Date.parse(manifest.createdAt);
    this.backedUpVersion = Math.max(this.backedUpVersion, targetVersion);
    return manifest;
  }
}

export interface MerchantOperationsEnv {
  WALLET_BACKUPS: R2Bucket;
  CONTAINER_CONTROL_TOKEN: string;
  WALLET_BACKUP_KEY_BASE64: string;
  RELEASE: string;
  OPENSTAYS_URL: string;
  WAVELENGTH_BRIDGE_TOKEN: string;
  WAVELENGTH_HEARTBEAT_TOKEN: string;
  WAVELENGTH_WALLET_PASSWORD: string;
  OTS_BRIDGE_TOKEN: string;
  OTS_HEARTBEAT_TOKEN: string;
  MAIL_BRIDGE_TOKEN: string;
  MAIL_HEARTBEAT_TOKEN: string;
  BACKUP_HEARTBEAT_TOKEN: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export class MerchantOperations extends Container<MerchantOperationsEnv> {
  defaultPort = 8_080;
  requiredPorts = [8_080];
  sleepAfter = '10m';
  private readonly coordinator: MerchantOperationsCoordinator;

  constructor(
    context: DurableObjectState<{}>,
    env: MerchantOperationsEnv,
  ) {
    super(context, env);
    const storage = context.storage as unknown as ManifestStorage;
    const bucket = env.WALLET_BACKUPS as unknown as BackupBucket;
    const startContainer = () => this.startAndWaitForPorts(
      [this.defaultPort],
      { portReadyTimeoutMS: 30_000 },
      {
        enableInternet: true,
        envVars: {
          CONTAINER_CONTROL_TOKEN: env.CONTAINER_CONTROL_TOKEN,
          WALLET_BACKUP_KEY_BASE64: env.WALLET_BACKUP_KEY_BASE64,
          OPENSTAYS_RELEASE: env.RELEASE,
          OPENSTAYS_URL: env.OPENSTAYS_URL,
          WAVELENGTH_BRIDGE_TOKEN: env.WAVELENGTH_BRIDGE_TOKEN,
          WAVELENGTH_HEARTBEAT_TOKEN: env.WAVELENGTH_HEARTBEAT_TOKEN,
          WAVELENGTH_WALLET_PASSWORD: env.WAVELENGTH_WALLET_PASSWORD,
          OTS_BRIDGE_TOKEN: env.OTS_BRIDGE_TOKEN,
          OTS_HEARTBEAT_TOKEN: env.OTS_HEARTBEAT_TOKEN,
          MAIL_BRIDGE_TOKEN: env.MAIL_BRIDGE_TOKEN,
          MAIL_HEARTBEAT_TOKEN: env.MAIL_HEARTBEAT_TOKEN,
          BACKUP_HEARTBEAT_TOKEN: env.BACKUP_HEARTBEAT_TOKEN,
          ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
          ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
          ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
          ...(env.SMTP_USERNAME ? { SMTP_USERNAME: env.SMTP_USERNAME } : {}),
          ...(env.SMTP_PASSWORD ? { SMTP_PASSWORD: env.SMTP_PASSWORD } : {}),
        },
      },
    );
    this.coordinator = new MerchantOperationsCoordinator({
      loadBackup: () => loadVerifiedBackup({ bucket, storage }),
      restore: async ({ manifest, ciphertext }) => {
        await startContainer();
        const response = await this.containerFetch(
          'http://container/restore',
          {
            method: 'POST',
            headers: {
              ...bearer(env.CONTAINER_CONTROL_TOKEN),
              'Content-Type': 'application/octet-stream',
              'X-Backup-Sha256': manifest.sha256,
            },
            body: new Uint8Array(ciphertext).buffer as ArrayBuffer,
          },
          this.defaultPort,
        );
        if (!response.ok) throw new Error('CONTAINER_RESTORE_FAILED');
      },
      bootstrap: async () => {
        await startContainer();
        const response = await this.containerFetch(
          'http://container/bootstrap',
          {
            method: 'POST',
            headers: bearer(env.CONTAINER_CONTROL_TOKEN),
          },
          this.defaultPort,
        );
        if (!response.ok) throw new Error('CONTAINER_BOOTSTRAP_FAILED');
        const body = await response.json() as { mnemonic?: unknown };
        if (
          !Array.isArray(body.mnemonic)
          || body.mnemonic.length !== 24
          || body.mnemonic.some((word) => typeof word !== 'string')
        ) {
          throw new Error('CONTAINER_BOOTSTRAP_INVALID');
        }
        return { mnemonic: body.mnemonic as string[] };
      },
      start: async () => {
        const response = await this.containerFetch(
          'http://container/health',
          { headers: bearer(env.CONTAINER_CONTROL_TOKEN) },
          this.defaultPort,
        );
        const health = await response.json() as { status?: unknown };
        if (!response.ok || health.status !== 'ready') {
          throw new Error('CONTAINER_NOT_READY');
        }
      },
      createBackup: async () => {
        const response = await this.containerFetch(
          'http://container/backup',
          {
            method: 'POST',
            headers: bearer(env.CONTAINER_CONTROL_TOKEN),
          },
          this.defaultPort,
        );
        if (!response.ok) throw new Error('CONTAINER_BACKUP_FAILED');
        const ciphertext = new Uint8Array(await response.arrayBuffer());
        const expected = response.headers.get('X-Backup-Sha256');
        if (
          !expected
          || ciphertext.byteLength === 0
          || await sha256Hex(ciphertext) !== expected
        ) {
          throw new Error('CONTAINER_BACKUP_DIGEST_MISMATCH');
        }
        return ciphertext;
      },
      commitBackup: ({ ciphertext, sha256, now }) =>
        commitVerifiedBackup({
          bucket,
          storage,
          ciphertext,
          expectedSha256: sha256,
          release: env.RELEASE,
          now: new Date(now),
        }),
    });
  }

  async ensureReady(): Promise<{ status: 'ready' | 'failed' }> {
    try {
      if (!this.coordinator.isStarted()) {
        await this.coordinator.restoreAndStart();
      }
      await this.coordinator.backupIfDue(Date.now());
      if (this.coordinator.health(Date.now()).status !== 'ready') {
        throw new Error('VERIFIED_BACKUP_STALE');
      }
      return { status: 'ready' };
    } catch {
      await this.stop().catch(() => undefined);
      return { status: 'failed' };
    }
  }

  async bootstrapWallet(): Promise<{ mnemonic: string[] }> {
    return await this.coordinator.bootstrapFresh();
  }

  async restartFromBackup(): Promise<{ status: 'ready' | 'failed' }> {
    await this.stop();
    this.coordinator.resetForRestart();
    return await this.ensureReady();
  }

  async markWalletDirty(): Promise<void> {
    this.coordinator.markDirty();
    this.renewActivityTimeout();
    await this.schedule(1, 'scheduledBackup');
  }

  async backupNow(now = Date.now()): Promise<BackupManifest | null> {
    const manifest = await this.coordinator.backupIfDue(now);
    this.renewActivityTimeout();
    return manifest;
  }

  redactedHealth(now = Date.now()): {
    status: 'ready' | 'failed';
    backupAgeMs?: number;
  } {
    return this.coordinator.health(now);
  }

  async scheduledBackup(): Promise<void> {
    try {
      await this.backupNow(Date.now());
    } catch {
      await this.schedule(60, 'scheduledBackup');
    }
  }
}
