import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type OtsEnvironment = {
  OTS_COMMAND?: string;
  OTS_WSL?: string;
  OTS_WSL_PYTHONPATH?: string;
};

function windowsPathToWsl(value: string): string {
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return value;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

export function resolveOtsInvocation(args: string[], env: OtsEnvironment = process.env,
  platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (env.OTS_WSL !== 'true') return { command: env.OTS_COMMAND ?? 'ots', args };
  if (platform !== 'win32') throw new Error('OTS_WSL is supported only on Windows.');
  const pythonPath = env.OTS_WSL_PYTHONPATH?.trim() || '/root/.local/share/openstays/ots-bridge-python';
  return {
    command: 'wsl.exe',
    args: [
      '--exec', 'env', `PYTHONPATH=${pythonPath}`,
      'python3', `${pythonPath}/bin/ots`,
      ...args.map(windowsPathToWsl),
    ],
  };
}

export type OtsBridgeConfig = { openStaysUrl: string; bridgeToken: string; pollMs?: number };
type Work = { _id: string; work?: 'stamp' | 'upgrade'; leaseToken?: string; canonicalJson: string; sha256: string;
  proofBase64?: string };

export type OtsRunner = {
  stamp(canonicalJson: string, sha256: string): Promise<{ proofBase64: string; calendarCount: number }>;
  upgrade(canonicalJson: string, sha256: string, proofBase64: string): Promise<null | {
    proofBase64: string; bitcoinBlockHeight: number; bitcoinBlockTime?: number;
  }>;
};

async function command(otsCommand: string, args: string[]) {
  const invocation = resolveOtsInvocation(args, { ...process.env, OTS_COMMAND: otsCommand });
  return execFileAsync(invocation.command, invocation.args,
    { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
}

export function officialOtsRunner(otsCommand = process.env.OTS_COMMAND ?? 'ots'): OtsRunner {
  return {
    async stamp(canonicalJson, sha256) {
      const dir = await mkdtemp(join(tmpdir(), 'openstays-ots-'));
      try {
        const source = join(dir, 'receipt.json');
        await writeFile(source, canonicalJson, 'utf8');
        await command(otsCommand, ['stamp', source]);
        const proof = await readFile(`${source}.ots`);
        const { stdout } = await command(otsCommand, ['info', `${source}.ots`]);
        if (!stdout.toLowerCase().includes(sha256.toLowerCase())) throw new Error('OTS_PROOF_HASH_MISMATCH');
        const calendarCount = (stdout.match(/PendingAttestation/g) ?? []).length;
        if (calendarCount < 1) throw new Error('OTS_NO_CALENDAR_ATTESTATION');
        return { proofBase64: proof.toString('base64'), calendarCount };
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
    async upgrade(canonicalJson, sha256, proofBase64) {
      const dir = await mkdtemp(join(tmpdir(), 'openstays-ots-'));
      try {
        const source = join(dir, 'receipt.json');
        const proofPath = `${source}.ots`;
        await writeFile(source, canonicalJson, 'utf8');
        await writeFile(proofPath, Buffer.from(proofBase64, 'base64'));
        try { await command(otsCommand, ['upgrade', proofPath]); } catch { return null; }
        const { stdout } = await command(otsCommand, ['info', proofPath]);
        if (!stdout.toLowerCase().includes(sha256.toLowerCase())) throw new Error('OTS_PROOF_HASH_MISMATCH');
        const height = stdout.match(/BitcoinBlockHeaderAttestation\((\d+)\)/)?.[1];
        if (!height) return null;
        return { proofBase64: (await readFile(proofPath)).toString('base64'), bitcoinBlockHeight: Number(height) };
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}

async function jsonRequest<T>(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetchFn(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${await response.text()}`);
  return await response.json() as T;
}

export async function runOtsBridgeOnce(config: OtsBridgeConfig, runner: OtsRunner = officialOtsRunner(),
  fetchFn: typeof fetch = fetch): Promise<{ stamped: number; anchored: number; failed: number }> {
  const base = config.openStaysUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${config.bridgeToken}`, 'Content-Type': 'application/json' };
  const { receipts } = await jsonRequest<{ receipts: Work[] }>(fetchFn, `${base}/ots-bridge/pending`, { headers });
  let stamped = 0; let anchored = 0; let failed = 0;
  for (const receipt of receipts) {
    const actual = createHash('sha256').update(receipt.canonicalJson, 'utf8').digest('hex');
    if (actual !== receipt.sha256) {
      if (receipt.leaseToken) await jsonRequest(fetchFn, `${base}/ots-bridge/failed`, { method: 'POST', headers,
        body: JSON.stringify({ receiptId: receipt._id, leaseToken: receipt.leaseToken, reason: 'canonical hash mismatch', retryable: false }) });
      failed += 1; continue;
    }
    if ((receipt.work ?? 'stamp') === 'upgrade' && receipt.proofBase64) {
      const result = await runner.upgrade(receipt.canonicalJson, receipt.sha256, receipt.proofBase64);
      if (!result) continue;
      await jsonRequest(fetchFn, `${base}/ots-bridge/anchored`, { method: 'POST', headers, body: JSON.stringify({
        receiptId: receipt._id, sha256: receipt.sha256, ...result,
      }) });
      anchored += 1; continue;
    }
    try {
      const result = await runner.stamp(receipt.canonicalJson, receipt.sha256);
      await jsonRequest(fetchFn, `${base}/ots-bridge/proof`, { method: 'POST', headers, body: JSON.stringify({
        receiptId: receipt._id, leaseToken: receipt.leaseToken, sha256: receipt.sha256, ...result,
      }) });
      stamped += 1;
    } catch (error) {
      await jsonRequest(fetchFn, `${base}/ots-bridge/failed`, { method: 'POST', headers, body: JSON.stringify({
        receiptId: receipt._id, leaseToken: receipt.leaseToken,
        reason: error instanceof Error ? error.message : String(error), retryable: true,
      }) });
      failed += 1;
    }
  }
  return { stamped, anchored, failed };
}

export async function runOtsBridge(config: OtsBridgeConfig): Promise<void> {
  const pollMs = config.pollMs ?? 15_000;
  for (;;) {
    try {
      const result = await runOtsBridgeOnce(config);
      if (result.stamped || result.anchored || result.failed) process.stdout.write(`${new Date().toISOString()} ots ${JSON.stringify(result)}\n`);
    } catch (error) { process.stderr.write(`${new Date().toISOString()} ots-bridge: ${error instanceof Error ? error.message : String(error)}\n`); }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
