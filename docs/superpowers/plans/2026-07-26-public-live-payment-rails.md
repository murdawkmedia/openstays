# OpenStays Public Live Payment Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an explicitly fictional OpenStays showcase where visitors may contribute exactly CA$1 through Zaprite or pay exactly 1,000 signet sats through Wavelength, receive a privacy-safe OpenTimestamps receipt, and claim at most one 1,000-signet-sat reward under bounded abuse controls.

**Architecture:** Cloudflare Pages serves the React app; the dedicated Convex deployment remains authoritative for bookings, payments, receipts, refunds, retention, and reward state. A Cloudflare Worker verifies Turnstile, issues short-lived eligibility tokens, and owns one Durable Object that supervises one Cloudflare Container. The container runs the Wavelength signet merchant daemon plus the existing Wavelength, OpenTimestamps, and SMTP bridges, while encrypted versioned merchant-wallet archives are stored in private R2.

**Tech Stack:** React 19, Vite 7, TypeScript, Convex, Vitest, Playwright, Cloudflare Workers/Containers/Durable Objects/R2/Turnstile, Zaprite API, Wavelength v0.1.0 signet, OpenTimestamps Python client 0.7.2, Node.js CLI workers.

---

## Working boundaries

- Work only on `codex/public-live-payment-rails` in the dedicated worktree.
- Do not inspect, copy, or configure credentials until the operator gives a fresh credential approval during execution.
- Do not use any unrelated Convex, Zaprite, Cloudflare, SMTP, or wallet resource.
- Keep every live rail disabled until dependency, automated, recovery, and live-acceptance gates pass.
- Preserve the existing simulated public path and the historical hackathon evidence.
- Do not push, deploy, create paid resources, or enable public traffic without the separate execution-time approval stated in Task 12.

## File structure

### Existing application files to modify

- `package.json`, `package-lock.json` — pin runtime security fixes and add Cloudflare operations scripts.
- `SECURITY.md` — record the runtime audit gate and private-only VitePress decision.
- `convex/schema.ts` — add consent, reward-claim, bridge-health, and retention fields/tables.
- `convex/publicPolicy.ts` — central fixed amounts, enable flags, consent version, token verification, and reward limits.
- `convex/publicPolicy.test.ts` — policy, signature, expiry, replay, and limit tests.
- `convex/payments/checkout.ts`, `convex/payments/zaprite.ts` — exact CA$1 contribution and authoritative order validation.
- `convex/wavelength.ts`, `convex/wavelengthRewards.ts` — exact 1,000-sat requests, public eligibility, health, and payout limits.
- `convex/consensusReceipts.ts` — reward eligibility only for authoritative Zaprite/Wavelength settlement.
- `convex/refunds.ts` — authenticated guest refund request for public paid bookings.
- `convex/demo.ts`, `convex/crons.ts`, `convex/publicMaintenance.ts` — prohibit destructive reset in live mode and implement 14-day purge.
- `convex/email.ts`, `convex/http.ts` — retention-safe mail and scoped service heartbeat endpoint.
- `src/lib/publicShowcase.ts`, `src/lib/livePayments.ts` — public live-rail flags, disclosures, device ID, and eligibility-token client.
- `src/components/LivePaymentDisclosure.tsx`, `src/components/TurnstileChallenge.tsx` — required consent and non-wallet-route Turnstile UI.
- `src/pages/CheckoutPage.tsx`, `src/pages/WavelengthWalletPage.tsx`, `src/pages/ManageBookingPage.tsx`, `src/pages/ConsensusRewardPage.tsx` — complete public payment/reward/refund experience.
- `src/main.tsx`, `vite.config.ts`, `public/_headers` — include wallet routes/runtime and scope cross-origin isolation to `/wallet/*`.
- `tests/*.test.ts`, `tests/e2e/public-live-payments.e2e.ts` — component, build-contract, and browser acceptance coverage.
- `README.md`, `STATUS.md`, `docs/public-live-payments.md`, `docs/operations/public-live-payments-runbook.md` — setup, safety, rollback, and decisions in force.

### New Cloudflare operations package

- `ops/cloudflare/package.json`, `ops/cloudflare/tsconfig.json`, `ops/cloudflare/vitest.config.ts`, `ops/cloudflare/wrangler.jsonc` — isolated Worker/Container package and bindings.
- `ops/cloudflare/src/index.ts` — public eligibility route, operator health route, scheduled wakeup, and CORS.
- `ops/cloudflare/src/eligibility.ts` — Turnstile verification and compact HMAC token creation.
- `ops/cloudflare/src/merchantContainer.ts` — one Durable Object controlling one merchant container.
- `ops/cloudflare/src/backupManifest.ts` — immutable archive metadata, digest verification, pointer advance, and seven-version retention.
- `ops/cloudflare/container/Dockerfile` — checksum-pinned Wavelength and bridge image.
- `ops/cloudflare/container/control.mjs` — loopback control server, restore-before-start, supervised workers, backup request, and health.
- `ops/cloudflare/container/backup.mjs` — AES-256-GCM archive encryption and digest output.
- `ops/cloudflare/tests/*.test.ts` — eligibility, CORS, backup, restore, lifecycle, and fail-closed tests.

### Existing CLI package to modify

- `cli/src/waveBridge.ts`, `cli/src/otsBridge.ts`, `cli/src/mailBridge.ts` — container-friendly lifecycle, heartbeat, and redacted logs.
- `cli/src/operationsHeartbeat.ts` — shared heartbeat publisher.
- `cli/src/index.ts`, `cli/package.json`, `cli/tests/operationsHeartbeat.test.ts` — expose and verify the container worker commands.

---

### Task 1: Resolve runtime dependency advisories

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `SECURITY.md`
- Test: existing root test suite

- [x] **Step 1: Capture the failing runtime audit**

Run:

```powershell
npm audit --omit=dev --audit-level=high
```

