# OpenStays status

Updated: 2026-08-10

## Current branch

- Worktree: `C:\Users\Murphy\.config\superpowers\worktrees\openstays\merge-main`
- Branch: `main`
- Kokanee checkpoints: `65b07a8` (foundation), `0e19e43` (audited resort workflows), and `0e0ab5f` (final command center/automation pass).
- `main` was fast-forwarded and pushed on 2026-08-10.

## Live release

- Production Convex `shiny-bison-351` received the additive schema and
  functions after a dry run confirmed that no indexes would be deleted.
- Cloudflare Pages production deployment `540c4ccb` is live at
  `https://openstays-consensus.pages.dev` and preserves Zaprite, Wavelength
  signet, simulated fallback, Turnstile, and authenticated staff routes.
- The public operations tour passed desktop and 390 px live-browser checks
  with no console errors or page-level overflow. The Wavelength runtime and
  eligibility edge return healthy production responses.
- Property feature flags remain absent/off. The assignment migration replayed
  twice with zero inserts because production currently has no staff profiles;
  controlled owner bootstrap is still required before the private operator
  workspace can be enabled.
- The first post-merge CI run passed application, docs, Cloudflare operations,
  container build, runtime, and recovery tests, then Trivy identified fixable
  transitive CLI dependencies. The follow-up pins patched releases and must
  pass the replacement CI run before release closeout.

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

## Verification state

- Root: 75 files / 567 tests, typecheck, and production build are green.
- CLI: 8 files / 82 tests, typecheck, and build are green.
- Cloudflare operations: 9 files / 187 tests, typecheck, and Wrangler dry-run
  build are green.
- Documentation build, reviewed runtime dependency audit, and the version-
  matched Wavelength browser-runtime check are green.
- Hermetic Playwright acceptance is green on desktop and mobile: four public
  showcase/operations-tour checks passed. Six credential- or fresh-booking-
  dependent live-rail checks were intentionally skipped; no live backend or
  payment state was used by this isolated verification run.
- `git diff --check` is clean.

## Deployment boundary

All new operator workspaces default off. Existing booking/payment/refund/
channel behavior remains unchanged. The fictional public tour and production
backend schema are deployed, but enabling a private operational workspace is a
separate, reversible per-property action after owner bootstrap and acceptance.
