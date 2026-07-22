export type WaveBridgeConfig = {
  openStaysUrl: string;
  bridgeToken: string;
  daemonUrl: string;
  expectedNetwork?: WavelengthNetwork;
  daemonMacaroonHex?: string;
  pollMs?: number;
};

export type WavelengthNetwork = 'signet' | 'mainnet';

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
  if (info.network !== 'signet' && info.network !== 'mainnet') {
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
    throw new Error(`HTTP ${response.status} from ${url}: ${detail}`);
  }
  return (await response.json()) as T;
}

export async function runWaveBridgeOnce(
  config: WaveBridgeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ claimed: number; invoices: number; settlements: number }> {
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

  for (const request of pending.requests) {
    if (request.network !== actualNetwork) {
      throw new Error('WAVELENGTH_REQUEST_NETWORK_MISMATCH');
    }
    if (request.network === 'mainnet' && request.satsAmount !== 210) {
      throw new Error('WAVELENGTH_MAINNET_AMOUNT_NOT_210');
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
  return { claimed: pending.requests.length, invoices, settlements };
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
      if (result.invoices > 0 || result.settlements > 0) {
        process.stdout.write(`${new Date().toISOString()} invoices=${result.invoices} settlements=${result.settlements}\n`);
      }
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} wave-bridge: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
