# OpenStays status

Updated: 2026-08-31

## Current branch

- Worktree: isolated local feature worktree
- Branch: `codex/resnexus-daily-operations`
- This branch adds the local daily-operations first pass. It has not been
  pushed, merged, deployed, migrated, or enabled on any property.
- Kokanee checkpoints: `65b07a8` (foundation), `0e19e43` (audited resort workflows), and `0e0ab5f` (final command center/automation pass).
- Pull requests `#3` and `#4` merged as `0fdd834` and `8b9a76f` after their
  complete CI runs passed.
- Production Convex and Cloudflare Pages were promoted on 2026-08-10.

## Live release

- Production Convex `shiny-bison-351` received the additive schema and
  functions after a dry run confirmed that no indexes would be deleted.
- Cloudflare Pages production deployment `de964747` is live at
  `https://openstays-consensus.pages.dev` and preserves Zaprite, Wavelength
  signet, simulated fallback, Turnstile, and authenticated staff routes.
- The public operations tour passed desktop and 390 px live-browser checks
  with no console errors or page-level overflow. The Wavelength runtime and
  eligibility edge return healthy production responses.
- The paired Convex deployment now distinguishes historical confirmation from
  a booking's current cancelled state and omits reward claims when no reward
  exists.
- Property feature flags remain absent/off. The assignment migration replayed
  twice with zero inserts because production currently has no staff profiles;
  controlled owner bootstrap is still required before the private operator
  workspace can be enabled.
- The first post-merge CI run passed application, docs, Cloudflare operations,
  container build, runtime, and recovery tests, then Trivy identified fixable
  transitive CLI dependencies. Commit `00b885d` pins patched releases, and
  replacement CI run `31424758210` passed every job, including the strict
  deploy-blocking Trivy scan.

## Implemented

- Property-scoped fixed roles, capability matrix, assignment backfill, feature
  flags, idempotency ledger, audit metadata, unit groups/attributes, and private
  operational search projection.
- Persistent staff shell, property/staff selector, global search, 30/45/60/90-
  day virtualized command grid, saved filters, and record action drawer.
- Audited block, move/resize, quote/accept, waitlist, call, maintenance,
  complimentary, rate-adjustment, front-desk, housekeeping, folio/manual
  payment/reversal, night-audit/report, group, seasonal-contract, reminder, and
  gift-certificate workflows.
- Feature-gated routes for command center, front desk, housekeeping,
  maintenance, folios, quotes, contracts, night audit, and reports.
- Property-bounded `/api/v1/operations/*`, CLI `ops` / `ops-action`, and MCP
  view/action tools using single-use automation claims to reach the same staff
  mutations.
- Expanded source-controlled public operations tour with fictional PMS data and
  no live queries or mutations.

## Daily-operations first pass

- Front-desk queues now include operational exceptions, attention filters,
  housekeeping progress, policy context, record drawers, and audited flag
  create, assignment, and resolution workflows.
- Housekeeping now has template snapshots, assignee and priority updates,
  checklist work, required-item exceptions, inspection submission and review,
  cancellation, audit history, and replay-safe checkout turnover handoff.
- Front-desk and housekeeping state remains separate from booking occupancy,
  payment settlement, and sellable inventory. Only the existing maintenance
  block workflow removes inventory.
- The browser, `/api/v1`, CLI, and MCP paths call the same property-scoped,
  role-checked, versioned, idempotent mutations.
- The fictional operations tour includes five new daily-operation examples and
  still has no live staff queries or mutation hooks.
- `front_desk_exceptions` and `housekeeping_checklists` are disabled by default.
  Enabling either flag requires the documented property-specific migration and
  acceptance steps.

## Verification state for this branch

- Root: 84 files / 612 tests, typecheck, and production build are green.
- CLI: 8 files / 82 tests, typecheck, and build are green.
- Cloudflare operations: 9 files / 187 tests, typecheck, and Wrangler dry-run
  build are green.
- Documentation build, reviewed runtime dependency audit, and the version-
  matched Wavelength browser-runtime check are green.
- Hermetic Playwright acceptance is green on desktop and mobile: four public
  showcase and operations-tour checks passed. Six credential- or fresh-booking-
  dependent live-rail checks were intentionally skipped; no live backend or
  payment state was used by this isolated verification run.
- `git diff --check` is clean.

## Basic-user usability acceptance

- A synthetic guest completed the live public journey on 2026-08-10: selected
  Consensus Commons inventory and dates, reviewed the price, used the simulated
  payment path, reached confirmation, authenticated with the confirmation code
  and normalized email, sent a booking message, reviewed the timeline, and
  cancelled the reservation.
- The synthetic booking is `OS-UBWTYQ`; it is cancelled, so it does not retain
  active inventory.
- A second acceptance booking, `OS-QZYPAF`, repeated the full live flow after
  release: pricing, hold, simulated payment, confirmation, authenticated
  management, guest message, receipt/timeline, and cancellation. It is also
  cancelled and retains no active inventory.
- The walkthrough exposed two clarity defects that are fixed on this branch:
  cancelled reservations now show a prominent current-state banner and
  historical wording instead of appearing currently confirmed or generically
  reward-eligible; public-tour filters now constrain the selected detail record
  and expose clear pressed states and first-use guidance.
- Desktop and 390 px local acceptance passed with no page-level overflow or
  browser warnings. The immutable `de964747` deployment and production alias
  were then verified against the cancelled booking and filtered front-desk
  queue; both serve the corrected frontend and backend behavior.
- Pull-request CI `31427288762` and `31428802578`, main CI `31427753509`
  and `31429181429`, and Pages workflows `31427753649` and `31429181508`
  completed successfully. The latter main run's isolated Synology concurrency
  assertion passed on its failed-job rerun; the identical PR run was already
  green.
- The second pass exposed one redundant control: conversation and cancellation
  rendered separate inputs for the same guest email state. The live flow now
  consolidates these into one clearly explained booking-email field used by
  conversation, history, rewards/refunds, and cancellation.

## Deployment boundary

All new operator workspaces default off. Existing booking/payment/refund/
channel behavior remains unchanged. The fictional public tour and production
backend schema are deployed, but enabling a private operational workspace is a
separate, reversible per-property action after owner bootstrap and acceptance.