Expected: non-zero exit reporting the current `@auth/core` or `react-router` runtime advisory chain. `postcss` is still pinned in Step 2 because the full audit identifies it as a direct development dependency.

- [x] **Step 2: Pin the compatible patched versions**

Run:

```powershell
npm install --save-exact @auth/core@0.41.3 react-router-dom@7.18.1
npm install --save-dev --save-exact postcss@8.5.23
```

Expected: `package.json` and `package-lock.json` use the exact versions; `@convex-dev/auth` peer requirements remain satisfied.

- [x] **Step 3: Verify the application and runtime audit**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run audit:runtime
```

Expected: all 440-or-more root tests pass and typecheck/build exit 0. The
runtime audit rejects every applicable high/critical advisory. React Router
`GHSA-qwww-vcr4-c8h2` is narrowly accepted only while this remains a client-only
SPA with no unstable RSC API or server tooling; GitHub states that the advisory
affects only unstable RSC APIs.

- [x] **Step 4: Record the development-only exposure decision**

Add to `SECURITY.md`:

```markdown
## Documentation development server

The VitePress development server is a loopback-only authoring tool and is not
part of the OpenStays production application or Cloudflare deployment. Do not
bind `npm run docs:dev` to a public interface. Production gates use
`npm audit --omit=dev --audit-level=high`; remaining development-only findings
must be re-evaluated whenever VitePress publishes a compatible fix.
```

- [x] **Step 5: Commit**

```powershell
git add package.json package-lock.json SECURITY.md scripts/check-runtime-audit.mjs scripts/check-runtime-audit.d.mts tests/runtimeAuditPolicy.test.ts docs/superpowers/plans/2026-07-26-public-live-payment-rails.md
git commit -m "chore: clear live payment runtime audit gate"
```

---

### Task 2: Add one authoritative public-live policy

**Files:**
- Create: `convex/publicPolicy.ts`
- Create: `convex/publicPolicy.test.ts`
- Modify: `convex/schema.ts`
- Modify: `src/lib/publicShowcase.ts`
- Create: `src/lib/livePayments.ts`
- Test: `tests/publicShowcase.test.ts`

- [x] **Step 1: Write failing policy tests**

Cover these exact assertions in `convex/publicPolicy.test.ts`:

```ts
expect(readPublicPolicy({})).toMatchObject({
  zapriteEnabled: false,
  wavelengthEnabled: false,
  rewardsEnabled: false,
  zapriteContributionCents: 100,
  wavelengthPaymentSats: 1000,
  rewardSats: 1000,
  rewardDailyBudgetSats: 0,
});
expect(() => readPublicPolicy({
  PUBLIC_LIVE_PAYMENTS: "true",
  PUBLIC_ZAPRITE_CONTRIBUTION_CENTS: "99",
})).toThrow("PUBLIC_ZAPRITE_CONTRIBUTION_CENTS must be 100");
```

Also test that `DEMO_MODE=true` plus any live enable flag throws `LIVE_DEMO_MODE_CONFLICT`.

- [x] **Step 2: Run the focused test and confirm red**

Run:

```powershell
npx vitest run convex/publicPolicy.test.ts
```

Expected: FAIL because `convex/publicPolicy.ts` does not exist.

- [x] **Step 3: Implement typed policy constants**

Create `convex/publicPolicy.ts` with these exported contracts:

```ts
export const PUBLIC_CONSENT_VERSION = "openstays.public-live.v1" as const;
export const ZAPRITE_CONTRIBUTION_CENTS = 100 as const;
export const WAVELENGTH_PAYMENT_SATS = 1000 as const;
export const WAVELENGTH_REWARD_SATS = 1000 as const;

export type PublicPolicy = {
  liveMode: boolean;
  simulatedEnabled: boolean;
  zapriteEnabled: boolean;
  wavelengthEnabled: boolean;
  rewardsEnabled: boolean;
  zapriteContributionCents: 100;
  wavelengthPaymentSats: 1000;
  rewardSats: 1000;
  rewardDailyBudgetSats: number;
  rewardMaxFeeSats: number;
};

