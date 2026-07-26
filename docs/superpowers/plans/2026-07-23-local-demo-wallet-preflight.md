# Local Demo Wallet Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loopback-only setup screen that prepares the existing self-custodial Wavelength browser wallet with 12,000 real Signet sats for twelve fast judge demos.

**Architecture:** Pure helpers define the localhost guard, immutable funding target, and conservative attempt count. The existing Wavelength wallet page reuses its single engine and wallet lifecycle, but bypasses booking authentication only when both a loopback hostname and `demoSetup=1` are present. Funding remains a one-time operator action: create one amount-bearing Lightning invoice in the browser, validate the merchant daemon's Signet/off-chain quote, send once, reconcile the outgoing activity, and wait for the browser balance to become spendable.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, `@lightninglabs/wavelength-react`, local Wavelength daemon REST API.

---

## File structure

- Create `src/lib/wavelengthDemoWallet.ts`: constants and pure loopback/readiness calculations.
- Create `tests/wavelengthDemoWallet.test.ts`: unit coverage for the guard, target, and attempts.
- Modify `src/pages/WavelengthWalletPage.tsx`: localhost setup UI and 12,000-sat receive invoice.
- Modify `tests/demoUXCopy.test.ts`: source-level safety and judge-copy regression coverage.
- Modify `docs/hackathon-mvp.md`: operator setup and one-shot funding procedure.
- Modify `STATUS.md`: dated checkpoint and live acceptance result.

### Task 1: Pure demo-wallet policy

**Files:**
- Create: `src/lib/wavelengthDemoWallet.ts`
- Create: `tests/wavelengthDemoWallet.test.ts`

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEMO_WALLET_ATTEMPT_SATS,
  DEMO_WALLET_TARGET_ATTEMPTS,
  DEMO_WALLET_TARGET_SATS,
  demoWalletAttemptsFunded,
  isLocalDemoWalletSetup,
} from '../src/lib/wavelengthDemoWallet';

