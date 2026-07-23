export type WaveBridgeConfig = {
  openStaysUrl: string;
  bridgeToken: string;
  daemonUrl: string;
  expectedNetwork?: WavelengthNetwork;
  daemonMacaroonHex?: string;
  pollMs?: number;
  maxRewardFeeSats?: number;
};

export type WavelengthNetwork = 'signet';

const CONSENSUS_REWARD_SATS = 1_000;
const DEFAULT_REWARD_MAX_FEE_SATS = 210;

class BridgeHttpError extends Error {
  constructor(readonly status: number, url: string, detail: string) {
    super(`HTTP ${status} from ${url}: ${detail}`);
  }
}

function isRetryableRewardError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof BridgeHttpError && error.status >= 500);
}

type PendingRequest = {
  _id: string;
  bookingId?: string;
  network: WavelengthNetwork;
  status: 'requested' | 'claimed' | 'invoice_ready';
  satsAmount: number;
  expiresAt: number;
  bolt11?: string;
  bridgeActivityId?: string;
};

function daemonHeaders(config: WaveBridgeConfig): Record<string, string> {
  return config.daemonMacaroonHex ? { Macaroon: config.daemonMacaroonHex } : {};
}

async function daemonNetwork(
  fetchFn: typeof fetch,
  daemonUrl: string,
  headers: Record<string, string>,
): Promise<WavelengthNetwork> {
  const info = await jsonRequest<{ network?: string }>(
    fetchFn,
    `${daemonUrl}/v1/daemon/get-info`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (info.network !== 'signet') {
    throw new Error('INVALID_WAVELENGTH_DAEMON_NETWORK');
  }
  return info.network;
}

async function jsonRequest<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new BridgeHttpError(response.status, url, detail);
  }
  return (await response.json()) as T;
}

