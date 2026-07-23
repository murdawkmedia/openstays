# OpenTimestamps Inspector and BOLT11 QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inspectable privacy-safe Consensus Receipt and a standard scannable QR presentation for every visible Signet BOLT11 invoice.

**Architecture:** A pure receipt parser validates the immutable canonical JSON into a narrow display model. A receipt inspector composes that model with the existing downloads and authoritative attestation state, while a shared `Bolt11Invoice` uses `qrcode.react` to render exact invoice strings locally as responsive SVG. Existing Convex schemas and bridge protocols remain unchanged.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, `qrcode.react` 4.2.0, Tailwind CSS.

---

## File structure

- Create `src/lib/consensusReceiptView.ts`: fail-closed parser and block URL helper.
- Create `tests/consensusReceiptView.test.ts`: canonical-field and malformed-input coverage.
- Create `src/components/ConsensusReceiptInspector.tsx`: readable fields, raw JSON disclosure, verifier/block links.
- Modify `src/components/ConsensusReceiptSummary.tsx`: compose the inspector into the existing card.
- Modify `tests/consensusReceiptSummary.test.ts`: submitted/anchored presentation regressions.
- Create `src/components/Bolt11Invoice.tsx`: QR, amount, expiry, full invoice, and copy state.
- Create `tests/bolt11Invoice.test.tsx`: exact payload and fallback presentation coverage.
- Modify `src/pages/WavelengthWalletPage.tsx`: render booking and preflight invoices.
- Modify `src/pages/ConsensusRewardPage.tsx`: render a pending reward invoice from authoritative query state.
- Modify `tests/demoUXCopy.test.ts`: prove all three invoice surfaces adopt the shared component.
- Modify `package.json` and `package-lock.json`: pin `qrcode.react` 4.2.0.
- Modify `docs/hackathon-mvp.md` and `STATUS.md`: verification and QR demo instructions.

### Task 1: Canonical receipt display model

**Files:**
- Create: `src/lib/consensusReceiptView.ts`
- Create: `tests/consensusReceiptView.test.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  bitcoinBlockUrl,
  parseConsensusReceiptView,
} from '../src/lib/consensusReceiptView';

const canonical = JSON.stringify({
  bookingCommitment: 'opaque-booking',
  consensus: {
    bookingStatus: 'confirmed',
    channelEventsDigest: 'channel-digest',
    notificationEventsDigest: 'notification-digest',
    paymentEventsDigest: 'payment-digest',
    statusHistoryDigest: 'status-digest',
  },
  createdAt: 1_753_286_400_000,
  economic: {
    amountCents: 19,
    currency: 'CAD',
    paymentProvider: 'wavelength',
    paymentStatus: 'paid',
  },
  property: { name: 'Consensus Commons', slug: 'consensus-commons' },
  schema: 'openstays.consensus-receipt.v1',
});

describe('consensus receipt view', () => {
  it('returns only the v1 privacy-safe display fields', () => {
    expect(parseConsensusReceiptView(canonical)).toEqual({
      schema: 'openstays.consensus-receipt.v1',
      bookingCommitment: 'opaque-booking',
      propertyName: 'Consensus Commons',
      propertySlug: 'consensus-commons',
      amountCents: 19,
      currency: 'CAD',
      paymentProvider: 'wavelength',
      paymentStatus: 'paid',
      bookingStatus: 'confirmed',
      statusHistoryDigest: 'status-digest',
      paymentEventsDigest: 'payment-digest',
      notificationEventsDigest: 'notification-digest',
      channelEventsDigest: 'channel-digest',
      createdAt: 1_753_286_400_000,
      formattedJson: JSON.stringify(JSON.parse(canonical), null, 2),
    });
  });

  it.each(['', '{', '[]', '{"schema":"other"}'])('fails closed for %s', (input) => {
    expect(parseConsensusReceiptView(input)).toBeNull();
  });

  it('creates a mainnet block-height link only for a positive integer', () => {
    expect(bitcoinBlockUrl(959_201)).toBe('https://mempool.space/block-height/959201');
    expect(bitcoinBlockUrl(undefined)).toBeNull();
    expect(bitcoinBlockUrl(-1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/consensusReceiptView.test.ts`

Expected: FAIL because `src/lib/consensusReceiptView.ts` does not exist.

- [ ] **Step 3: Implement the narrow parser**

