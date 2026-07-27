# Guarded Wavelength Mainnet Implementation Plan (superseded)

> Historical pre-kickoff plan only. The active hackathon implementation is
> signet-only; mainnet launch scripts and UI paths have been retired.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, exact-210-sat Wavelength mainnet merchant flow while preserving the existing signet demo as an isolated fallback.

**Architecture:** Convex snapshots both network and sats amount on every request, then accepts invoices and settlements only when the authenticated local bridge reports exact matches. Mainnet uses a separate loopback-only daemon, wallet, recovery directory, token, and guarded startup script; the guest pays its BOLT11 invoice from an external wallet.

**Tech Stack:** TypeScript, Convex, React/Vite, Vitest, Node CLI, PowerShell, Wavelength v0.1.0 REST/gRPC.

---

## File map

- Modify `shared/wavelength.ts`: network and fixed-mainnet quote validation.
- Modify `shared/wavelength.test.ts`: 209/210/211 and network tests.
- Modify `convex/schema.ts`: snapshot request network.
- Modify `convex/wavelength.ts`: select the configured network and enforce 210 sats.
- Modify `convex/seed.ts`: price the one-night hackathon fixture at CAD 0.21 total.
- Modify `convex/wavelengthBridge.test.ts`: authorization/network safety tests.
- Modify `convex/http.ts`: carry network through bridge endpoints.
- Modify `cli/src/waveBridge.ts`: demand daemon/request network agreement.
- Modify `cli/src/waveBridge.test.ts`: replay, amount, and network mismatch tests.
- Modify `src/pages/CheckoutPage.tsx`: honest mainnet payment copy.
- Modify `src/pages/WavelengthWalletPage.tsx`: external-wallet mainnet invoice presentation while retaining the signet SDK flow.
- Create `scripts/start-wavelength-mainnet.ps1`: guarded, separate mainnet daemon startup.
- Create `scripts/start-mainnet-bridge.ps1`: guarded bridge startup with a distinct token.
- Modify `docs/hackathon-mvp.md`, `CLAUDE.md`, and `STATUS.md`: binding decisions and runbook.

### Task 1: Define the network and amount invariants

**Files:**
- Modify: `shared/wavelength.ts`
- Modify: `shared/wavelength.test.ts`

- [ ] **Step 1: Write failing invariant tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAINNET_HACKATHON_SATS,
  assertWavelengthAmount,
  parseWavelengthNetwork,
} from './wavelength';

