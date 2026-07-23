# 1,000-Sat Consensus Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenStays' 210-sat reward with one permanent, exact 1,000-sat Wavelength signet reward while safely upgrading the existing unpaid demo row.

**Architecture:** A shared Convex reward policy owns the active 1,000-sat invariant while retaining schema readability for legacy 210-sat rows. Convex validates the guest-declared amount and settlement, the local bridge independently validates Wavelength's prepared payment and completed activity, and the browser requests a 1,000-sat amount-bearing invoice. An idempotent internal maintenance mutation upgrades only inactive unpaid legacy rewards.

**Tech Stack:** TypeScript, React 19, Convex, Vitest, Wavelength Web/React SDK v0.1.0, Wavelength daemon REST bridge, Vite/VitePress.

---

## File map

- Create `convex/rewardPolicy.ts`: active and legacy amount constants plus the compatibility validator.
- Modify `convex/schema.ts`: accept readable legacy 210 rows and active 1,000 rows.
- Modify `convex/consensusReceipts.ts`: create only 1,000-sat rewards.
- Modify `convex/wavelengthRewards.ts`: validate 1,000 sats and expose the guarded migration.
- Modify `convex/wavelengthRewards.test.ts`: policy, authorization, boundary, migration, and replay coverage.
- Create `src/lib/consensusReward.ts`: browser-facing 1,000-sat display/request constant.
- Modify `src/pages/ConsensusRewardPage.tsx`: request and display 1,000 sats and declare the amount during submission.
- Modify `src/components/ConsensusReceiptSummary.tsx`, `src/pages/AdminOperationsPage.tsx`: update guest/staff copy.
- Create `src/lib/consensusReward.test.ts`: lock the browser amount and display label.
- Modify `convex/consensus.ts`, `convex/consensus.test.ts`: update timeline copy.
- Modify `convex/emailTemplates.ts`, `convex/refundEmailTemplates.test.ts`: update receipt email copy.
- Modify `cli/src/waveBridge.ts`, `cli/src/waveBridge.test.ts`: validate exactly 1,000 sats at every merchant boundary while preserving the independent 210-sat fee ceiling.
- Modify `README.md`, `CLAUDE.md`, `docs/hackathon-mvp.md`, `docs/roadmap.md`, `STATUS.md`: update the permanent reward and live-acceptance instructions.

### Task 1: Establish the Convex reward policy

**Files:**
- Create: `convex/rewardPolicy.ts`
- Modify: `convex/schema.ts`
- Test: `convex/wavelengthRewards.test.ts`

- [ ] **Step 1: Write the failing policy/schema test**

Add assertions that a test database accepts both a legacy 210 row and an active 1,000 row, and that the exported active policy is 1,000:

```ts
import { CONSENSUS_REWARD_SATS, LEGACY_CONSENSUS_REWARD_SATS } from './rewardPolicy';

expect(CONSENSUS_REWARD_SATS).toBe(1_000);
expect(LEGACY_CONSENSUS_REWARD_SATS).toBe(210);
```

Insert otherwise-valid `wavelengthRewards` fixtures with both amounts. Do not change booking-price fixtures whose `2100` values mean CAD minor units.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run convex/wavelengthRewards.test.ts`

Expected: FAIL because `rewardPolicy.ts` does not exist and the current schema only accepts literal 210.

- [ ] **Step 3: Add the policy and compatibility validator**

Create `convex/rewardPolicy.ts`:

```ts
import { v } from 'convex/values';

export const LEGACY_CONSENSUS_REWARD_SATS = 210 as const;
export const CONSENSUS_REWARD_SATS = 1_000 as const;