Define `ConsensusReceiptView` with exactly the fields asserted above. Parse with
`JSON.parse`, require plain objects, exact schema, string fields, a
non-negative safe integer `amountCents`, and a finite numeric `createdAt`.
Return `null` for every mismatch. Derive `formattedJson` using
`JSON.stringify(parsed, null, 2)`. Implement `bitcoinBlockUrl` only for positive
safe integers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/consensusReceiptView.test.ts`

Expected: parser and block-link tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/consensusReceiptView.ts tests/consensusReceiptView.test.ts
git commit -m "test: define consensus receipt inspector model"
```

### Task 2: Receipt inspector UI

**Files:**
- Create: `src/components/ConsensusReceiptInspector.tsx`
- Modify: `src/components/ConsensusReceiptSummary.tsx`
- Modify: `tests/consensusReceiptSummary.test.ts`

- [ ] **Step 1: Write failing submitted and anchored tests**

Render `ConsensusReceiptSummary` with a valid `canonicalJson`. Assert the
submitted result includes:

```text
Receipt contents
Consensus Commons
CA$0.19
wavelength
View canonical receipt
Verify at OpenTimestamps.org
Upload the receipt JSON and matching .ots proof
```

Assert its verifier link is exactly `https://opentimestamps.org/`, uses a new
tab with `rel="noreferrer"`, and contains no mempool link.

Render an anchored receipt with `bitcoinBlockHeight: 959201`. Assert it links
to `https://mempool.space/block-height/959201`. Render malformed canonical JSON
and assert `Receipt preview unavailable` while existing downloads remain.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/consensusReceiptSummary.test.ts`

Expected: FAIL because the inspector content and links are absent.

- [ ] **Step 3: Implement `ConsensusReceiptInspector`**

Accept:

```ts
type Props = {
  canonicalJson: string;
  bitcoinBlockHeight?: number;
};
```

Use `parseConsensusReceiptView`. On success, render semantic `<dl>` groups for
property, economic state, booking state, creation time, opaque commitment, and
four event digests. Render a native `<details>` containing
`<pre>{view.formattedJson}</pre>`. Always render the official verifier link and
upload instructions. Render the mempool block link only when
`bitcoinBlockUrl` returns a URL. On parse failure, render the honest
preview-unavailable message plus the verifier instructions.

- [ ] **Step 4: Compose it into `ConsensusReceiptSummary`**

Extend the `Receipt` type with `canonicalJson: string`, `schemaVersion: string`,
and optional `bitcoinBlockTime`. Render the inspector after receipt metadata
and before download actions. Preserve existing status and reward copy.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm test -- tests/consensusReceiptView.test.ts tests/consensusReceiptSummary.test.ts
npm run typecheck
```

Expected: both suites and TypeScript pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/ConsensusReceiptInspector.tsx src/components/ConsensusReceiptSummary.tsx tests/consensusReceiptSummary.test.ts
git commit -m "feat: add consensus receipt inspector"
```

### Task 3: Shared BOLT11 invoice component

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/Bolt11Invoice.tsx`
- Create: `tests/bolt11Invoice.test.tsx`

- [ ] **Step 1: Install the pinned zero-dependency QR renderer**

Run: `npm install qrcode.react@4.2.0`

Expected: package and lockfile contain exact compatible dependency
`qrcode.react` 4.2.0.

- [ ] **Step 2: Write the failing component test**

Render:

```tsx
<Bolt11Invoice
  invoice="lntbs10u1exactinvoice"
  amountSats={1_000}
  expiresAt={1_900_000_000_000}
  label="Booking invoice"
/>
```

Assert the markup contains an SVG titled `Booking invoice QR for 1,000 Signet
test sats`, the exact invoice, `1,000 sats`, `Signet test sats`, `Copy BOLT11`,
`Show full invoice`, and an expiry `<time>`.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm test -- tests/bolt11Invoice.test.tsx`

Expected: FAIL because `Bolt11Invoice` does not exist.

- [ ] **Step 4: Implement the component**

Use:

```tsx
<QRCodeSVG
  value={invoice}
  size={220}
  level="M"
  marginSize={4}
  title={`${label} QR for ${amountSats.toLocaleString('en-CA')} Signet test sats`}
  className="h-auto w-full max-w-[220px]"
/>
```

Render the amount/network badge, optional `<time dateTime={...}>`, abbreviated
invoice, native `<details>` with the full breakable value, and a copy button.
Copy with `navigator.clipboard.writeText(invoice)`; report `BOLT11 copied` or
`Copy failed — select the full invoice below` through `aria-live="polite"`.
The exact text remains selectable regardless of QR/copy state.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm test -- tests/bolt11Invoice.test.tsx
npm run typecheck
```

Expected: component tests and TypeScript pass.

- [ ] **Step 6: Commit**

