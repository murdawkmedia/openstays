# OpenStays status

**Updated: 2026-07-28 - The Synology merchant passed its pinned native deploy and forced encrypted-wallet restore drill; public payment rails remain disabled pending provider-specific acceptance.**

## Current branch

- Remote `main` (verified 2026-07-27):
  `bb78b31c4568a4ce1943a1dac2c0ecbdfa312772`
- Current branch: `codex/synology-live-merchant`
- Generated Convex API declaration follow-up
  [PR #2](https://github.com/murdawkmedia/openstays/pull/2) merged on
  2026-07-27 as `bb78b31c4568a4ce1943a1dac2c0ecbdfa312772`.
- Public showcase: <https://openstays-consensus.pages.dev/>
- The dedicated `openstays-demo` production Convex deployment was updated and
  seeded with fictional Consensus Commons inventory.
- `ZAPRITE_ENABLED`, `WAVELENGTH_ENABLED`, and
  `WAVELENGTH_REWARDS_ENABLED` remain `false`; the reward budget remains zero.
- Synology is the approved merchant host for this showcase; SHC is excluded.
- Host inspection established `/volume1` and `/volume2` as root-owned mode
  `0755` Linux-mode parents without ACLs. The active application root is
  `/volume1/openstays-merchant`; writable `/volume1/docker` is excluded from
  privileged trust.
- The root-owned DSM launcher published and attested release
  `ade31aaadaccb33f2e93978a15522e48180e8fb8` from a 4,126,720-byte archive
  with SHA-256
  `062b8854527e11bca0324c71eac904967afb090322306c2eaed670a6526e25fb`.
- The existing signet wallet restored and unlocked successfully. The deploy
  path now commits one fresh verified generation when an otherwise-ready
  restored wallet reports only `backup_stale`; unrelated unhealthy states
  still fail closed within the same bounded health window.
- The forced recovery drill stopped only the OpenStays merchant, preserved the
  live state as `wavelength-20260728T234223Z`, recreated the container without
  a stale writable layer, restored from the encrypted generation, and
  committed a fresh verified backup.
- Live post-recovery health is `ready` at the pinned release. The container is
  healthy with zero restarts, runs as `1026:100`, exposes no published ports,
  and mounts only `/volume1/openstays-merchant/state` and
  `/volume2/openstays-wallet-backups`.
- No Turnstile widget, eligibility Worker deployment, credential rotation,
  Zaprite resource, or public rail enablement has been completed by this
  branch.

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
- Synology merchant operations now include locally verified source for:
  - one pinned non-root container for Wavelength, OpenTimestamps, and mail;
  - restore-first startup from atomic, verified encrypted `/volume2`
    generations;
  - single-use bootstrap that commits the first verified generation before
    returning recovery words;
  - serialized periodic backup and redacted stale-backup health;
  - guarded fixed-root deployment and forced-recovery scripts;
  - a SHA-256-pinned, root-owned DSM launcher that sanitizes its environment,
    bounded-copies and verifies locally generated source archive bytes,
    rejects unsafe archive members, atomically publishes a commit/size/digest
    attested source tree, preserves prior source in quarantine, and gives
    checkout scripts a root-only nonce handoff;
  - a verify-before-publish Task Scheduler sequence that first validates the
    canonical root-owned launcher parent and safely creates only an absent
    `/usr/local/sbin`, then bounds staged launcher reads by literal size and
    timeout, verifies SHA-256 before atomic rename, and preserves the previous
    trusted launcher on mismatch;
  - exact `1026:100` container-user attestation alongside the existing fixed
    labels, mounts, ports, disabled rails, and cleanup boundaries;
  - loopback-only operator/control access with no published container ports.
- The Cloudflare eligibility-only configuration contains no Container, Durable
  Object, R2, Synology origin, or Synology credential.

## Binding decisions

- Live buttons and backend rails are independently controlled and begin
  disabled.
- Zaprite acceptance does not depend on Synology wallet recovery. Wavelength
  enablement requires the native Synology restore drill.
- Reward daily budget defaults to zero.
- Wavelength remains signet-only; no mainnet wallet or payment is created.
- A stale Wavelength service hides only Wavelength. Zaprite and the simulated
  tour remain independent.
- Missing, corrupt, or stale wallet recovery fails closed.
- A valid restored wallet may refresh exactly one verified generation during
  bounded deploy readiness so backup staleness alone cannot stop an otherwise
  healthy runtime.
- Bootstrap, backup, and health are interactive only through an authenticated
  DSM Container Manager terminal; recovery words never enter task/log output,
  and the required second bootstrap rejects.
- Real-payment rows are never touched by demo reset.
- Only dedicated OpenStays resources may be configured. Unrelated projects,
  customer data, credentials, and deployments remain out of scope.

## Verification

- Pre-Synology public showcase verification completed:
  - 469 root tests passed;
  - 72 CLI tests passed;
  - root and CLI typechecks/builds passed;
  - desktop and mobile public showcase smoke checks passed;
  - credential-dependent live payment browser checks remained correctly
    skipped.
- Tasks 1-6 of the Synology plan are complete locally and the native
  deploy/recovery acceptance has passed on the Synology.
- Cloudflare/Synology operations pass 176 tests, typecheck, and the generic
  Worker dry-run build.
- The native Synology startup failure was reproduced as
  `EACCES` on `/app/synology/supervisor.mjs`; the focused test failed before
  the Dockerfile permission correction and all 172 operations tests pass
  afterwards.
- A live three-second delayed health probe reproduced the post-start race.
  The regression fails its first two health calls, succeeds on the third, and
  proves no rollback occurs.
- The live restore then reproduced a second deterministic readiness edge:
  wallet control became ready before the first 60-second periodic backup, so
  the 30-second deploy health loop saw only `backup_stale`. The new regression
  fails health until a verified backup refresh succeeds and proves the deploy
  neither rolls back nor weakens other health failures.
- The current full local gate passed on 2026-07-28:
  - root: 469 tests, typecheck, production build, docs build, and runtime audit;
  - CLI: 72 tests, typecheck, and build;
  - operations: 176 tests, typecheck, and build;
  - `git diff --check`.
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
- The earlier Cloudflare-targeted Linux container and recovery drill passed on
  an amd64 GitHub-hosted runner. Synology Compose rendering, native image
  build, restored wallet health, exact identity/mount/port attestation, and the
  forced recovery drill now also pass on the approved native host.
- Earlier Cloudflare-targeted release-candidate verification:
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

1. Create and verify the dedicated Turnstile widget and deploy the
   eligibility-only Worker.
2. Rotate the exposed Zaprite key and run exact CA$1 authoritative acceptance
   before enabling Zaprite independently.
3. Fund the capped signet budget and run Wavelength booking/reward acceptance
   before enabling its booking rail and rewards.
4. Complete desktop/mobile browser acceptance, stop-switch checks, interrupted
   settlement reconciliation, and the 15-day retention check.

See:

- [Public live payments](./docs/public-live-payments.md)
- [Operator runbook](./docs/operations/public-live-payments-runbook.md)
- [Approved Synology implementation plan](./docs/superpowers/plans/2026-07-27-synology-live-merchant.md)