export const consensusRewardSats = v.union(
  v.literal(LEGACY_CONSENSUS_REWARD_SATS),
  v.literal(CONSENSUS_REWARD_SATS),
);
```

In `convex/schema.ts`, import `consensusRewardSats` and replace `satsAmount: v.literal(210)` with:

```ts
satsAmount: consensusRewardSats,
```

The union is deliberate compatibility, not dual active support: application code created in later tasks only emits 1,000.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npx vitest run convex/wavelengthRewards.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the policy boundary**

```powershell
git add -- convex/rewardPolicy.ts convex/schema.ts convex/wavelengthRewards.test.ts
git commit -m "define 1000 sat reward policy"
```

### Task 2: Create, claim, and migrate exact 1,000-sat rewards

**Files:**
- Modify: `convex/consensusReceipts.ts`
- Modify: `convex/wavelengthRewards.ts`
- Test: `convex/wavelengthRewards.test.ts`

- [ ] **Step 1: Write failing creation and amount-boundary tests**

Change the submitted-receipt expectation to `satsAmount: 1_000`. Add guest submission cases that pass a new declared `satsAmount` argument:

```ts
await expect(submit({ satsAmount: 999 })).rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
await expect(submit({ satsAmount: 1_001 })).rejects.toThrow('INVALID_SIGNET_REWARD_INVOICE');
await expect(submit({ satsAmount: 1_000 })).resolves.toMatchObject({
  satsAmount: 1_000,
  status: 'invoice_ready',
});
```

Update settlement tests so `markPaid` rejects 999 and 1,001 and accepts 1,000.

- [ ] **Step 2: Write failing migration safety tests**

Seed six 210-sat rows with statuses `eligible`, `expired`, `failed`, `invoice_ready`, `paying`, and `paid`. Invoke `upgradeLegacyRewards({ limit: 25 })` and assert:

```ts
expect(result).toEqual({ scanned: 6, upgraded: 3 });
expect(eligible).toMatchObject({ satsAmount: 1_000, status: 'eligible', attemptCount: 0 });
expect(expired).toMatchObject({ satsAmount: 1_000, status: 'eligible', attemptCount: 0 });
expect(failed).toMatchObject({ satsAmount: 1_000, status: 'eligible', attemptCount: 0 });
expect(invoiceReady.satsAmount).toBe(210);
expect(paying.satsAmount).toBe(210);
expect(paid.satsAmount).toBe(210);
```

Also assert the upgraded rows clear `bolt11`, invoice expiry, merchant activity, payment hash, lease, failure reason, and `paidAt`. Invoke the mutation twice and assert the second result upgrades zero rows.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `npx vitest run convex/wavelengthRewards.test.ts`

Expected: FAIL because reward creation remains 210, `submitInvoice` has no amount argument, and the migration does not exist.

- [ ] **Step 4: Implement the active invariant**

Import `CONSENSUS_REWARD_SATS` in `convex/consensusReceipts.ts` and `convex/wavelengthRewards.ts`. Create rewards with:

```ts
network: 'signet',
satsAmount: CONSENSUS_REWARD_SATS,
status: 'eligible',
```

Extend `submitInvoice.args` with:

```ts
satsAmount: v.number(),
```

Include this early rejection with the existing BOLT11/expiry checks:

```ts
args.satsAmount !== CONSENSUS_REWARD_SATS ||
reward.satsAmount !== CONSENSUS_REWARD_SATS
```

Replace the local `REWARD_SATS = 210` and every claim/settlement comparison with `CONSENSUS_REWARD_SATS`.

- [ ] **Step 5: Implement the guarded internal migration**

Add `upgradeLegacyRewards = internalMutation({ args: { limit: v.number() }, ... })`. Clamp `limit` to 1–100, query reward rows, and upgrade only rows satisfying all of:

```ts
reward.satsAmount === LEGACY_CONSENSUS_REWARD_SATS &&
['eligible', 'expired', 'failed'].includes(reward.status) &&
reward.merchantActivityId === undefined &&
reward.paymentHash === undefined &&
reward.paidAt === undefined
```

Patch eligible rows to:

```ts
{
  satsAmount: CONSENSUS_REWARD_SATS,
  status: 'eligible',
  attemptCount: 0,
  bolt11: undefined,
  invoiceExpiresAt: undefined,
  merchantActivityId: undefined,
  paymentHash: undefined,
  leaseToken: undefined,
  leaseExpiresAt: undefined,
  failureReason: undefined,
  paidAt: undefined,
  updatedAt: now,
}
```

Return `{ scanned, upgraded }`; never change `createdAt`.

- [ ] **Step 6: Run focused tests and Convex type generation**

Run: `npx vitest run convex/wavelengthRewards.test.ts convex/consensusReceipts.test.ts && npx convex codegen && npm run typecheck`

Expected: PASS; generated Convex types are current.

- [ ] **Step 7: Commit the server invariant and migration**

```powershell
git add -- convex/rewardPolicy.ts convex/consensusReceipts.ts convex/wavelengthRewards.ts convex/wavelengthRewards.test.ts convex/_generated
git commit -m "upgrade consensus rewards to 1000 sats"
```

### Task 3: Enforce 1,000 sats in the merchant bridge

**Files:**
- Modify: `cli/src/waveBridge.ts`
- Test: `cli/src/waveBridge.test.ts`

- [ ] **Step 1: Rewrite the happy-path fixture and add boundary failures**

Rename the reward test to `prepares, validates, sends, and reconciles an exact 1000-sat signet reward`. Use a 1,000-sat invoice fixture and expect:

```ts
amount_sat: '1000',
expected_total_outflow_sat: '1001',
actual_amount_sat: '1000',
satsAmount: 1_000,
```

Add table cases for `999` and `1_001` pending rewards. Assert neither calls `/v1/wallet/prepare-send`, both report failure, and neither reports `/rewards/paid`.

Add a transient-daemon case returning HTTP 503 from `prepare-send`; expect `/rewards/failed` to receive `retryable: true`. Keep quote, network, amount, rail, expiry, and completed-activity mismatches non-retryable.

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `npm --prefix cli test -- --run src/waveBridge.test.ts`

Expected: FAIL against hard-coded 210-sat principal checks.

- [ ] **Step 3: Replace principal checks without changing the fee default**

Add near the top of `cli/src/waveBridge.ts`:

```ts
const CONSENSUS_REWARD_SATS = 1_000;
const DEFAULT_REWARD_MAX_FEE_SATS = 210;
```

Use `CONSENSUS_REWARD_SATS` for pending reward validation, prepared amount, maximum total outflow calculation, sent amount, completed activity, and paid report. Continue using:

```ts
const maxFee = config.maxRewardFeeSats ?? DEFAULT_REWARD_MAX_FEE_SATS;
```

Make `jsonRequest` throw a small typed HTTP error carrying `status`. Add:

```ts
function isRetryableRewardError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof BridgeHttpError && error.status >= 500);
}
```

Pass `retryable: isRetryableRewardError(error)` to `/rewards/failed`. Amount, quote, network, expiry, and reconciliation mismatches remain false.

- [ ] **Step 4: Run CLI tests, typecheck, and build**

Run: `npm --prefix cli test -- --run src/waveBridge.test.ts && npm --prefix cli run typecheck && npm --prefix cli run build`

Expected: PASS.

- [ ] **Step 5: Commit the bridge enforcement**

```powershell
git add -- cli/src/waveBridge.ts cli/src/waveBridge.test.ts
git commit -m "enforce 1000 sat reward payouts"
```

### Task 4: Update the guest and staff experience

**Files:**
- Create: `src/lib/consensusReward.ts`
- Create: `src/lib/consensusReward.test.ts`
- Modify: `src/pages/ConsensusRewardPage.tsx`
- Modify: `src/components/ConsensusReceiptSummary.tsx`
- Modify: `src/pages/AdminOperationsPage.tsx`
- Modify: `convex/consensus.ts`
- Modify: `convex/consensus.test.ts`
- Modify: `convex/emailTemplates.ts`
- Modify: `convex/refundEmailTemplates.test.ts`

- [ ] **Step 1: Write the failing browser policy test**

Create `src/lib/consensusReward.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONSENSUS_REWARD_LABEL, CONSENSUS_REWARD_SATS } from './consensusReward';