```powershell
git add -- package.json package-lock.json src/components/Bolt11Invoice.tsx tests/bolt11Invoice.test.tsx
git commit -m "feat: add reusable BOLT11 QR"
```

### Task 4: Adopt QR presentation on every invoice surface

**Files:**
- Modify: `src/pages/WavelengthWalletPage.tsx`
- Modify: `src/pages/ConsensusRewardPage.tsx`
- Modify: `tests/demoUXCopy.test.ts`

- [ ] **Step 1: Write the failing adoption regression**

Assert:

- both page sources import `Bolt11Invoice`;
- `WavelengthWalletPage.tsx` renders it once for `request.bolt11` with
  `request.satsAmount` and once for `demoFundingInvoice` with
  `DEMO_WALLET_TARGET_SATS`;
- `ConsensusRewardPage.tsx` renders `reward.bolt11` with
  `CONSENSUS_REWARD_SATS`;
- all instances use Signet-specific labels.

- [ ] **Step 2: Run the regression and verify RED**

Run: `npm test -- tests/demoUXCopy.test.ts`

Expected: FAIL because no page imports the shared invoice component.

- [ ] **Step 3: Render booking and preflight QRs**

Import `Bolt11Invoice` in `WavelengthWalletPage.tsx`.

Inside the merchant-invoice card, when `request.bolt11` exists, render:

```tsx
<Bolt11Invoice
  invoice={request.bolt11}
  amountSats={request.satsAmount}
  expiresAt={request.expiresAt}
  label="Booking invoice"
/>
```

Replace the raw preflight invoice paragraph with:

```tsx
<Bolt11Invoice
  invoice={demoFundingInvoice}
  amountSats={DEMO_WALLET_TARGET_SATS}
  label="Demo wallet funding invoice"
/>
```

Keep the one-shot funding state and payment controls unchanged.

- [ ] **Step 4: Render the pending reward QR**

Import `Bolt11Invoice` in `ConsensusRewardPage.tsx`. When
`reward.bolt11` exists and status is `invoice_ready` or `paying`, render it
using `reward.invoiceExpiresAt`, `CONSENSUS_REWARD_SATS`, and label
`Consensus reward invoice`. The query row remains authoritative across reloads.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm test -- tests/bolt11Invoice.test.tsx tests/demoUXCopy.test.ts
npm run typecheck
```

Expected: tests and TypeScript pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/pages/WavelengthWalletPage.tsx src/pages/ConsensusRewardPage.tsx tests/demoUXCopy.test.ts
git commit -m "feat: show QR for every BOLT11 invoice"
```

### Task 5: Documentation and full gates

**Files:**
- Modify: `docs/hackathon-mvp.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Document the judge flow**

State that every visible BOLT11 is directly scannable and copyable, the QR
contains the exact invoice, and all payment rails remain Signet. Document the
receipt preview, official verifier upload workflow, and anchored block link.

- [ ] **Step 2: Record the implementation checkpoint**

Update `STATUS.md` with the component/test results. Do not record invoice
strings, wallet secrets, bridge tokens, or payment hashes.

- [ ] **Step 3: Run all gates**

```powershell
npm test
npm run typecheck
npm run build
npm run docs:build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: all tests, typechecks, and builds pass.

- [ ] **Step 4: Commit**

```powershell
git add -- docs/hackathon-mvp.md STATUS.md
git commit -m "docs: explain receipt verification and invoice QR"
```

### Task 6: Local browser acceptance

**Files:** No source changes expected unless a blocker is found.

- [ ] **Step 1: Rebuild and reload the production preview**

Run `npm run build`, then reload the existing `http://localhost:4173` demo tab.
Unlock the funded wallet without exposing its password or recovery words.

- [ ] **Step 2: Verify the preflight invoice**

Create no replacement funding invoice. Use a fresh non-payment test fixture or
component route to confirm QR rendering where needed; preserve the funded
12,000-sat wallet and never send another merchant payment.

- [ ] **Step 3: Verify a guest receipt**

Open an authenticated anchored booking. Confirm readable safe fields,
expandable JSON, JSON/`.ots` downloads, official verifier link, exact block
link, keyboard access, and no leaked guest/date/unit/message/invoice data.

- [ ] **Step 4: Verify responsive layouts**

At desktop and 390px, confirm SVG QR readability, long-value wrapping,
`scrollWidth <= innerWidth`, and no warning/error console logs. Remove the
viewport override afterward.

- [ ] **Step 5: Final local checkpoint**

Run `git diff --check`, confirm a clean worktree, and keep the funded demo tab
open. Do not push, deploy, or merge without a new instruction.
