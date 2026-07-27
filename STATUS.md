# OpenStays status

**Updated: 2026-07-26 — public live-payment release candidate in local verification.**

## Current branch

- Branch: `codex/public-live-payment-rails`
- Product/UI checkpoint: `1faaecb`
- Merchant bootstrap/recovery checkpoint: `e6aee3f`
- Public operations documentation checkpoint: `9945dde`
- The branch is local only. It has not been pushed, merged, or deployed.
- No credential-bearing file was opened. No provider, Convex, Cloudflare,
  Turnstile, R2, Worker, Durable Object, Container, Pages, or Zaprite resource
  was created or changed.

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
- Cloudflare operations currently pass 28 tests, typecheck, and Worker dry-run
  build.
- Focused public refund, simulated-tour, receipt-timeline, disclosure, wallet
  bootstrap, heartbeat, backup, and forced-restore tests pass.
- A real Linux container build and vulnerability scan are still required.
  No Docker-compatible engine is installed in the current environment.
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

1. Build and scan the real container image on a Docker-capable host.
2. Run disposable integration failure injection, including corrupt-copy restore,
   interrupted settlement reconciliation, and 15-day retention.
3. Obtain fresh approval before opening/using credentials, creating
   resources, pushing, or deploying.
4. Deploy with all live rails disabled, bootstrap the merchant wallet once,
   record recovery offline, force a verified restore, then perform live
   acceptance before enabling either rail.

See:

- [Public live payments](./docs/public-live-payments.md)
- [Operator runbook](./docs/operations/public-live-payments-runbook.md)
- [Approved implementation plan](./docs/superpowers/plans/2026-07-26-public-live-payment-rails.md)