describe('consensus reward presentation', () => {
  it('uses the permanent Wavelength minimum reward', () => {
    expect(CONSENSUS_REWARD_SATS).toBe(1_000);
    expect(CONSENSUS_REWARD_LABEL).toBe('1,000 signet sats');
  });
});
```

Update timeline and email tests to expect `1,000 signet sats`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npx vitest run src/lib/consensusReward.test.ts convex/consensus.test.ts convex/refundEmailTemplates.test.ts`

Expected: FAIL because the browser policy module does not exist and copy remains 210.

- [ ] **Step 3: Add the browser policy and wire the claim**

Create `src/lib/consensusReward.ts`:

```ts
export const CONSENSUS_REWARD_SATS = 1_000 as const;
export const CONSENSUS_REWARD_LABEL = '1,000 signet sats';
```

In `ConsensusRewardPage.tsx`, call:

```ts
const result = await receive.receive({
  amountSat: CONSENSUS_REWARD_SATS,
  memo: `OpenStays consensus reward ${receipt.publicId}`,
});
await submitInvoice({
  confirmationCode: code,
  email,
  satsAmount: CONSENSUS_REWARD_SATS,
  bolt11: result.invoice,
  expiresAt: Date.now() + 10 * 60_000,
});
```

Use `CONSENSUS_REWARD_LABEL` in the heading and button. Update summary, staff, timeline, and receipt-email text to 1,000. Display `reward.satsAmount.toLocaleString()` where record data is already available rather than duplicating a number.

- [ ] **Step 4: Run focused tests, typecheck, and build**