describe('local demo wallet policy', () => {
  it('pins twelve 1,000-sat attempts to a 12,000-sat target', () => {
    expect(DEMO_WALLET_ATTEMPT_SATS).toBe(1_000);
    expect(DEMO_WALLET_TARGET_ATTEMPTS).toBe(12);
    expect(DEMO_WALLET_TARGET_SATS).toBe(12_000);
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('permits explicit setup on %s', (hostname) => {
    expect(isLocalDemoWalletSetup(hostname, '1')).toBe(true);
  });

  it.each([
    ['openstays.example', '1'],
    ['127.0.0.1', null],
    ['localhost', '0'],
  ])('rejects non-local or implicit setup', (hostname, flag) => {
    expect(isLocalDemoWalletSetup(hostname, flag)).toBe(false);
  });

  it('counts only complete, spendable attempts', () => {
    expect(demoWalletAttemptsFunded(0)).toBe(0);
    expect(demoWalletAttemptsFunded(11_999)).toBe(11);
    expect(demoWalletAttemptsFunded(12_000)).toBe(12);
    expect(demoWalletAttemptsFunded(-1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/wavelengthDemoWallet.test.ts`

Expected: FAIL because `src/lib/wavelengthDemoWallet.ts` does not exist.

- [ ] **Step 3: Implement the minimal policy module**

```ts
export const DEMO_WALLET_ATTEMPT_SATS = 1_000;
export const DEMO_WALLET_TARGET_ATTEMPTS = 12;
export const DEMO_WALLET_TARGET_SATS =
  DEMO_WALLET_ATTEMPT_SATS * DEMO_WALLET_TARGET_ATTEMPTS;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLocalDemoWalletSetup(hostname: string, setupFlag: string | null) {
  return setupFlag === '1' && LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function demoWalletAttemptsFunded(spendableSats: number) {
  return Math.max(0, Math.floor(spendableSats / DEMO_WALLET_ATTEMPT_SATS));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/wavelengthDemoWallet.test.ts`

Expected: all policy tests pass.

- [ ] **Step 5: Commit the policy**

```powershell
git add -- src/lib/wavelengthDemoWallet.ts tests/wavelengthDemoWallet.test.ts
git commit -m "test: define local demo wallet policy"
```

### Task 2: Loopback-only wallet setup UI

**Files:**
- Modify: `src/pages/WavelengthWalletPage.tsx`
- Modify: `tests/demoUXCopy.test.ts`

- [ ] **Step 1: Write the failing setup UI regression**

Append a test that asserts the page imports `useWalletReceive`, calls `receive.receive({ amountSat: DEMO_WALLET_TARGET_SATS`, gates setup with `isLocalDemoWalletSetup(window.location.hostname, searchParams.get('demoSetup'))`, and contains the copy `Prepare demo wallet`, `Demo wallet ready`, and `12 judge attempts`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/demoUXCopy.test.ts`

Expected: FAIL because the setup mode and receive hook are absent.

- [ ] **Step 3: Add the setup mode**

In `WavelengthWalletPage.tsx`:

- import `useWalletReceive` and the four demo-wallet helpers/constants;
- derive the setup flag from the loopback hostname plus `demoSetup=1`;
- start immediately in setup mode without calling Convex booking mutations or queries;
- reuse the existing create/unlock, balance refresh, pending-state, and recovery-word controls;
- create exactly one receive invoice with:

```ts
const result = await receive.receive({
  amountSat: DEMO_WALLET_TARGET_SATS,
  memo: 'OpenStays judge demo wallet preflight',
});
setDemoFundingInvoice(result.invoice);
```

- show the invoice with `break-all` styling and never auto-pay it;
- show `Demo wallet ready` only when `spendableSats >= DEMO_WALLET_TARGET_SATS`;
- show `Math.min(DEMO_WALLET_TARGET_ATTEMPTS, demoWalletAttemptsFunded(spendableSats))`;
- include receive errors in `displayError`;
- leave the normal booking path byte-for-byte behaviorally equivalent.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm test -- tests/wavelengthDemoWallet.test.ts tests/demoUXCopy.test.ts
npm run typecheck
```

Expected: both suites and TypeScript pass.

- [ ] **Step 5: Commit the UI**

```powershell
git add -- src/pages/WavelengthWalletPage.tsx tests/demoUXCopy.test.ts
git commit -m "feat: add localhost demo wallet preflight"
```

### Task 3: Operator documentation

**Files:**
- Modify: `docs/hackathon-mvp.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Document the exact local flow**

Add a section that uses:

```text
http://127.0.0.1:4173/wallet/demo?demoSetup=1
```

Document the 12,000-sat target, 210-sat maximum funding fee, single-use intent rule, no duplicate retry rule, and green readiness condition. State that the browser holds the keys and that this route is inert away from loopback.

- [ ] **Step 2: Record the pre-live checkpoint**

Add a dated `STATUS.md` entry listing the policy/UI tests and stating that live funding is pending until the merchant send and browser spendable balance both reconcile.

- [ ] **Step 3: Build documentation**

Run: `npm run docs:build`

Expected: VitePress build succeeds.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/hackathon-mvp.md STATUS.md
git commit -m "docs: add demo wallet preflight runbook"
```

### Task 4: Full regression gates

**Files:** No source changes expected.

- [ ] **Step 1: Run root gates**

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all root tests pass, TypeScript emits no errors, and Vite builds.

- [ ] **Step 2: Run CLI gates**

```powershell
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: all CLI tests pass, TypeScript emits no errors, and the CLI builds.

### Task 5: One-shot live Signet funding

**Files:**
- Modify after acceptance: `STATUS.md`

- [ ] **Step 1: Open the setup route and unlock the existing test wallet**

Use the existing local test-only wallet. Do not display or transmit its password, mnemonic, or persisted storage.

- [ ] **Step 2: Create exactly one 12,000-sat invoice**

Click `Create 12,000-sat funding invoice` once. Capture the BOLT11 from the visible DOM and do not create a replacement while it is valid or pending.

- [ ] **Step 3: Validate the merchant before preparing**

Call the loopback daemon's wallet-info endpoint and require Signet. Reject any other network before constructing a send.

- [ ] **Step 4: Prepare and validate the send**

POST the invoice, `max_fee_sat: 210`, and operator note to `/v1/wallet/prepare-send`. Require:

```ts
Number(prepared.amount_sat) === 12_000
prepared.total_outflow_known === true
!prepared.rail.toUpperCase().includes('ONCHAIN')
Number(prepared.expected_total_outflow_sat) >= 12_000
Number(prepared.expected_total_outflow_sat) <= 12_210
prepared.expires_at_unix * 1000 > Date.now() + 30_000
```

If an explicit fee field exists, also require `principal + fee === total`.

- [ ] **Step 5: Send the single-use intent once**

POST only `send_intent_id` to `/v1/wallet/send`. Never resubmit after an ambiguous response; inspect activity first.

- [ ] **Step 6: Reconcile merchant activity**

Poll `/v1/wallet/inspect/activity` until complete. Require the returned activity to bind to the prepared payment hash/invoice and exact 12,000-sat outgoing principal.

- [ ] **Step 7: Reconcile browser spendability**

Use manual/automatic wallet refresh until the browser reports at least 12,000 spendable sats. Pending inbound is not readiness.

- [ ] **Step 8: Record authoritative acceptance**

Update `STATUS.md` with the merchant activity identifier, timestamp, resulting spendable balance, and whether any amount remains pending. Do not include an invoice, seed, password, or payment credential.

### Task 6: Browser demo acceptance

**Files:** No source changes expected unless a blocker is found.

- [ ] **Step 1: Desktop acceptance**

At 1280px, confirm the setup card, invoice wrapping, refresh controls, ready banner, and attempt count render without console errors or horizontal overflow.

- [ ] **Step 2: Mobile acceptance**

At 390px, repeat the setup-route checks and confirm `scrollWidth <= innerWidth`.

- [ ] **Step 3: Normal-flow regression**

Open a real booking wallet URL without `demoSetup=1` and confirm the booking-email gate remains present and no setup controls appear.

- [ ] **Step 4: Commit the acceptance record**

```powershell
git add -- STATUS.md
git commit -m "docs: record funded demo wallet acceptance"
```

- [ ] **Step 5: Stop at the local checkpoint**

Report the exact green gates and wallet readiness. Do not push, deploy, or merge without a new instruction.