export function readPublicPolicy(env: Record<string, string | undefined>): PublicPolicy
export type VerifiedEligibility = {
  jti: string;
  action: "zaprite_payment" | "wavelength_payment" | "reward_claim";
  bookingId: string;
  emailDigest: string;
  deviceDigest: string;
  networkDigest: string;
  iat: number;
  exp: number;
};
export async function verifyEligibilityToken(
  token: string,
  expected: { action: VerifiedEligibility["action"]; bookingId: string },
  signingKey: string,
  nowMs: number,
): Promise<VerifiedEligibility>;
export async function eligibilityEmailDigest(
  normalizedEmail: string,
  signingKey: string,
): Promise<string>;
```

The implementation must:

- treat missing enable flags as false;
- require `PUBLIC_LIVE_PAYMENTS=true` before any rail can be true;
- reject `DEMO_MODE=true` when a live rail is true;
- default the reward daily budget to `0`;
- accept only exact `100`, `1000`, and `1000` fixed amounts;
- reject negative/non-integer budget and fee values;
- verify base64url payload/signature with Web Crypto HMAC-SHA-256 using a
  timing-safe byte comparison;
- reject malformed, expired, future-issued, wrong-action, and wrong-booking
  tokens; and
- derive the normalized-email digest identically to the Cloudflare issuer.

- [x] **Step 4: Extend persistent types**

In `convex/schema.ts`, add optional booking consent:

```ts
publicPaymentConsent: v.optional(v.object({
  version: v.string(),
  acceptedAt: v.number(),
  rail: v.union(v.literal("zaprite"), v.literal("wavelength")),
})),
```

Add `publicRewardClaims` with booking/reward IDs, HMAC email/device/network digests, token ID, claim status, amount/network, and timestamps. Add indexes by token ID, booking, and each digest plus `claimedAt`.

Add `bridgeHealth` with a service literal (`wavelength`, `ots`, `mail`, `backup`), status, heartbeat time, wallet spendable sats, backup generation/digest/time, and redacted failure category. Index by service.

- [x] **Step 5: Make public build capabilities independent**

Change `src/lib/publicShowcase.ts` so public showcase no longer implies wallet removal:

```ts
export const PUBLIC_SHOWCASE = {
  enabled: import.meta.env.VITE_PUBLIC_SHOWCASE === "true",
  allowStaffRoutes: import.meta.env.VITE_PUBLIC_SHOWCASE !== "true",
  allowLiveWavelength: import.meta.env.VITE_PUBLIC_WAVELENGTH === "true",
  allowLiveZaprite: import.meta.env.VITE_PUBLIC_ZAPRITE === "true",
  allowSimulated: import.meta.env.VITE_PUBLIC_SIMULATED !== "false",
} as const;
```

Create `src/lib/livePayments.ts` with the disclosure text, `PUBLIC_CONSENT_VERSION`, exact display amounts, and a persistent random 128-bit device ID stored under `openstays.public.device.v1`.

- [x] **Step 6: Run focused and regression tests**

Run:

```powershell
npx vitest run convex/publicPolicy.test.ts tests/publicShowcase.test.ts
npm run typecheck
```

Expected: focused tests pass and TypeScript exits 0.

- [x] **Step 7: Commit**

```powershell
git add convex/publicPolicy.ts convex/publicPolicy.test.ts convex/schema.ts src/lib/publicShowcase.ts src/lib/livePayments.ts src/vite-env.d.ts tests/publicShowcase.test.ts docs/superpowers/plans/2026-07-26-public-live-payment-rails.md
git commit -m "feat: define public live payment policy"
```

---

### Task 3: Enforce disclosure, Turnstile eligibility, and exact Zaprite contribution

**Files:**
- Create: `src/components/LivePaymentDisclosure.tsx`
- Create: `src/components/TurnstileChallenge.tsx`
- Modify: `src/pages/CheckoutPage.tsx`
- Modify: `convex/payments/checkout.ts`
- Modify: `convex/payments/zaprite.ts`
- Test: `convex/checkout.test.ts`
- Test: `convex/payments/zaprite.test.ts`
- Create: `tests/livePaymentDisclosure.test.ts`

- [x] **Step 1: Write failing tests**

Assert:

- unchecked disclosure blocks live checkout;
- marketing consent does not satisfy payment disclosure;
- a Zaprite order always sends `amount: 100`, `currency: "CAD"`;
- stored booking consent uses `openstays.public-live.v1`;
- missing/expired/wrong-action eligibility token is rejected;
- reconciliation rejects wrong `externalUniqId`, checkout ID, currency, amount, metadata, or expired order;
- `PAID` and `COMPLETE` confirm; pending/processing/underpaid do not; overpaid confirms 100 cents and opens one refund case.

- [x] **Step 2: Run the tests and confirm red**

```powershell
npx vitest run tests/livePaymentDisclosure.test.ts convex/checkout.test.ts convex/payments/zaprite.test.ts
```

Expected: FAIL on missing disclosure and fixed-contribution enforcement.

- [x] **Step 3: Implement the consent component**

`LivePaymentDisclosure.tsx` must render the approved fictional-property wording verbatim, an unchecked required checkbox, rail-specific amount text, refund-request promise, and separate optional marketing checkbox. It accepts:

```ts
type Props = {
  rail: "zaprite" | "wavelength";
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
};
```

- [x] **Step 4: Implement Turnstile outside wallet routes**

`TurnstileChallenge.tsx` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, uses `VITE_TURNSTILE_SITE_KEY`, emits a token, and renders an accessible retry state. It must not be mounted under `/wallet/*`.

`CheckoutPage.tsx` obtains an eligibility token from:

```text
POST ${VITE_PAYMENT_EDGE_URL}/v1/eligibility
```

with `{ action, bookingId, normalizedEmail, deviceId, turnstileToken }`. Store the Wavelength token in `sessionStorage` under `openstays.eligibility.<bookingId>.wavelength_payment`; never put it in a URL.

- [x] **Step 5: Enforce the server-side Zaprite contract**

Change `createCheckoutSession` to require:

```ts
consent: {
  version: "openstays.public-live.v1";
  accepted: true;
};
eligibilityToken: string;
```

Verify the HMAC token before any provider call, patch booking consent in the same mutation that records the pending payment, and pass exactly 100 CAD cents to Zaprite. Add `consentVersion`, `bookingId`, and opaque reconciliation ID metadata. During reconciliation, compare every expected field fetched from Zaprite; never trust redirect or webhook content.

- [x] **Step 6: Verify focused tests**

```powershell
npx vitest run tests/livePaymentDisclosure.test.ts convex/checkout.test.ts convex/payments/zaprite.test.ts
npm run typecheck
```

Expected: all focused tests pass; typecheck exits 0.

- [x] **Step 7: Commit**

```powershell
git add src/components/LivePaymentDisclosure.tsx src/components/TurnstileChallenge.tsx src/pages/CheckoutPage.tsx src/lib/livePayments.ts src/vite-env.d.ts convex/schema.ts convex/bookings.ts convex/payments/types.ts convex/payments/checkout.ts convex/payments/zaprite.ts convex/payments/webhooks.ts tests/livePaymentDisclosure.test.ts convex/checkout.test.ts convex/payments/zaprite.test.ts docs/superpowers/plans/2026-07-26-public-live-payment-rails.md
git commit -m "feat: add consented one dollar Zaprite flow"
```

---

### Task 4: Make retention and reset safe for real payments

**Files:**
- Create: `convex/publicMaintenance.ts`
- Create: `convex/publicMaintenance.test.ts`
- Create: `convex/demo.test.ts`
- Modify: `convex/demo.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/email.ts`
- Modify: `convex/schema.ts`

- [x] **Step 1: Write failing cleanup tests**

Build fixtures for:

- a 15-day-old paid Zaprite booking;
- a 15-day-old paid Wavelength booking;
- a 15-day-old simulated booking;
- a recent unpaid hold;
- an expired unpaid hold;
- messages and email bodies on each.

Assert that cleanup:

- never deletes paid bookings, payments, receipts, rewards, refund cases, consent, amounts, provider references, or timestamps;
- pseudonymizes guest name to `Purged guest`, clears phone/email, and replaces normalized values with `purged:<guestId>`;
- deletes booking messages and clears email subject/body/to fields after 14 days;
- deletes expired unpaid holds and disposable simulated browsing state;
- is idempotent.

- [x] **Step 2: Confirm red**

```powershell
npx vitest run convex/publicMaintenance.test.ts
```

Expected: FAIL because `publicMaintenance` is missing.

- [x] **Step 3: Implement maintenance**

Create `convex/publicMaintenance.ts` with:

```ts
export const PII_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const runNightly = internalMutation({ args: {}, handler: async (ctx) => { /* bounded batches */ } });
```

Process at most 100 records per table per invocation. Preserve immutable and financial rows. Patch guests to nonidentifying required-string values, delete messages, and replace old email bodies/recipients with empty strings plus `retentionPurgedAt`.

Add `retentionPurgedAt: v.optional(v.number())` to `emailLog` in
`convex/schema.ts`.

- [x] **Step 4: Disable destructive reset in live mode**

At the start of `convex/demo.ts` reset:

```ts
if (process.env.PUBLIC_LIVE_PAYMENTS === "true") {
  throw new ConvexError({
    code: "LIVE_RESET_PROHIBITED",
    message: "Destructive demo reset is disabled while public live payments are configured.",
  });
}
```

Replace the nightly reset cron with `internal.publicMaintenance.runNightly`.

- [x] **Step 5: Verify**

```powershell
npx vitest run convex/publicMaintenance.test.ts convex/demo.test.ts
npm run typecheck
```

Expected: cleanup/reset tests pass and typecheck exits 0.

- [x] **Step 6: Commit**

```powershell
git add convex/publicMaintenance.ts convex/publicMaintenance.test.ts convex/demo.ts convex/crons.ts convex/email.ts convex/schema.ts
git commit -m "feat: add payment-safe fourteen day retention"
```

---

### Task 5: Gate receipts and rewards to authoritative live payments

**Files:**
- Modify: `convex/consensusReceipts.ts`
- Modify: `convex/wavelengthRewards.ts`
- Modify: `convex/rewardPolicy.ts`
- Modify: `convex/schema.ts`
- Test: `convex/consensusReceipts.test.ts`
- Test: `convex/wavelengthRewards.test.ts`
- Test: `tests/consensusReward.test.ts`

- [x] **Step 1: Write failing eligibility tests**

Assert:

- simulated/manual/Stripe/Square payments create no public reward;
- exactly one paid Zaprite or Wavelength settlement makes the submitted receipt reward-eligible;
- token action, booking ID, email digest, device digest, daily network digest, expiry, and signature must match;
- a matching email, device, or network digest paid within 24 hours rejects a second reward;
- missing daily budget behaves as zero;
- a 12,000-sat budget accepts twelve paid 1,000-sat rewards and rejects the thirteenth;
- stale bridge health or insufficient balance rejects claim without changing paid state;
- duplicate token ID and duplicate settlement are no-ops.

- [x] **Step 2: Confirm red**

```powershell
npx vitest run convex/consensusReceipts.test.ts convex/wavelengthRewards.test.ts tests/consensusReward.test.ts
```

Expected: FAIL because simulated receipts currently create reward rows and eligibility limits are absent.

- [x] **Step 3: Restrict reward creation**

In `consensusReceipts.ts`, find the authoritative settled payment used in the canonical receipt. Insert `wavelengthRewards` only when provider is `zaprite` or `wavelength`. Keep the receipt available for other confirmed booking types without a reward.

- [x] **Step 4: Add claim verification and atomic limits**

In `wavelengthRewards.submitInvoice`:

1. verify guest confirmation code plus normalized email;
2. verify the compact HMAC token and exact `reward_claim` action;
3. compare token email digest to HMAC of normalized email;
4. query 24-hour indexes for email/device/network collisions;
5. sum today’s paid/paying principal and compare with daily budget;
6. require fresh Wavelength heartbeat and spendable balance at least `1000 + maxFee`;
7. insert one `publicRewardClaims` row keyed by token ID before moving reward to `invoice_ready`;
8. enforce an amount-bearing, unexpired signet invoice for exactly 1,000 sats.

All checks and state changes occur in one Convex mutation.

- [x] **Step 5: Verify**

```powershell
npx vitest run convex/consensusReceipts.test.ts convex/wavelengthRewards.test.ts tests/consensusReward.test.ts
npm run typecheck
```

Expected: all focused tests pass and typecheck exits 0.

- [x] **Step 6: Commit**

```powershell
git add convex/consensusReceipts.ts convex/wavelengthRewards.ts convex/rewardPolicy.ts convex/schema.ts convex/consensusReceipts.test.ts convex/wavelengthRewards.test.ts tests/consensusReward.test.ts
git commit -m "feat: enforce bounded live payment rewards"
```

---

### Task 6: Expose live Wavelength safely in the public app

**Files:**
- Modify: `convex/wavelength.ts`
- Modify: `src/main.tsx`
- Modify: `src/pages/WavelengthWalletPage.tsx`
- Modify: `src/pages/ManageBookingPage.tsx`
- Modify: `src/pages/ConsensusRewardPage.tsx`
- Modify: `vite.config.ts`
- Modify: `public/_headers`
- Test: `tests/wavelengthPayment.test.ts`
- Test: `tests/wavelengthRuntime.test.ts`
- Test: `tests/cloudflarePagesShowcase.test.ts`

- [x] **Step 1: Write failing public-build tests**

Assert:

- public build includes `/wallet/pay/:requestId` and `/wallet/reward/:confirmationCode`;
- version-matched Wavelength runtime assets remain in `dist/wavewalletdk`;
- COOP `same-origin` and COEP `require-corp` apply to `/wallet/*`, not globally;
- Wavelength request rejects missing consent, eligibility token, stale health, wrong network, or any amount other than 1,000;
- wallet seeds/passwords never enter API arguments or logs;
- payment/reward eligibility token is read from and removed from `sessionStorage`.

- [x] **Step 2: Confirm red**

```powershell
npx vitest run tests/wavelengthPayment.test.ts tests/wavelengthRuntime.test.ts tests/cloudflarePagesShowcase.test.ts
```

Expected: FAIL because the current public build removes wallet routes/runtime.

- [x] **Step 3: Enforce backend request conditions**

Update `convex/wavelength.ts` to require current disclosure consent, a valid `wavelength_payment` token, fresh heartbeat, and exact 1,000-sat snapshot. Legacy rows remain readable, but new public requests are always literal `signet`.

- [x] **Step 4: Include wallet modules conditionally**

In `src/main.tsx`, include wallet routes when `VITE_PUBLIC_WAVELENGTH=true`; continue excluding all staff modules when `VITE_PUBLIC_SHOWCASE=true`.

Remove the `dist/wavewalletdk` deletion from `vite.config.ts` when live Wavelength is enabled. Keep runtime checksum preflight mandatory for public live builds.

- [x] **Step 5: Scope cross-origin isolation**

Set `public/_headers`:

```text
/wallet/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/wavewalletdk/*
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
```

Do not set COOP/COEP globally, allowing Turnstile on checkout/manage routes.

- [x] **Step 6: Complete wallet and reward UX**

`WavelengthWalletPage.tsx` shows exact principal, quoted fee, balance, expiry, signet-only warning, and an explicit confirm button before `send`. It requests a fresh invoice after a definitive consumed/expired failure.

`ManageBookingPage.tsx` shows the refund-request action and obtains reward Turnstile eligibility before navigating. `ConsensusRewardPage.tsx` reads the token from session storage, submits the exact 1,000-sat invoice, clears the token after acceptance, and announces authoritative paid state.

- [x] **Step 7: Verify**

```powershell
npx vitest run tests/wavelengthPayment.test.ts tests/wavelengthRuntime.test.ts tests/cloudflarePagesShowcase.test.ts tests/consensusReward.test.ts
npm run typecheck
npm run build
npm run wavelength:runtime:check -- dist/wavewalletdk
```

Expected: tests/typecheck/build pass and all required runtime assets verify.

- [x] **Step 8: Commit**

```powershell
git add convex/wavelength.ts src/main.tsx src/pages/WavelengthWalletPage.tsx src/pages/ManageBookingPage.tsx src/pages/ConsensusRewardPage.tsx vite.config.ts public/_headers tests/wavelengthPayment.test.ts tests/wavelengthRuntime.test.ts tests/cloudflarePagesShowcase.test.ts tests/consensusReward.test.ts
git commit -m "feat: expose guarded public signet wallets"
```

---

### Task 7: Build the Cloudflare eligibility Worker

**Files:**
- Create: `ops/cloudflare/package.json`
- Create: `ops/cloudflare/tsconfig.json`
- Create: `ops/cloudflare/vitest.config.ts`
- Create: `ops/cloudflare/wrangler.jsonc`
- Create: `ops/cloudflare/src/eligibility.ts`
- Create: `ops/cloudflare/src/index.ts`
- Create: `ops/cloudflare/tests/eligibility.test.ts`
- Create: `ops/cloudflare/tests/http.test.ts`

- [x] **Step 1: Scaffold exact package versions**

Use:

```json
{
  "name": "@openstays/cloudflare-operations",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "wrangler deploy --dry-run --containers-rollout=none --outdir dist"
  },
  "dependencies": {
    "@cloudflare/containers": "0.3.7"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.20260726.1",
    "typescript": "5.9.3",
    "vitest": "3.2.7",
    "wrangler": "4.114.0"
  }
}
```

Run `npm --prefix ops/cloudflare install`. Vitest 3.2.7 supersedes the
original 3.2.4 draft pin because 3.2.4 is affected by
`GHSA-5xrq-8626-4rwp`. The edge-only dry run suppresses container rollout so
it remains executable without Docker; the real container-image build remains
a mandatory Task 9 deployment gate.

- [x] **Step 2: Write failing eligibility tests**

Use a mocked Turnstile endpoint. Assert:

- only the configured origin receives CORS;
- missing/failed Turnstile returns 403;
- raw IP is absent from token, response, and logs;
- token includes action, booking, normalized-email HMAC, device HMAC, daily network HMAC, token ID, issued time, and five-minute expiry;
- signature changes when any claim changes;
- unsupported action or malformed input returns 400.

- [x] **Step 3: Confirm red**

```powershell
npm --prefix ops/cloudflare test
```

Expected: FAIL because Worker modules are missing.

- [x] **Step 4: Implement compact HMAC tokens**

`eligibility.ts` exports:

```ts
export type EligibilityAction =
  | "zaprite_payment"
  | "wavelength_payment"
  | "reward_claim";

export type EligibilityClaims = {
  v: 1;
  jti: string;
  action: EligibilityAction;
  bookingId: string;
  emailDigest: string;
  deviceDigest: string;
  networkDigest: string;
  iat: number;
  exp: number;
};

export async function verifyTurnstile(
  secret: string,
  response: string,
  remoteip: string,
  fetcher: typeof fetch,
): Promise<boolean>;

export async function issueEligibilityToken(
  input: { action: EligibilityAction; bookingId: string; normalizedEmail: string; deviceId: string; ip: string },
  signingKey: string,
  nowMs: number,
): Promise<string>;
```

Use Web Crypto HMAC-SHA-256 and base64url encoding. The daily network digest input is `YYYY-MM-DD + "\n" + ip`; return no raw IP.

- [x] **Step 5: Implement HTTP boundary**

`POST /v1/eligibility` validates JSON size under 8 KiB, exact origin, Turnstile response, action, booking ID, normalized email, and device ID. `GET /healthz` returns only release and aggregate component state. Unknown routes return 404. Operator diagnostics require bearer auth and never expose wallet secrets or recovery state.

- [x] **Step 6: Define bindings without values**

`wrangler.jsonc` declares:

- `PUBLIC_ORIGIN`;
- one R2 binding named `WALLET_BACKUPS`;
- one Durable Object binding named `MERCHANT_OPERATIONS`;
- one container binding named `MERCHANT_CONTAINER`;
- a Durable Object migration;
- a one-minute scheduled trigger.

List secret names, never values: `TURNSTILE_SECRET`, `ELIGIBILITY_HMAC_SECRET`, `OPERATIONS_ADMIN_TOKEN`.

- [x] **Step 7: Verify and commit**

```powershell
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npm --prefix ops/cloudflare run build
git add ops/cloudflare
git commit -m "feat: add Cloudflare eligibility edge"
```

Expected: package tests/typecheck/dry-run build pass.

---

### Task 8: Implement encrypted R2 wallet backup and restore

**Files:**
- Create: `ops/cloudflare/src/backupManifest.ts`
- Create: `ops/cloudflare/src/merchantContainer.ts`
- Create: `ops/cloudflare/container/backup.mjs`
- Create: `ops/cloudflare/container/control.mjs`
- Create: `ops/cloudflare/tests/backupManifest.test.ts`
- Create: `ops/cloudflare/tests/merchantContainer.test.ts`

- [x] **Step 1: Write failing backup tests**

Assert:

- AES-256-GCM archive output differs from plaintext and decrypts with the correct key;
- wrong key/tag fails;
- archive SHA-256 is checked before pointer advance;
- a new immutable object is stored before the Durable Object pointer changes;
- only the seven newest verified generations remain;
- restore digest mismatch prevents daemon start;
- missing archive never creates a replacement wallet;
- backup age beyond two minutes marks health unavailable.

- [x] **Step 2: Confirm red**

```powershell
npm --prefix ops/cloudflare test -- backupManifest merchantContainer
```

Expected: FAIL because backup/container modules are absent.

- [x] **Step 3: Implement manifest contract**

Use:

```ts
export type BackupManifest = {
  version: 1;
  generation: number;
  objectKey: string;
  sha256: string;
  byteLength: number;
  createdAt: string;
  release: string;
};
```

`backupManifest.ts` validates the digest of the uploaded ciphertext, writes `wallet/<generation>-<sha256>.tar.gz.enc`, then commits the manifest in Durable Object storage. Prune only after pointer commit and never delete the current generation.

- [x] **Step 4: Implement encrypted archive helper**

`backup.mjs` accepts the wallet directory, output path, and a 32-byte base64 key through environment. It creates a deterministic-file-order tar.gz, encrypts with a new 96-bit nonce using AES-256-GCM, writes a versioned binary envelope, and prints only JSON `{ sha256, byteLength }`.

- [x] **Step 5: Implement restore-before-start control**

`control.mjs` binds only to `127.0.0.1`. Its sequence is:

1. accept one authenticated restore archive from the Durable Object;
2. verify ciphertext digest;
3. decrypt and extract to an empty version-specific wallet directory;
4. start `waved`;
5. start the three bridge workers;
6. expose redacted health;
7. stop all processes if a required worker exits repeatedly.

The control server has no route that returns files, passwords, seeds, or raw daemon responses.

- [x] **Step 6: Implement the Durable Object**

`merchantContainer.ts` starts exactly one `basic` container, restores the newest verified archive, waits for ready health, requests a backup after wallet-changing activity and at least once per minute while dirty, uploads it to R2, advances the manifest, and publishes redacted health. Restore/backup failure keeps Wavelength unavailable.

- [x] **Step 7: Verify and commit**

```powershell
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
git add ops/cloudflare/src/backupManifest.ts ops/cloudflare/src/merchantContainer.ts ops/cloudflare/container/backup.mjs ops/cloudflare/container/control.mjs ops/cloudflare/tests/backupManifest.test.ts ops/cloudflare/tests/merchantContainer.test.ts
git commit -m "feat: add encrypted merchant wallet recovery"
```

---

### Task 9: Containerize and supervise Wavelength, OTS, and mail bridges

**Files:**
- Create: `ops/cloudflare/container/Dockerfile`
- Modify: `cli/src/waveBridge.ts`
- Modify: `cli/src/otsBridge.ts`
- Modify: `cli/src/mailBridge.ts`
- Create: `cli/src/operationsHeartbeat.ts`
- Create: `cli/tests/operationsHeartbeat.test.ts`
- Modify: `cli/src/index.ts`
- Modify: `cli/package.json`
- Modify: `convex/http.ts`
- Create: `convex/http.test.ts`

- [x] **Step 1: Write failing heartbeat and auth tests**

Assert:

- each worker posts a heartbeat every 15 seconds;
- tokens are service-scoped and cannot call another service endpoint;
- heartbeat contains service/status/release/timestamp and only Wavelength may include spendable balance;
- secrets, BOLT11 invoices, payment hashes, email addresses, SMTP details, and local paths are redacted;
- a heartbeat older than 60 seconds makes Wavelength unavailable.

- [x] **Step 2: Confirm red**

```powershell
npm --prefix cli test -- operationsHeartbeat
npx vitest run convex/http.test.ts
```

Expected: FAIL because heartbeat endpoints/modules are absent.

- [x] **Step 3: Implement shared heartbeat publisher**

Create:

```ts
export type OperationsService = "wavelength" | "ots" | "mail" | "backup";
export type OperationsHeartbeat = {
  service: OperationsService;
  status: "starting" | "ready" | "degraded" | "failed";
  release: string;
  observedAt: number;
  spendableSats?: number;
  failureCategory?: string;
};
```

Post to `/operations-bridge/heartbeat` with the service’s bearer token. Retry with capped exponential backoff and jitter; never print the token or request body.

- [x] **Step 4: Add Convex heartbeat endpoint**

`convex/http.ts` validates service-specific bearer tokens, rejects unknown fields, upserts `bridgeHealth`, and responds 204. Add an operator-only query that returns redacted health and a public query that returns only `{ wavelengthAvailable, rewardAvailable, updatedAt }`.

- [x] **Step 5: Make CLI workers container-friendly**

Add `--once` and continuous modes, `SIGTERM` handling, health publication, and process exit codes. Preserve existing idempotent reconciliation. OTS continues to use `opentimestamps-client==0.7.2`; mail continues to consume the generic SMTP queue.

- [x] **Step 6: Pin the container image**

`Dockerfile` uses pinned Node, Python, and Go image digests, installs the exact CLI lockfile, and installs `opentimestamps-client==0.7.2`. Lightning Labs' stock `waved` release omits the optional wallet-RPC service, so the image reproducibly builds Wavelength `v0.1.0` from its published checksum-pinned source and vendor archives with the official `wavewalletrpc swapruntime` tags. Run as a non-root user and expose only the loopback control port to the container runtime.

- [x] **Step 7: Verify and commit**

```powershell
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
npx vitest run convex/http.test.ts
npm --prefix ops/cloudflare run build
git add cli ops/cloudflare/container/Dockerfile convex/http.ts convex/http.test.ts
git commit -m "feat: supervise payment and notification workers"
```

---

### Task 10: Add refund request, health fallback, and complete public UX

**Files:**
- Modify: `convex/refunds.ts`
- Modify: `src/pages/CheckoutPage.tsx`
- Modify: `src/pages/ManageBookingPage.tsx`
- Modify: `src/pages/ConfirmationPage.tsx`
- Modify: `src/pages/ConsensusRewardPage.tsx`
- Create: `tests/publicRefundRequest.test.ts`
- Modify: `tests/demoUXCopy.test.ts`
- Create: `tests/e2e/public-live-payments.e2e.ts`

- [x] **Step 1: Write failing UI and authorization tests**

Assert:

- every public booking page says the property/reservation is fictional;
- Zaprite is described as a voluntary project contribution, not tax-deductible, with no charitable receipt;
- signet sats are described as test funds;
- simulated flow remains available and says no reward;
- authenticated guest can create one refund case; wrong email/code and cross-booking requests fail;
- stale Wavelength health hides live wallet/reward actions but leaves Zaprite/simulated controls usable;
- statuses distinguish payment requested/pending/paid/failed/refund requested, proof submitted/anchoring/anchored, and reward eligible/paid.

- [x] **Step 2: Confirm red**

```powershell
npx vitest run tests/publicRefundRequest.test.ts tests/demoUXCopy.test.ts tests/e2e/public-live-payments.e2e.ts
```

Expected: FAIL on missing public refund request and live fallback states.

- [x] **Step 3: Implement guest refund request**

Add `refunds.requestForGuest` requiring confirmation code plus normalized email. Permit only paid Zaprite/Wavelength payments, create one open idempotent case per payment/reason, and queue `manual_refund_required` for staff. Do not alter payment status or send refund-completed email.

- [x] **Step 4: Complete public status UI**

Render authoritative availability, exact amounts, clear rail differences, receipt preview/downloads, OTS pending-versus-anchored link, reward limits, refund request state, and a simulated-tour fallback. Use semantic live regions, visible focus, keyboard-operable dialogs, and no horizontal overflow.

- [x] **Step 5: Verify component/browser contracts**

```powershell
npx vitest run tests/publicRefundRequest.test.ts tests/demoUXCopy.test.ts tests/e2e/public-live-payments.e2e.ts
npm run typecheck
npm run build
npm run test:e2e:smoke
```

Expected: focused tests, build, and smoke walkthrough pass at desktop and 390 px with no console error or horizontal overflow.

- [x] **Step 6: Commit**

```powershell
git add convex/refunds.ts src/pages/CheckoutPage.tsx src/pages/ManageBookingPage.tsx src/pages/ConfirmationPage.tsx src/pages/ConsensusRewardPage.tsx tests/publicRefundRequest.test.ts tests/demoUXCopy.test.ts tests/e2e/public-live-payments.e2e.ts
git commit -m "feat: complete public payment and refund experience"
```

---

### Task 11: Document configuration, operations, privacy, and rollback

**Files:**
- Create: `docs/public-live-payments.md`
- Create: `docs/operations/public-live-payments-runbook.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `SECURITY.md`
- Modify: `STATUS.md`

- [x] **Step 1: Write the public integration guide**

Document:

- fictional/no-service disclosure;
- exact CA$1 Zaprite contribution and exact 1,000-sat signet flow;
- simulated no-reward path;
- receipt and reward sequence;
- 14-day PII/message retention;
- refund-request procedure;
- all public environment variable names with non-secret example values only.

- [x] **Step 2: Write the operator runbook**

Include exact commands for:

- dependency and full quality gates;
- Cloudflare dry-run build;
- container image build and vulnerability scan;
- creating a wallet through the operator-only control command;
- verifying encrypted R2 backup and forced restore;
- funding only the capped signet budget;
- checking heartbeats and balances;
- disabling each rail through its independent runtime flag;
- reconciling Zaprite, Wavelength, rewards, OTS, mail, and refunds;
- rotating each scoped secret;
- rollback without deleting authoritative records.

Mark every credential/resource/deploy command with `REQUIRES FRESH OPERATOR APPROVAL`.

- [x] **Step 3: Record binding decisions**

Update `CLAUDE.md` and `STATUS.md` with:

- Zaprite webhook/redirect are nudges only;
- Wavelength settlement requires completed matching merchant activity;
- OTS submission and Bitcoin anchoring are separate;
- live reward default budget is zero;
- container restore failure fails closed;
- real-payment rows are never touched by reset;
- Unrelated resources remain out of scope.

- [x] **Step 4: Scan documentation for private material**

Run:

```powershell
rg -n -i "(seed phrase|recovery words|private key|api[_ -]?key|bearer [a-z0-9]|payment hash|smtp password|C:\\Users|D:\\Users)" README.md CLAUDE.md SECURITY.md STATUS.md docs ops
```

Expected: no credential value, recovery material, payment hash, or local user path; documented variable names and explicit safety prose are reviewed manually.

- [x] **Step 5: Build docs and commit**

```powershell
npm run docs:build
git diff --check
git add README.md CLAUDE.md SECURITY.md STATUS.md docs/public-live-payments.md docs/operations/public-live-payments-runbook.md
git commit -m "docs: add public payment operations runbook"
```

Expected: docs build and whitespace check exit 0.

---

### Task 12: Run all gates, rehearse recovery, then request deployment approval

**Files:**
- Modify only if a verification failure reveals an in-scope defect.
- Update: `STATUS.md`

- [ ] **Step 1: Run all automated gates**

```powershell
npm test
npm run typecheck
npm run build
npm run docs:build
npm audit --omit=dev --audit-level=high
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
npm --prefix cli audit --omit=dev --audit-level=high
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npm --prefix ops/cloudflare run build
git diff --check
```

Expected: every command exits 0; root retains at least 440 passing tests and CLI retains at least 69.

- [x] **Step 2: Scan built artifacts**

Run a secret/local-path/recovery scan against `dist`, `cli/dist`, and `ops/cloudflare/dist`, then inspect frontend assets to confirm staff modules are absent and Wavelength runtime assets are present.

Expected: no secret values, mnemonic words, wallet passwords, bridge tokens, provider keys, payment hashes, or local filesystem paths.

- [ ] **Step 3: Run local failure-injection acceptance**

With generated disposable test secrets and fixture wallets only:

1. simulate exact Zaprite paid, underpaid, overpaid, duplicate, forged, and late states;
2. complete one 1,000-sat signet booking and one reward;
3. stop the operations container after prepare but before report;
4. restore from the newest encrypted archive;
5. reconcile without a duplicate payment/reward;
6. corrupt a copied archive and confirm startup remains unavailable;
7. make heartbeat stale and confirm Zaprite/simulated remain usable;
8. age fixture PII to 15 days and confirm only nonessential data is purged.

Expected: every authority and fail-closed invariant matches the design.

- [x] **Step 4: Create a verified local checkpoint**

Update `STATUS.md` with exact gate counts, release commit, remaining development-only advisories, and confirmation that no credentials/resources/deployment were touched.

```powershell
git add STATUS.md
git commit -m "chore: checkpoint public payment release candidate"
git status --short
```

Expected: clean worktree.

- [ ] **Step 5: Stop for explicit external-action approval**

Ask the operator for one fresh approval covering only:

- opening/using the dedicated Murdawk Media Cloudflare and OpenStays credential pointers;
- creating the dedicated R2 bucket, Worker, Durable Object/container, Turnstile widget, and scoped secrets;
- creating/configuring the dedicated production OpenStays Zaprite checkout;
- configuring only `murdawkmedia/openstays-consensus`;
- pushing the reviewed branch and deploying the release candidate.

Do not proceed on a general earlier approval.

- [ ] **Step 6: Configure with all flags disabled**

After approval, configure secrets through provider CLIs/UI without printing values. Set:

```text
PUBLIC_LIVE_PAYMENTS=true
ZAPRITE_ENABLED=false
WAVELENGTH_ENABLED=false
WAVELENGTH_REWARDS_ENABLED=false
WAVELENGTH_REWARD_DAILY_BUDGET_SATS=0
```

Deploy backend, Worker/container, and Pages while public live actions remain disabled.

- [ ] **Step 7: Bootstrap and rehearse merchant recovery**

Create one merchant signet wallet through the operator-only path, store recovery material offline, fund only the approved capped amount, force an encrypted backup, replace the container, restore, verify digest/balance/activity, and complete one additional fixture payment without duplication.

Expected: latest archive restores before daemon start, prior activity reconciles, and no replacement wallet is created.

- [ ] **Step 8: Run live acceptance**

Using dedicated resources:

1. complete one production CA$1 Zaprite contribution;
2. reconcile authoritative exact order data;
3. confirm fictional booking and submit OTS proof;
4. claim one exact 1,000-sat reward;
5. request and manually resolve the refund with external reference;
6. complete one exact 1,000-sat Wavelength booking;
7. submit OTS proof and pay exactly one reward;
8. verify email delivery, desktop/mobile layouts, keyboard use, scoped COOP/COEP, health fallback, and no console errors.

Expected: all authoritative state transitions occur once and only once.

- [ ] **Step 9: Enable both rails together**

Only after Step 8 passes, set:

```text
ZAPRITE_ENABLED=true
WAVELENGTH_ENABLED=true
WAVELENGTH_REWARDS_ENABLED=true
WAVELENGTH_REWARD_DAILY_BUDGET_SATS=12000
```

Re-run public health and one nonpaying simulated smoke test. Record deployment IDs and redacted health in `STATUS.md`; never record secrets, payment hashes, wallet recovery data, or raw IPs.

- [ ] **Step 10: Push only after final verification**

```powershell
git status --short
git log -1 --oneline
git push -u origin codex/public-live-payment-rails
```

Expected: clean worktree and successful push of only the reviewed branch. Merging to `main` remains a separate explicit decision after public observation.
