# OpenStays status

**Updated: 2026-07-26 — fictional public showcase deployed; live rails remain disabled.**

## Current branch

- `main` merge: `907d466`
- Follow-up branch: `codex/public-live-payment-rails`
- Generated API follow-up: <https://github.com/murdawkmedia/openstays/pull/2>
- Public showcase: <https://openstays-consensus.pages.dev/>
- The dedicated `openstays-demo` production Convex deployment was updated and
  seeded with fictional Consensus Commons inventory.
- `ZAPRITE_ENABLED`, `WAVELENGTH_ENABLED`, and
  `WAVELENGTH_REWARDS_ENABLED` remain `false`; the reward budget remains zero.
- No Turnstile, R2, Worker, Durable Object, Container, or Zaprite resource was
  created or changed.

## Implemented

- Consensus Commons is consistently disclosed as a fictional property with no
  lodging or reservation service.
- The public payment policy fixes Zaprite at CA$1 and Wavelength at exactly
  1,000 signet sats. The simulated tour remains a no-charge, no-reward path.
- Turnstile-backed eligibility tokens are five-minute, action-scoped,
  booking-scoped, replay-protected, and contain keyed digests rather than raw
  guest/device/network identifiers.
- Zaprite confirmation uses authoritative server-side order reconciliation;
  webhook content and redirects are nudges only.
- Wavelength confirmation and rewards require exact signet amount, invoice,
  prepared intent, completed matching merchant activity, and idempotent
  settlement.
- Submitted privacy-safe OpenTimestamps receipts and later Bitcoin block
  attestations remain distinct states.
- Guests can request a manual Zaprite/Wavelength refund. The payment remains
  paid until staff records the completed external reference.
- Public retention deletes old booking messages, purges old guest identity and
  rendered email content, and removes only unpaid disposable expired bookings.
  Authoritative booking/payment/refund/reward/receipt records are preserved.
- Cloudflare operations include:
  - one pinned non-root container for Wavelength, OpenTimestamps, and mail;
  - service-scoped bridge and heartbeat tokens;
  - 60-second fail-closed public Wavelength health;
  - AES-256-GCM wallet archives with immutable, verified R2 generations;
  - a single-use authenticated wallet bootstrap that commits the first backup;
  - one-minute supervisor wakeups and redacted backup health;
  - an authenticated forced restart from the newest verified archive.

## Binding decisions

- Live buttons and backend rails are independently controlled and begin
  disabled.
- Reward daily budget defaults to zero.
- Wavelength remains signet-only; no mainnet wallet or payment is created.
- A stale Wavelength service hides only Wavelength. Zaprite and the simulated
  tour remain independent.
- Missing, corrupt, or stale wallet recovery fails closed.
- Real-payment rows are never touched by demo reset.
- Only dedicated OpenStays resources may be configured. Unrelated projects,
  customer data, credentials, and deployments remain out of scope.

## Verification

- Task 10 complete:
  - 469 root tests passed;
  - 72 CLI tests passed;
  - root and CLI typechecks/builds passed;
  - desktop and mobile public showcase smoke checks passed;
  - credential-dependent live payment browser checks remained correctly
    skipped.
- Cloudflare operations pass 28 tests, typecheck, and Worker dry-run build.
- GitHub CI run
  [30233083376](https://github.com/murdawkmedia/openstays/actions/runs/30233083376)
  passed both jobs:
  - the application job ran root typecheck, 469 tests, production build, and
    docs build;
  - the merchant job reproducibly built the checksum-pinned Wavelength v0.1.0
    source with `wavewalletrpc` and `swapruntime`, smoke-tested Node,
    OpenTimestamps, and `waved`, then completed wallet bootstrap, encrypted
    backup, clean-container restore, full vulnerability reporting, and the
    blocking fixable high/critical scan.
- Focused public refund, simulated-tour, receipt-timeline, disclosure, wallet
  bootstrap, heartbeat, backup, and forced-restore tests pass.
- The real Linux container and recovery drill passed on an amd64 GitHub-hosted
  runner. The local workstation still has no Docker-compatible engine.
- Fresh release-candidate verification:
  - root: 469 tests, typecheck, production build, docs build, and the
    project-specific runtime audit passed;
  - CLI: 72 tests, typecheck, build, and the high-severity audit threshold
    passed; two moderate findings remain in the MCP dependency's unused
    Windows static-file adapter;
  - Cloudflare: 28 tests, typecheck, dry-run build, and production dependency
    audit passed with zero findings;
  - public showcase build: zero staff chunks, nine Wavelength runtime files,
    and no scanned credential, recovery, private-path, or personal identifiers;
  - browser: desktop and mobile fictional showcase funnels passed; six
    credential-dependent live-rail cases remained skipped;
  - focused failure injection: 52 payment/reward/retention/heartbeat tests and
    24 backup/bootstrap/restore/control tests passed.
- Raw `npm audit --omit=dev --audit-level=high` remains nonzero only for
  `GHSA-qwww-vcr4-c8h2`. The repository's fail-closed audit script verifies
  OpenStays is a client-only Vite SPA with no React Server Components or
  server-router package and accepts only this documented non-applicable
  advisory.

## Remaining gates

1. Merge the generated Convex declaration follow-up.
2. Run credential-dependent live integration acceptance, including
   interrupted settlement reconciliation and 15-day retention.
3. Gain access to a durable merchant host. The Synology was preferred but was
   unreachable from the current network; the present Cloudflare token can
   access Pages but not the required private R2 bucket.
4. Deploy merchant infrastructure with all live rails disabled, bootstrap the wallet once,
   record recovery offline, force a verified restore, then perform live
   acceptance before enabling either rail.

See:

- [Public live payments](./docs/public-live-payments.md)
- [Operator runbook](./docs/operations/public-live-payments-runbook.md)
- [Approved implementation plan](./docs/superpowers/plans/2026-07-26-public-live-payment-rails.md)
