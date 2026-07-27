export type OperationsService = 'wavelength' | 'ots' | 'mail' | 'backup';
export type OperationsStatus = 'starting' | 'ready' | 'degraded' | 'failed';
export type OperationsFailureCategory =
  | 'configuration'
  | 'dependency_unavailable'
  | 'network'
  | 'authentication'
  | 'processing'
  | 'backup_stale'
  | 'unknown';

export type OperationsHeartbeat = {
  service: OperationsService;
  status: OperationsStatus;
  release: string;
  observedAt: number;
  spendableSats?: number;
  failureCategory?: OperationsFailureCategory;
};

export type OperationsHeartbeatSnapshot = Pick<OperationsHeartbeat, 'status'> & {
  spendableSats?: number;
  failureCategory?: OperationsFailureCategory;
};

export const OPERATIONS_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_RETRY_DELAY_MS = 30_000;

type HeartbeatBuilderInput = {
  service: OperationsService;
  release: string;
  observedAt: number;
  snapshot: OperationsHeartbeatSnapshot;
};

export type HeartbeatPublishConfig = {
  openStaysUrl: string;
  heartbeatToken: string;
  fetchFn?: typeof fetch;
};

export type HeartbeatLoopConfig = HeartbeatPublishConfig & {
  service: OperationsService;
  release: string;
  signal: AbortSignal;
  snapshot: () => Promise<OperationsHeartbeatSnapshot>;
  intervalMs?: number;
  now?: () => number;
  random?: () => number;
};

function cleanRelease(release: string): string {
  const cleaned = release.trim();
  if (!cleaned || cleaned.length > 80 || !/^[A-Za-z0-9._:@/+ -]+$/.test(cleaned)) {
    throw new Error('INVALID_HEARTBEAT_RELEASE');
  }
  return cleaned;
}

export function buildOperationsHeartbeat(input: HeartbeatBuilderInput): OperationsHeartbeat {
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt <= 0) {
    throw new Error('INVALID_HEARTBEAT_TIMESTAMP');
  }
  const heartbeat: OperationsHeartbeat = {
    service: input.service,
    status: input.snapshot.status,
    release: cleanRelease(input.release),
    observedAt: input.observedAt,
  };
  if (input.snapshot.spendableSats !== undefined) {
    if (input.service !== 'wavelength') throw new Error('HEARTBEAT_BALANCE_SERVICE_MISMATCH');
    if (!Number.isSafeInteger(input.snapshot.spendableSats) || input.snapshot.spendableSats < 0) {
      throw new Error('INVALID_HEARTBEAT_BALANCE');
    }
    heartbeat.spendableSats = input.snapshot.spendableSats;
  }
  if (input.snapshot.failureCategory !== undefined) {
    heartbeat.failureCategory = input.snapshot.failureCategory;
  }
  return heartbeat;
}

export async function publishOperationsHeartbeat(
  config: HeartbeatPublishConfig,
  heartbeat: OperationsHeartbeat,
): Promise<void> {
  const fetchFn = config.fetchFn ?? fetch;
  const response = await fetchFn(
    `${config.openStaysUrl.replace(/\/$/, '')}/operations-bridge/heartbeat`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.heartbeatToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(heartbeat),
    },
  );
  if (!response.ok) {
    // Deliberately omit the URL, bearer token, body, and response body.
    throw new Error(`HEARTBEAT_HTTP_${response.status}`);
  }
}

export function waitForAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runOperationsHeartbeat(config: HeartbeatLoopConfig): Promise<void> {
  const intervalMs = config.intervalMs ?? OPERATIONS_HEARTBEAT_INTERVAL_MS;
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  let failures = 0;
  while (!config.signal.aborted) {
    try {
      const snapshot = await config.snapshot();
      await publishOperationsHeartbeat(config, buildOperationsHeartbeat({
        service: config.service,
        release: config.release,
        observedAt: now(),
        snapshot,
      }));
      failures = 0;
      await waitForAbortableDelay(intervalMs, config.signal);
    } catch {
      failures += 1;
      const exponential = Math.min(MAX_RETRY_DELAY_MS, 1_000 * (2 ** Math.min(failures - 1, 5)));
      const jittered = Math.max(250, Math.floor(exponential * (0.75 + random() * 0.5)));
      await waitForAbortableDelay(jittered, config.signal);
    }
  }
}