Run: `npx vitest run src/lib/consensusReward.test.ts convex/consensus.test.ts convex/refundEmailTemplates.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit the experience update**

```powershell
git add -- src/lib/consensusReward.ts src/lib/consensusReward.test.ts src/pages/ConsensusRewardPage.tsx src/components/ConsensusReceiptSummary.tsx src/pages/AdminOperationsPage.tsx convex/consensus.ts convex/consensus.test.ts convex/emailTemplates.ts convex/refundEmailTemplates.test.ts
git commit -m "present the 1000 sat consensus reward"
```

### Task 5: Update documentation and eliminate stale active claims

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/hackathon-mvp.md`
- Modify: `docs/roadmap.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Update active documentation**

Replace active reward descriptions with exactly 1,000 signet sats. In `docs/hackathon-mvp.md`, explain that 1,000 matches the public signet operator's `min_vtxo_amount_sat`, while the independent fee ceiling still defaults to 210. Update the three-minute pitch step to **Claim 1,000 signet sats**.

In `STATUS.md`, retain historical facts about completed 210-sat diagnostics where they describe actual past activity, but change the active decision and remaining acceptance to the permanent 1,000-sat reward. Record that the 210-sat `CreateCredit` failure was isolated by a successful 1,000-sat control.

- [ ] **Step 2: Scan for stale reward claims**

Run:

```powershell
rg -n "210-sat|210 signet|Claim 210|exact-210" README.md CLAUDE.md STATUS.md docs src convex cli
```

Expected: matches only historical/superseded design documents, the fee ceiling, unrelated CAD/test fixtures, and explicitly labeled historical diagnostics. No active reward UI, runtime invariant, email, pitch, or roadmap claim remains at 210.

- [ ] **Step 3: Build documentation**

Run: `npm run docs:build`

Expected: PASS.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- README.md CLAUDE.md docs/hackathon-mvp.md docs/roadmap.md STATUS.md
git commit -m "document the 1000 sat reward flow"
```

### Task 6: Run full local gates and browser acceptance

**Files:**
- Modify only if a failing test reveals a defect in an already listed task file.

- [ ] **Step 1: Run all automated gates**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run docs:build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: all tests and builds pass; the existing non-fatal Node timeout warning may still appear.

- [ ] **Step 2: Run browser smoke**

Run: `npm run test:e2e:smoke`

Expected: public desktop/mobile cases pass with no horizontal overflow. Live Wavelength cases may skip unless their explicit local environment inputs are present.

- [ ] **Step 3: Inspect the post-kickoff evidence**

Run:

```powershell
git diff --check
git status --short
git diff --stat btcpp-toronto-2026-pre-kickoff..HEAD
```

Expected: no whitespace errors, no unrelated files, and only the disclosed hackathon changes after the baseline tag.

- [ ] **Step 4: Commit any test-only correction**

If verification required a correction, stage only its exact files and create one focused local commit. If no correction was needed, do not create an empty commit.

### Task 7: Upgrade the isolated demo and run live reward acceptance

**Files:**
- No repository file changes expected.

- [ ] **Step 1: Obtain the external-action gate**

Before deploying functions or invoking the maintenance mutation, obtain Murphy's fresh approval to update only the isolated Convex development deployment `affable-wildcat-206`. Do not touch CBAP, production, credentials, push, merge, or main.

- [ ] **Step 2: Deploy the verified branch to isolated development**

Run the existing isolated-development Convex command from the already configured worktree. Confirm the output names `affable-wildcat-206` before allowing it to complete.

Expected: schema accepts legacy 210 rows and active 1,000 rows; functions deploy successfully.

- [ ] **Step 3: Run and verify the idempotent migration**

Invoke `wavelengthRewards:upgradeLegacyRewards` with `{"limit":25}` through the approved Convex CLI path. Run it twice.

Expected first result for the current demo: one eligible legacy row upgraded. Expected second result: `upgraded: 0`. Query the authenticated guest view and confirm the reward is `eligible`, signet, exactly 1,000 sats, with no invoice or merchant settlement fields.

- [ ] **Step 4: Complete the live browser reward**

Open booking `OS-A52VVM`, unlock the persistent browser guest wallet without reading or printing recovery material, and tap **Claim 1,000 signet sats**. Confirm invoice creation returns promptly through Wavelength's standard receive path.

Keep the browser wallet open while the merchant bridge:

1. prepares exactly 1,000 sats with total fee no greater than 210;
2. sends the single-use intent;
3. observes a completed outgoing activity matching invoice, hash, and amount; and
4. reports the authoritative paid result.

Expected: guest and staff views show paid exactly once; merchant principal decreases by 1,000 plus the authoritative fee; the guest balance increases by 1,000; no 210-sat `CreateCredit` call is used.

- [ ] **Step 5: Record final evidence locally**

Update `STATUS.md` with the authoritative activity identifiers in sanitized form, final gate counts, and honest live result. Never record seeds, passwords, bridge tokens, payment preimages, or credential values. Commit only `STATUS.md` after `git diff --check`.

```powershell
git add -- STATUS.md
git commit -m "record 1000 sat reward acceptance"
```

Stop after local commits and isolated-development acceptance. Push, merge, and production deployment remain out of scope.
