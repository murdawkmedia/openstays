# OpenStays status

**Updated: 2026-07-27 - Synology native build reached container startup; a non-root source-read failure is fixed and the pinned redeploy remains pending.**

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
- The first live DSM task attempt stopped safely because `/usr/local/sbin` was
  absent. It created no launcher, application root, backup root, or container.
  The current task validates `/usr/local`, creates that exact child only when
  absent, and rejects a symlink or ownership/mode drift before staging.
- The corrected task installed the root-owned launcher, rendered Compose, and
  completed the native image build. The first container start then failed
  closed because root's archive-extraction umask left `/app` source readable
  only by image user `1000`, while the attested Synology runtime is
  `1026:100`. The image now explicitly makes application source
  world-readable/traversable without making it writable, and a regression
  contract covers that boundary. The disabled merchant redeploy is pending.
- No wallet bootstrap, Turnstile widget, eligibility Worker deployment,
  credential rotation, Zaprite resource, or rail enablement has been
  completed by this branch.

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
- Tasks 1-6 of the Synology plan are complete locally.
- Cloudflare/Synology operations pass 172 tests, typecheck, the generic Worker
  dry-run build, and the eligibility-only dry run with no Container, Durable
  Object, or R2 binding.
- The native Synology startup failure was reproduced as
  `EACCES` on `/app/synology/supervisor.mjs`; the focused test failed before
  the Dockerfile permission correction and all 172 operations tests pass
  afterwards.
- The current full local gate passed:
  - root: 469 tests, typecheck, production build, docs build, and runtime audit;
  - CLI: 72 tests, typecheck, and build;
  - operations: 172 tests, typecheck, and build;
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
  an amd64 GitHub-hosted runner. The new Synology Compose rendering, native
  image build, container health, and recovery drill have not yet run on the
  Synology and remain acceptance gates.
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

1. Publish a fresh archive of the source-read fix through the installed
   root-owned launcher and verify the disabled merchant reaches healthy
   `awaiting_bootstrap` state with the exact non-root identity, mounts, labels,
   and zero published ports; keep the manual DSM task disabled.
2. Bootstrap the signet wallet once, record recovery offline, and complete the
   forced restore drill before enabling Wavelength.
3. Create and verify the dedicated Turnstile widget and deploy the
   eligibility-only Worker.
4. Rotate the exposed Zaprite key and run exact CA$1 authoritative acceptance
   before enabling Zaprite independently.
5. Fund the capped signet budget and run Wavelength booking/reward acceptance
   before enabling its booking rail and rewards.
6. Complete desktop/mobile browser acceptance, stop-switch checks, interrupted
   settlement reconciliation, and the 15-day retention check.

See:

- [Public live payments](./docs/public-live-payments.md)
- [Operator runbook](./docs/operations/public-live-payments-runbook.md)
- [Approved Synology implementation plan](./docs/superpowers/plans/2026-07-27-synology-live-merchant.md)