export async function runWaveBridgeOnce(
  config: WaveBridgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ claimed: number; invoices: number; settlements: number; rewardsPaid: number; rewardsFailed: number }> {
  const openStaysUrl = config.openStaysUrl.replace(/\/$/, '');
  const daemonUrl = config.daemonUrl.replace(/\/$/, '');
  const authHeaders = { Authorization: `Bearer ${config.bridgeToken}` };
  const localDaemonHeaders = daemonHeaders(config);
  const actualNetwork = await daemonNetwork(fetchFn, daemonUrl, localDaemonHeaders);
  if (config.expectedNetwork && actualNetwork !== config.expectedNetwork) {
    throw new Error('WAVELENGTH_DAEMON_NETWORK_MISMATCH');
  }
  const pending = await jsonRequest<{ requests: PendingRequest[] }>(
    fetchFn,
    `${openStaysUrl}/wavelength-bridge/pending`,
    { headers: authHeaders },
  );
  let invoices = 0;
  let settlements = 0;
  let rewardsPaid = 0;
  let rewardsFailed = 0;

  for (const request of pending.requests) {
    if (request.network !== actualNetwork) {
      throw new Error('WAVELENGTH_REQUEST_NETWORK_MISMATCH');
    }
    if (request.status === 'requested' || request.status === 'claimed') {
      const received = await jsonRequest<{
        invoice: string;
        entry: { id: string };
      }>(fetchFn, `${daemonUrl}/v1/wallet/recv`, {
        method: 'POST',
        headers: { ...localDaemonHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amt_sat: request.satsAmount,
          memo: `OpenStays booking ${request.bookingId ?? request._id}`,
        }),
      });
      await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/invoice`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request._id,
          network: request.network,
          bolt11: received.invoice,
          bridgeActivityId: received.entry.id,
          satsAmount: request.satsAmount,
          expiresAt: request.expiresAt,
        }),
      });
      invoices += 1;
      continue;
    }

    if (!request.bolt11 || !request.bridgeActivityId) continue;
    const inspection = await jsonRequest<{
      entry?: {
        id?: string;
        kind?: string;
        status?: string;
        amount_sat?: string | number;
        request?: { lightning_invoice?: { invoice?: string; payment_hash?: string } };
        progress?: { payment_hash?: string };
      };
    }>(fetchFn, `${daemonUrl}/v1/wallet/inspect/activity`, {
      method: 'POST',
      headers: { ...localDaemonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: request.bridgeActivityId }),
    });
    const entry = inspection.entry;
    const paymentHash = entry?.progress?.payment_hash ?? entry?.request?.lightning_invoice?.payment_hash;
    const exact =
      entry?.id === request.bridgeActivityId &&
      entry.kind === 'ENTRY_KIND_RECV' &&
      entry.status === 'ENTRY_STATUS_COMPLETE' &&
      Number(entry.amount_sat) === request.satsAmount &&
      entry.request?.lightning_invoice?.invoice === request.bolt11 &&
      Boolean(paymentHash);
    if (!exact) continue;
    await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/settled`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: request._id,
        network: request.network,
        bolt11: request.bolt11,
        bridgeActivityId: request.bridgeActivityId,
        paymentHash,
        satsAmount: request.satsAmount,
      }),
    });
    settlements += 1;
  }
  const rewards = await jsonRequest<{ rewards: Array<{
    _id: string; status: 'paying'; network: 'signet'; satsAmount: number; bolt11: string;
    invoiceExpiresAt: number; leaseToken: string; merchantActivityId?: string; paymentHash?: string;
  }> }>(fetchFn, `${openStaysUrl}/wavelength-bridge/rewards/pending`, { headers: authHeaders });
  const maxFee = config.maxRewardFeeSats ?? DEFAULT_REWARD_MAX_FEE_SATS;
  for (const reward of rewards.rewards) {
    try {
      if (reward.network !== 'signet' || reward.satsAmount !== CONSENSUS_REWARD_SATS || reward.invoiceExpiresAt <= Date.now() + 30_000) {
        throw new Error('INVALID_SIGNET_REWARD');
      }
      let activityId = reward.merchantActivityId;
      let paymentHash = reward.paymentHash;
      if (!activityId) {
        const prepared = await jsonRequest<{
          send_intent_id: string; amount_sat: string | number; expected_total_outflow_sat: string | number;
          total_outflow_known: boolean; rail: string; payment_hash: string; expires_at_unix: number;
        }>(fetchFn, `${daemonUrl}/v1/wallet/prepare-send`, { method: 'POST',
          headers: { ...localDaemonHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoice: reward.bolt11, max_fee_sat: maxFee, note: 'OpenStays consensus reward' }) });
        if (Number(prepared.amount_sat) !== CONSENSUS_REWARD_SATS || !prepared.total_outflow_known ||
          Number(prepared.expected_total_outflow_sat) > CONSENSUS_REWARD_SATS + maxFee || prepared.rail.toUpperCase().includes('ONCHAIN') ||
          !prepared.payment_hash || prepared.expires_at_unix * 1000 <= Date.now() + 30_000) throw new Error('WAVELENGTH_REWARD_QUOTE_MISMATCH');
        const sent = await jsonRequest<{ entry: { id: string }; actual_amount_sat: string | number }>(
          fetchFn, `${daemonUrl}/v1/wallet/send`, { method: 'POST',
            headers: { ...localDaemonHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ send_intent_id: prepared.send_intent_id }) });
        if (!sent.entry?.id || Number(sent.actual_amount_sat) !== CONSENSUS_REWARD_SATS) throw new Error('WAVELENGTH_REWARD_SEND_MISMATCH');
        activityId = sent.entry.id;
        paymentHash = prepared.payment_hash;
        await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/rewards/dispatched`, { method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rewardId: reward._id,
            leaseToken: reward.leaseToken, merchantActivityId: activityId, paymentHash }) });
      }
      const inspection = await jsonRequest<{ entry?: { id?: string; kind?: string; status?: string; amount_sat?: string | number;
        request?: { lightning_invoice?: { invoice?: string; payment_hash?: string } }; progress?: { payment_hash?: string } } }>(
        fetchFn, `${daemonUrl}/v1/wallet/inspect/activity`, { method: 'POST',
          headers: { ...localDaemonHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: activityId }) });
      const entry = inspection.entry;
      const observedHash = entry?.progress?.payment_hash ?? entry?.request?.lightning_invoice?.payment_hash;
      if (entry?.id !== activityId || entry.kind !== 'ENTRY_KIND_SEND' || entry.status !== 'ENTRY_STATUS_COMPLETE' ||
        Number(entry.amount_sat) !== -CONSENSUS_REWARD_SATS || entry.request?.lightning_invoice?.invoice !== reward.bolt11 || observedHash !== paymentHash) continue;
      await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/rewards/paid`, { method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rewardId: reward._id,
          leaseToken: reward.leaseToken, network: 'signet', satsAmount: CONSENSUS_REWARD_SATS, bolt11: reward.bolt11,
          merchantActivityId: activityId, paymentHash }) });
      rewardsPaid += 1;
    } catch (error) {
      await jsonRequest(fetchFn, `${openStaysUrl}/wavelength-bridge/rewards/failed`, { method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rewardId: reward._id,
          leaseToken: reward.leaseToken, reason: error instanceof Error ? error.message : String(error),
          retryable: isRetryableRewardError(error) }) });
      rewardsFailed += 1;
    }
  }
  return { claimed: pending.requests.length, invoices, settlements, rewardsPaid, rewardsFailed };
}

export async function runWaveBridge(config: WaveBridgeConfig): Promise<void> {
  const pollMs = config.pollMs ?? 2_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 250) throw new Error('WAVELENGTH_BRIDGE_POLL_MS must be at least 250');
  process.stdout.write(
    `OpenStays Wavelength bridge: ${config.daemonUrl} -> ${config.openStaysUrl}` +
    ` (${config.expectedNetwork ?? 'daemon-verified'})\n`,
  );
  for (;;) {
    try {
      const result = await runWaveBridgeOnce(config);
      if (result.invoices > 0 || result.settlements > 0 || result.rewardsPaid > 0 || result.rewardsFailed > 0) {
        process.stdout.write(`${new Date().toISOString()} invoices=${result.invoices} settlements=${result.settlements} rewards_paid=${result.rewardsPaid} rewards_failed=${result.rewardsFailed}\n`);
      }
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} wave-bridge: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
