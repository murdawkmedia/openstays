# OpenStays Cloudflare Pages Public Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a safe, fictional, resettable Consensus Commons showcase at `https://openstays-consensus.pages.dev` using a new Murdawk Media Convex demo deployment.

**Architecture:** A build-time `VITE_PUBLIC_SHOWCASE` policy switches the root route to a static, sanitized consensus tour, blocks public wallet/admin routes, and keeps the real fictional booking flow available with simulated payments. A dedicated `DEMO_MODE=true` Convex deployment owns writable demo data and resets all hackathon tables nightly. Cloudflare Pages serves the verified Vite build with SPA fallback and cross-origin-isolation headers; no bridge or provider secrets are deployed.

**Tech Stack:** React 19, React Router, TypeScript, Vite, Convex, Vitest, Playwright, Cloudflare Pages/Wrangler

---

## File structure

- Create `src/lib/publicShowcase.ts`: pure build-policy parsing and rail availability.
- Create `src/pages/PublicShowcasePage.tsx`: static sanitized tour and booking CTA.
- Create `src/pages/PublicShowcaseBoundaryPage.tsx`: safe replacement for wallet/admin routes.
- Modify `src/main.tsx`: select public routes from the build policy.
- Modify `src/components/AppLayout.tsx`: render the showcase banner and hide Staff.
- Modify `src/pages/CheckoutPage.tsx`: suppress Wavelength when no bridge is operated.
- Create `tests/publicShowcase.test.ts`: pure policy and source-contract tests.
- Modify `convex/demo.ts`: clear every demo-domain table and re-seed both fictional properties.
- Modify `convex/apiKeys.test.ts`: verify nightly reset removes hackathon rows and restores Consensus Commons.
- Create `public/_redirects`: Cloudflare Pages SPA fallback.
- Create `tests/cloudflarePagesShowcase.test.ts`: header, redirect, and public-copy checks.
- Modify `.env.example`: document the non-secret showcase build flag.
- Modify `docs/self-hosting.md`: document Pages/Convex public-demo deployment.
- Modify `STATUS.md`: record the sanitized deployment boundary and verification.

### Task 1: Public showcase policy

**Files:**
- Create: `src/lib/publicShowcase.ts`
- Create: `tests/publicShowcase.test.ts`

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, it } from 'vitest';
import { publicShowcasePolicy } from '../src/lib/publicShowcase';