describe('guarded Wavelength mainnet', () => {
  it('accepts exactly 210 sats', () => {
    expect(assertWavelengthAmount('mainnet', 210)).toBe(210);
  });

  it.each([209, 211, 21_000])('rejects %i sats', (amount) => {
    expect(() => assertWavelengthAmount('mainnet', amount)).toThrow('WAVELENGTH_MAINNET_AMOUNT_NOT_210');
  });

  it('parses only supported networks', () => {
    expect(parseWavelengthNetwork('signet')).toBe('signet');
    expect(parseWavelengthNetwork('mainnet')).toBe('mainnet');
    expect(() => parseWavelengthNetwork('testnet')).toThrow('INVALID_WAVELENGTH_NETWORK');
    expect(MAINNET_HACKATHON_SATS).toBe(210);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- shared/wavelength.test.ts`

Expected: FAIL because the three exported invariant helpers do not exist.

- [ ] **Step 3: Add the minimal shared implementation**

```ts
export type WavelengthNetwork = 'signet' | 'mainnet';
export const MAINNET_HACKATHON_SATS = 210;

export function parseWavelengthNetwork(value: string | undefined): WavelengthNetwork {
  const network = value ?? 'signet';
  if (network !== 'signet' && network !== 'mainnet') throw new Error('INVALID_WAVELENGTH_NETWORK');
  return network;
}

export function assertWavelengthAmount(network: WavelengthNetwork, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_WAVELENGTH_AMOUNT');
  if (network === 'mainnet' && amount !== MAINNET_HACKATHON_SATS) {
    throw new Error('WAVELENGTH_MAINNET_AMOUNT_NOT_210');
  }
  return amount;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- shared/wavelength.test.ts`

Expected: all shared Wavelength tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- shared/wavelength.ts shared/wavelength.test.ts
git commit -m "Enforce Wavelength network and 210-sat invariants"
```

### Task 2: Snapshot and enforce network in Convex

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/wavelength.ts`
- Modify: `convex/seed.ts`
- Modify: `convex/wavelengthBridge.test.ts`
- Test: `convex/wavelengthMainnet.test.ts`

- [ ] **Step 1: Add failing request tests**

Create `convex/wavelengthMainnet.test.ts` using the existing `convexTest` fixture style and assert:

```ts
vi.stubEnv('WAVELENGTH_NETWORK', 'mainnet');
vi.stubEnv('WAVELENGTH_MAINNET_ACK', 'I_UNDERSTAND_REAL_SATS');
vi.stubEnv('WAVELENGTH_BRIDGE_TOKEN', 'bridge-token');
const request = await t.mutation(api.wavelength.createRequest, credentials);
expect(request).toMatchObject({ network: 'mainnet', satsAmount: 210, quotedAmountCents: 21 });
```

Add cases that omit `WAVELENGTH_MAINNET_ACK`, use a non-21-cent Consensus Commons hold, publish a signet invoice for a mainnet request, and settle with 209 or 211 sats. Expected errors are `WAVELENGTH_MAINNET_NOT_ACKNOWLEDGED`, `WAVELENGTH_MAINNET_DEMO_PRICE_REQUIRED`, `WAVELENGTH_NETWORK_MISMATCH`, and `WAVELENGTH_AMOUNT_MISMATCH`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- convex/wavelengthMainnet.test.ts`

Expected: FAIL because `network` is absent and mainnet configuration is unsupported.

- [ ] **Step 3: Extend the schema**

Add this required field to `wavelengthRequests` in `convex/schema.ts`:

```ts
network: v.union(v.literal('signet'), v.literal('mainnet')),
```

The branch has only disposable hackathon dev data; after the schema push, reseed rather than attempting a production migration.

- [ ] **Step 4: Implement configuration and request snapshotting**

In `convex/wavelength.ts`, derive configuration once per operation:

```ts
function configuredNetwork(): WavelengthNetwork {
  const network = parseWavelengthNetwork(process.env.WAVELENGTH_NETWORK);
  if (network === 'mainnet' && process.env.WAVELENGTH_MAINNET_ACK !== 'I_UNDERSTAND_REAL_SATS') {
    throw new ConvexError('WAVELENGTH_MAINNET_NOT_ACKNOWLEDGED');
  }
  return network;
}

function quoteSats(network: WavelengthNetwork, amountCents: number): number {
  if (network === 'mainnet') {
    if (amountCents !== 21) throw new ConvexError('WAVELENGTH_MAINNET_DEMO_PRICE_REQUIRED');
    return MAINNET_HACKATHON_SATS;
  }
  return quoteSignetSats(amountCents, configuredRate());
}
```

Persist `network` beside `satsAmount`. Return the configured network from `available`. Add `network` to `publishInvoice` and `prepareSettlement` arguments and reject any mismatch before patching a request or payment.

Select the bearer token by configured profile: signet uses
`WAVELENGTH_BRIDGE_TOKEN`; mainnet uses `WAVELENGTH_MAINNET_BRIDGE_TOKEN`.
Refuse mainnet availability when its dedicated token is absent. In
`convex/seed.ts`, set the dedicated one-night Consensus Commons mainnet demo
rate to 19 cents before rounded 13% HST, producing the required 21-cent total; do not
change other fictional inventory.

- [ ] **Step 5: Run focused tests and codegen**

Run:

```powershell
npm test -- convex/wavelengthMainnet.test.ts convex/wavelengthBridge.test.ts
npx convex codegen
```

Expected: tests pass; `convex/_generated/api.d.ts` remains valid.

- [ ] **Step 6: Commit**

```powershell
git add -- convex/schema.ts convex/wavelength.ts convex/seed.ts convex/wavelengthBridge.test.ts convex/wavelengthMainnet.test.ts convex/_generated/api.d.ts
git commit -m "Snapshot Wavelength network on payment requests"
```

### Task 3: Carry network through authenticated bridge endpoints

**Files:**
- Modify: `convex/http.ts`
- Modify: `cli/src/waveBridge.ts`
- Modify: `cli/src/waveBridge.test.ts`

- [ ] **Step 1: Write failing CLI bridge tests**

Extend the existing bridge fixtures with `network: 'mainnet'`. Add a daemon-info mock and assertions:

```ts
expect(await runBridgeCycle(depsFor({ requestNetwork: 'mainnet', daemonNetwork: 'signet' })))
  .toMatchObject({ processed: 0, errors: ['WAVELENGTH_NETWORK_MISMATCH'] });
expect(recvMock).not.toHaveBeenCalled();
```

Also assert the invoice publication and settlement POST bodies contain `network: 'mainnet'`, and that 209/211-sat activity never reaches `/settled`.

- [ ] **Step 2: Run the CLI test and verify RED**

Run: `npm --prefix cli test -- src/waveBridge.test.ts`

Expected: FAIL because the bridge neither queries nor reports network.

- [ ] **Step 3: Add network to the HTTP boundary**

In `convex/http.ts`, parse `network` for `/wavelength-bridge/invoice` and `/wavelength-bridge/settled` as the exact union `signet | mainnet`, pass it to the internal mutations, and return HTTP 400 for an unsupported value. Continue returning 401 before parsing a body when bearer authentication fails.

- [ ] **Step 4: Add daemon network preflight**

In `cli/src/waveBridge.ts`, add:

```ts
type WavelengthNetwork = 'signet' | 'mainnet';

async function daemonNetwork(
  fetchImpl: typeof fetch,
  daemonUrl: string,
  macaroonHex: string,
): Promise<WavelengthNetwork> {
  const response = await fetchImpl(`${daemonUrl}/v1/daemon/get-info`, {
    method: 'POST',
    headers: { Macaroon: macaroonHex, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`WAVELENGTH_DAEMON_INFO_${response.status}`);
  const body = await response.json() as { network?: string };
  if (body.network !== 'signet' && body.network !== 'mainnet') throw new Error('INVALID_DAEMON_NETWORK');
  return body.network;
}
```

Read the daemon macaroon from `WAVELENGTH_DAEMON_MACAROON_PATH`, convert it to
hex without printing it, and attach the `Macaroon` header to get-info, recv, and
activity requests. Fetch daemon info once before processing the batch, reject
every mismatched request before calling `/v1/wallet/recv`, and include the
verified network in invoice/settled reports.

- [ ] **Step 5: Run CLI and root bridge tests**

Run:

```powershell
npm --prefix cli test -- src/waveBridge.test.ts
npm test -- convex/wavelengthBridge.test.ts convex/wavelengthMainnet.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- convex/http.ts cli/src/waveBridge.ts cli/src/waveBridge.test.ts
git commit -m "Verify Wavelength network across the merchant bridge"
```

### Task 4: Present a deliberately manual real-money UI

**Files:**
- Modify: `src/pages/CheckoutPage.tsx`
- Modify: `src/pages/WavelengthWalletPage.tsx`
- Test: `src/pages/WavelengthWalletPage.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Test that a mainnet request renders `REAL BITCOIN`, `210 sats`, a copyable BOLT11 invoice, expiry, and the instruction to pay from an external wallet. Assert it does not mount `WavelengthProvider` or expose Create/Unlock/Pay wallet controls. Test that signet still mounts the existing embedded wallet experience.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `npm test -- src/pages/WavelengthWalletPage.test.tsx`

Expected: FAIL because the page is signet-only.

- [ ] **Step 3: Split invoice presentation from the signet wallet**

Create an internal `MainnetInvoice` component in `WavelengthWalletPage.tsx` that receives the request, renders the exact amount/network/expiry, QR-or-copy invoice surface, and never calls wallet create/unlock/send. Keep the current component under `SignetWalletPayment`. Choose between them using `request.network`.

In `CheckoutPage.tsx`, replace the hard-coded signet copy with the network returned by `api.wavelength.available`; mainnet copy must state `Real Lightning payment · fixed 210-sat hackathon price`.

- [ ] **Step 4: Run tests and accessibility smoke checks**

Run:

```powershell
npm test -- src/pages/WavelengthWalletPage.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass; the invoice remains keyboard-copyable and error/status text has `role="status"` or `role="alert"`.

- [ ] **Step 5: Commit**

```powershell
git add -- src/pages/CheckoutPage.tsx src/pages/WavelengthWalletPage.tsx src/pages/WavelengthWalletPage.test.tsx
git commit -m "Show guarded external-wallet mainnet invoices"
```

### Task 5: Add separate guarded mainnet startup

**Files:**
- Create: `scripts/start-wavelength-mainnet.ps1`
- Create: `scripts/start-mainnet-bridge.ps1`
- Modify: `.gitignore`

- [ ] **Step 1: Create script contract tests**

Create `scripts/start-wavelength-mainnet.test.ps1` that invokes the startup script without `-AcknowledgeRealSats` and asserts a non-zero exit containing `Explicit acknowledgement required`. Add static assertions that the script contains `--allow-mainnet`, does not contain `--allow-insecure-mainnet`, binds `127.0.0.1`, and uses `wavelength-mainnet` rather than `wavelength-signet`.

- [ ] **Step 2: Run the PowerShell test and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/start-wavelength-mainnet.test.ps1`

Expected: FAIL because the startup script does not exist.

- [ ] **Step 3: Implement the guarded daemon script**

The script must declare:

```powershell
param([switch]$AcknowledgeRealSats)
if (-not $AcknowledgeRealSats) { throw 'Explicit acknowledgement required for real sats.' }
$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\wavelength-mainnet'
$args = @(
  '--network=mainnet',
  '--allow-mainnet',
  "--datadir=$runtimeDir",
  '--rpc.listenaddr=127.0.0.1:11029',
  '--rpc.gateway.enabled=true',
  '--rpc.gateway.listenaddr=127.0.0.1:11031'
)
```

Require an existing user-ACL-protected password file, refuse to overwrite a wallet/recovery file, capture logs under the mainnet directory, and print no secrets.

- [ ] **Step 4: Implement the separate bridge script**

Use `WAVELENGTH_MAINNET_BRIDGE_TOKEN`, daemon URL
`http://127.0.0.1:11031`, the macaroon at
`%LOCALAPPDATA%\OpenStays\wavelength-mainnet\data\mainnet\admin.macaroon`, and
set `WAVELENGTH_EXPECTED_NETWORK=mainnet`. Refuse startup unless
`WAVELENGTH_MAINNET_ACK` from Convex equals `I_UNDERSTAND_REAL_SATS`.

- [ ] **Step 5: Run the script contract test**

Run: `powershell -ExecutionPolicy Bypass -File scripts/start-wavelength-mainnet.test.ps1`

Expected: PASS without launching or creating a mainnet wallet.

- [ ] **Step 6: Commit**

```powershell
git add -- .gitignore scripts/start-wavelength-mainnet.ps1 scripts/start-mainnet-bridge.ps1 scripts/start-wavelength-mainnet.test.ps1
git commit -m "Add guarded isolated Wavelength mainnet startup"
```

### Task 6: Document and verify without spending sats

**Files:**
- Modify: `docs/hackathon-mvp.md`
- Modify: `CLAUDE.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Update binding documentation**

Document the 21-cent/210-sat fixed demo peg, external Lightning wallet, exact cap, separate directories/tokens/ports, `--allow-mainnet` requirement, prohibition on insecure mainnet, friend-review gate, and signet fallback. Mark Zaprite sandbox creation as the later blocker.

- [ ] **Step 2: Run all automated gates**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
git diff --check
```

Expected: every command exits 0. The existing nonfatal Node `TimeoutNegativeWarning` may still appear.

- [ ] **Step 3: Perform no-money preflight**

After an approved Wavelength contact confirms endpoints and 210-sat support, start the isolated mainnet daemon with explicit acknowledgement and verify only process state, loopback ports, reported network, wallet state, and zero/expected balance. Do not fund, create an invoice, or pay during this step.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/hackathon-mvp.md CLAUDE.md STATUS.md
git commit -m "Document guarded 210-sat Wavelength acceptance"
```

- [ ] **Step 5: Stop at the real-money gate**

Report the verified no-money state to the operator. Obtain a final explicit go-ahead immediately before creating/paying the real 210-sat invoice; this prevents a stale approval from authorizing an unexpected payment after configuration changes.
