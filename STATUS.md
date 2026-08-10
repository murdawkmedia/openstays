# OpenStays status

Updated: 2026-08-10

## Current branch

- Worktree: `C:\Users\Murphy\.config\superpowers\worktrees\openstays\kokanee-command-center`
- Branch: `codex/kokanee-command-center`
- Base: local `main` / `origin/main` at `da81f158f3e53db5a63a9bc1396edc8b764e0c8b`
- Verified checkpoints: `65b07a8` (foundation), `0e19e43` (audited resort workflows), plus the current final command-center/automation commit.
- No push, merge, deployment, credential access, or production data change has occurred.

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
channel behavior and the current public deployment remain unchanged. Promotion
requires an explicit later instruction after final acceptance.