describe('publicShowcasePolicy', () => {
  it('fails closed when the flag is absent', () => {
    expect(publicShowcasePolicy(undefined)).toEqual({
      enabled: false,
      allowLiveWavelength: true,
      allowStaffRoutes: true,
    });
  });

  it('blocks live wallet and staff routes in the public build', () => {
    expect(publicShowcasePolicy('true')).toEqual({
      enabled: true,
      allowLiveWavelength: false,
      allowStaffRoutes: false,
    });
  });

  it('does not accept truthy misspellings', () => {
    expect(publicShowcasePolicy('TRUE').enabled).toBe(false);
    expect(publicShowcasePolicy('1').enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/publicShowcase.test.ts`  
Expected: FAIL because `src/lib/publicShowcase.ts` does not exist.

- [ ] **Step 3: Implement the pure policy**

```ts
export interface PublicShowcasePolicy {
  enabled: boolean;
  allowLiveWavelength: boolean;
  allowStaffRoutes: boolean;
}

export function publicShowcasePolicy(value: string | undefined): PublicShowcasePolicy {
  const enabled = value === 'true';
  return {
    enabled,
    allowLiveWavelength: !enabled,
    allowStaffRoutes: !enabled,
  };
}

export const PUBLIC_SHOWCASE = publicShowcasePolicy(
  import.meta.env.VITE_PUBLIC_SHOWCASE,
);
```

- [ ] **Step 4: Run the focused test**

Run: `npm test -- tests/publicShowcase.test.ts`  
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/publicShowcase.ts tests/publicShowcase.test.ts
git commit -m "feat: define public showcase safety policy"
```

### Task 2: Sanitized public tour

**Files:**
- Create: `src/pages/PublicShowcasePage.tsx`
- Create: `src/pages/PublicShowcaseBoundaryPage.tsx`
- Modify: `src/main.tsx`
- Modify: `src/components/AppLayout.tsx`
- Test: `tests/publicShowcase.test.ts`

- [ ] **Step 1: Add failing source-contract tests**

Append:

```ts
import fs from 'node:fs';

it('publishes the honest network and finality language', () => {
  const source = fs.readFileSync('src/pages/PublicShowcasePage.tsx', 'utf8');
  expect(source).toContain('signet test sats');
  expect(source).toContain('pending Bitcoin confirmation');
  expect(source).toContain('Bitcoin anchored');
  expect(source).toContain('fictional');
  expect(source).toContain('adapter ready, not connected');
});

it('blocks unavailable public wallet and staff surfaces', () => {
  const main = fs.readFileSync('src/main.tsx', 'utf8');
  expect(main).toContain('PublicShowcaseBoundaryPage');
  expect(main).toContain('PUBLIC_SHOWCASE.allowLiveWavelength');
  expect(main).toContain('PUBLIC_SHOWCASE.allowStaffRoutes');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/publicShowcase.test.ts`  
Expected: FAIL because the two pages and route guards do not exist.

- [ ] **Step 3: Build the static public tour**

Create `PublicShowcasePage.tsx` with:

```tsx
import { Link } from 'react-router-dom';

const stages = [
  ['Availability agreed', 'A serializable booking transaction reserves the nights without double-booking.'],
  ['Payment observed', 'The booking ledger trusts authoritative reconciliation, not a browser redirect.'],
  ['Consensus receipt', 'A canonical privacy-safe commitment excludes guest identity and stay details.'],
  ['Bitcoin proof', 'OpenTimestamps distinguishes submission, pending Bitcoin confirmation, and Bitcoin anchored.'],
  ['Guest reward', 'The locally tested Wavelength flow returns 1,000 signet test sats to a self-custodial wallet.'],
] as const;

export function PublicShowcasePage() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-stone-950 px-6 py-10 text-white sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
          Bitcoin++ Toronto · Public showcase
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold">Consensus Commons</h1>
        <p className="mt-4 max-w-2xl leading-7 text-stone-300">
          OpenStays gives the guest, property, payment rail, notifications, and
          booking channels one authoritative reservation state.
        </p>
        <p className="mt-4 text-sm text-stone-400">
          All inventory and examples are fictional. No production guest data or real funds are used.
        </p>
        <Link to="/p/consensus-commons" className="btn-primary mt-6 inline-flex">
          Explore the booking flow
        </Link>
      </section>
      <section aria-labelledby="consensus-stages">
        <h2 id="consensus-stages" className="text-2xl font-semibold">How consensus is reached</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2">
          {stages.map(([title, body], index) => (
            <li key={title} className="card p-5">
              <p className="text-xs font-semibold text-emerald-700">0{index + 1}</p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="card p-6">
        <h2 className="text-xl font-semibold">Experimental rails, honest boundaries</h2>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Wavelength is signet-only and the public showcase does not operate a wallet faucet.
          OpenTimestamps public calendars ultimately anchor into Bitcoin mainnet. Channex is
          adapter ready, not connected.
        </p>
      </section>
    </div>
  );
}
```

Create `PublicShowcaseBoundaryPage.tsx`:

```tsx
import { Link } from 'react-router-dom';

export function PublicShowcaseBoundaryPage() {
  return (
    <div className="card mx-auto max-w-xl p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
        Public showcase boundary
      </p>
      <h1 className="mt-3 text-2xl font-semibold">This live operation stays local</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        The wallet, staff console, bridges, and signet rewards were tested locally.
        This public site demonstrates their verified states without exposing operator
        credentials, wallet funds, or a public faucet.
      </p>
      <Link to="/" className="btn-primary mt-6 inline-flex">Return to the showcase</Link>
    </div>
  );
}
```

- [ ] **Step 4: Wire routes and shared chrome**

In `main.tsx`, import the policy/pages, render `PublicShowcasePage` at `/` when
enabled, and replace every `/wallet/*` and `/admin*` element with
`PublicShowcaseBoundaryPage` when its corresponding policy field is false.

In `AppLayout.tsx`, render a full-width banner containing
`Public showcase · fictional data · signet test sats` and omit the Staff link
when `PUBLIC_SHOWCASE.enabled` is true.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm test -- tests/publicShowcase.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```powershell
git add src/pages/PublicShowcasePage.tsx src/pages/PublicShowcaseBoundaryPage.tsx src/main.tsx src/components/AppLayout.tsx tests/publicShowcase.test.ts
git commit -m "feat: add sanitized public consensus tour"
```

### Task 3: Prevent public Wavelength actions

**Files:**
- Modify: `src/pages/CheckoutPage.tsx`
- Test: `tests/publicShowcase.test.ts`

- [ ] **Step 1: Add the failing checkout contract**

```ts
it('suppresses Wavelength checkout in showcase builds', () => {
  const checkout = fs.readFileSync('src/pages/CheckoutPage.tsx', 'utf8');
  expect(checkout).toContain('PUBLIC_SHOWCASE.allowLiveWavelength');
  expect(checkout).toContain('Live signet settlement is shown in the public tour');
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/publicShowcase.test.ts`  
Expected: FAIL because checkout ignores the showcase policy.

- [ ] **Step 3: Gate the Wavelength link**

Import `PUBLIC_SHOWCASE`. Change both Wavelength render conditions to:

```tsx
{wavelengthInfo?.available && PUBLIC_SHOWCASE.allowLiveWavelength && (
  // existing link or explanatory copy
)}
```

When `PUBLIC_SHOWCASE.enabled`, render:

```tsx
<p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
  Live signet settlement is shown in the public tour but is not operated as a
  public wallet faucet. Complete the simulated demo payment to explore the
  authoritative booking state.
</p>
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
npm test -- tests/publicShowcase.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/pages/CheckoutPage.tsx tests/publicShowcase.test.ts
git commit -m "fix: fail closed on public wallet actions"
```

### Task 4: Complete nightly demo reset

**Files:**
- Modify: `convex/demo.ts`
- Modify: `convex/apiKeys.test.ts`

- [ ] **Step 1: Add a failing reset regression**

Extend the existing reset test to insert rows in `refundCases`,
`bookingMessages`, `wavelengthRequests`, `consensusReceipts`,
`wavelengthRewards`, and `auditLog`, invoke `internal.demo.reset`, then assert:

```ts
expect(await t.run((ctx) => ctx.db.query('refundCases').collect())).toEqual([]);
expect(await t.run((ctx) => ctx.db.query('bookingMessages').collect())).toEqual([]);
expect(await t.run((ctx) => ctx.db.query('wavelengthRequests').collect())).toEqual([]);
expect(await t.run((ctx) => ctx.db.query('consensusReceipts').collect())).toEqual([]);
expect(await t.run((ctx) => ctx.db.query('wavelengthRewards').collect())).toEqual([]);
expect(await t.run((ctx) => ctx.db.query('auditLog').collect())).toEqual([]);
const commons = await t.run((ctx) =>
  ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', 'consensus-commons')).first(),
);
expect(commons?.name).toBe('Consensus Commons');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- convex/apiKeys.test.ts`  
Expected: FAIL because hackathon tables survive and Consensus Commons is not re-seeded.

- [ ] **Step 3: Expand reset and restore both fictional properties**

Import both seed functions:

```ts
import { seedConsensusCommons, seedPinewoodFlats } from './seed';
```

Add all six asserted tables to the deletion list, then call:

```ts
await seedPinewoodFlats(ctx);
await seedConsensusCommons(ctx);
```

- [ ] **Step 4: Run focused and full reset-adjacent tests**

Run:

```powershell
npm test -- convex/apiKeys.test.ts convex/seed.test.ts convex/consensusReceipts.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add convex/demo.ts convex/apiKeys.test.ts
git commit -m "fix: reset all public demo state nightly"
```

### Task 5: Cloudflare Pages build contract

**Files:**
- Create: `public/_redirects`
- Create: `tests/cloudflarePagesShowcase.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing Pages contract tests**

```ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Cloudflare Pages showcase contract', () => {
  it('ships SPA fallback and cross-origin isolation', () => {
    expect(fs.readFileSync('public/_redirects', 'utf8').trim()).toBe('/* /index.html 200');
    const headers = fs.readFileSync('public/_headers', 'utf8');
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(headers).toContain('Cross-Origin-Embedder-Policy: require-corp');
  });

  it('documents the non-secret build flag', () => {
    expect(fs.readFileSync('.env.example', 'utf8')).toContain('VITE_PUBLIC_SHOWCASE=false');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/cloudflarePagesShowcase.test.ts`  
Expected: FAIL because `_redirects` and the env example entry are absent.

- [ ] **Step 3: Add the Pages files**

Create `public/_redirects`:

```text
/* /index.html 200
```

Append to `.env.example`:

```dotenv
# Public gallery build only: hides wallet/staff operations and shows sanitized tour.
VITE_PUBLIC_SHOWCASE=false
```

- [ ] **Step 4: Verify the build contract**

Run:

```powershell
npm test -- tests/cloudflarePagesShowcase.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add public/_redirects .env.example tests/cloudflarePagesShowcase.test.ts
git commit -m "build: add Cloudflare Pages showcase contract"
```

### Task 6: Deployment documentation and handoff

**Files:**
- Modify: `docs/self-hosting.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Document the exact public-demo deployment**

Add a `Cloudflare Pages public showcase` section covering:

```powershell
npm run wavelength:runtime
$env:VITE_PUBLIC_SHOWCASE='true'
$env:VITE_BASE='/'
$env:VITE_CONVEX_URL=$publicConvexUrl
npm run build
npx wrangler pages deploy dist --project-name openstays-consensus --branch main
```

Document required Convex settings:

```powershell
npx convex env set DEMO_MODE true
npx convex env set EMAIL_PROVIDER log_only
npx convex run seed:run
```

State that provider/bridge/OAuth keys must remain unset and unrelated projects are excluded.

- [ ] **Step 2: Update status**

Record branch, target project names, fictional-data policy, current verification,
and that credential use/deployment remain pending until the explicit external
action gate.

- [ ] **Step 3: Check docs and commit**

Run:

```powershell
npm run docs:build
git diff --check
```

Expected: VitePress build exits 0 and no whitespace errors appear.

Commit:

```powershell
git add docs/self-hosting.md STATUS.md
git commit -m "docs: add public showcase deployment runbook"
```

### Task 7: Full local verification

**Files:** None unless a gate reveals an in-scope defect.

- [ ] **Step 1: Install the pinned runtime**

Run:

```powershell
npm run wavelength:runtime
npm run wavelength:runtime:check
```

Expected: all eight pinned runtime assets pass checksum/preflight.

- [ ] **Step 2: Run all root gates**

```powershell
npm test
npm run typecheck
$env:VITE_PUBLIC_SHOWCASE='true'
$env:VITE_CONVEX_URL='https://example-public-showcase.convex.cloud'
npm run build
npm run docs:build
```

Expected: tests/typecheck/build/docs pass. The example URL is build-only and is
not used for browser acceptance.

- [ ] **Step 3: Run all CLI gates**

```powershell
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: PASS.

- [ ] **Step 4: Verify generated output**

Confirm `dist/_headers`, `dist/_redirects`, `dist/index.html`, all three
Consensus Commons images, and `dist/wavewalletdk/` exist. Search `dist/` for
`localhost`, development deployment identifiers, wallet recovery words, and provider token
names; none may appear.

- [ ] **Step 5: Commit any narrow verification fixes**

Stage only files required to repair an observed gate and commit them with a
focused message. If no fixes are needed, do not create an empty commit.

### Task 8: Explicit credential and external-action gate

**Files:** None.

- [ ] **Step 1: Ask for fresh approval**

Before opening credential-bearing files, using browser/OAuth sessions, or
creating provider resources, obtain an explicit current-session approval for:

- Murdawk Media Cloudflare Pages credential/session use;
- Murdawk Media Convex login/project creation;
- creation of `openstays-consensus`;
- deployment to a public `pages.dev` URL.

Do not proceed on inherited or unrelated-project credentials.

- [ ] **Step 2: Verify identities without exposing values**

Confirm Cloudflare account ID equals
`d113f919b7e29373ccac141104bea5b0`. Confirm the Convex organization/project
label is the intended organization and not an unrelated account. Report only labels and permission status.

### Task 9: Provision the dedicated Convex demo

**Files:** `.env.local` may be generated locally and must remain ignored.

- [ ] **Step 1: Create the new Convex project/deployment**

Use the authenticated Convex CLI interactive flow from this worktree. Select a
new project named `openstays-consensus` under the intended organization. Never select an unrelated project.

- [ ] **Step 2: Configure only safe demo variables**

Set `DEMO_MODE=true` and `EMAIL_PROVIDER=log_only`. Verify that Zaprite,
Wavelength, OTS, Channex, Resend, SMTP, and OAuth credential variables are
absent without displaying any values.

- [ ] **Step 3: Deploy functions and seed**

Run the Convex one-time deployment command selected by the CLI, then:

```powershell
npx convex run seed:run
```

Expected: Pinewood Flats and Consensus Commons are present and no real data is imported.

- [ ] **Step 4: Record the public Convex URL in process memory only**

Use the generated public client URL for the frontend build. Do not copy deploy
keys or credential-bearing `.env.local` content into docs, commits, or chat.

### Task 10: Deploy Cloudflare Pages

**Files:** No source changes expected.

- [ ] **Step 1: Build with the approved deployment**

```powershell
$env:VITE_PUBLIC_SHOWCASE='true'
$env:VITE_BASE='/'
$env:VITE_CONVEX_URL=$publicConvexUrl
npm run build
```

Expected: production build succeeds and `dist/` contains Pages control files.

- [ ] **Step 2: Create the Pages project**

Create `openstays-consensus` in the verified Murdawk Media account with
production branch `main`. If it already exists, stop and inspect it rather than
overwriting an unknown project.

- [ ] **Step 3: Direct-upload the verified build**

```powershell
npx wrangler pages deploy dist --project-name openstays-consensus --branch main
```

Expected: Wrangler returns the stable project URL and an immutable deployment URL.

- [ ] **Step 4: Smoke test the public surface**

Verify HTTP 200, HTTPS, `/`, `/p/consensus-commons`, a unit route, SPA cold
loads, COOP/COEP headers, fictional-data banner, simulated checkout, wallet/admin
boundary pages, and no browser errors or horizontal overflow at desktop and
390px.

- [ ] **Step 5: Verify reset and fail-closed rails**

Confirm demo confirmation works without a real charge. Confirm no Wavelength,
Zaprite, Channex, email, or OTS worker action is offered or dispatched. Invoke
the demo reset once through the approved Convex operator command and verify
Consensus Commons returns.

### Task 11: Final public handoff

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Record sanitized deployment evidence**

Add the Pages project name, stable URL, deployment date, source commit, Convex
project label, demo-data policy, and smoke-test results. Do not record account
tokens, deploy keys, guest confirmations, wallet identifiers, or provider data.

- [ ] **Step 2: Run final verification**

Run focused tests, typecheck, production build, and `git diff --check`.

- [ ] **Step 3: Commit the handoff**

```powershell
git add STATUS.md
git commit -m "docs: record public showcase deployment"
```

- [ ] **Step 4: Report the gallery-ready URL**

Return the stable `pages.dev` URL, the exact Demo URL field value, what is live,
what remains intentionally simulated, and any optional next step such as a
custom Murdawk hostname or GitHub auto-deploy.
