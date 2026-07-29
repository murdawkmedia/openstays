# OpenStays status

**Updated: 2026-07-29 — the public Consensus Commons showcase is live, a
Wavelength signet booking payment has settled, and its privacy-safe
OpenTimestamps receipt has been submitted to four public calendars.**

## Current release

- Branch: `main`
- Application release:
  `e05c391334f1376c98bd5cc8dc945d593db1165b`
- Public showcase: <https://openstays-consensus.pages.dev/>
- Immutable Pages deployment:
  <https://1cd9eefa.openstays-consensus.pages.dev/>
- Production Convex deployment: dedicated `openstays-demo` project
  (`shiny-bison-351`).
- Synology is the approved merchant host. SHC remains explicitly excluded.
- The exact Synology source archive for `e05c391` is 4,167,680 bytes with
  SHA-256
  `8aa298f457c6563765ae1c65eb2d16fc76ee8ab87907944d618923c085c44e0f`.
- Cloudflare Pages is deployed from the exact release commit.
- The Synology image built and started from the same commit, size, and digest.
  Its encrypted wallet restored with four existing activities and Container
  Manager reports it healthy.
- Wavelength booking and reward stop switches are temporarily `false` in
  Convex and the Synology merchant while the final enable-task save awaits an
  interactive DSM password confirmation. Zaprite and the simulated tour are
  unaffected.
- The post-deploy forced recovery verifier stopped after a strict container
  identity mismatch. Its fail-closed cleanup preserved the quarantined wallet
  and encrypted backup generations. A normal container start restored the
  wallet and returned healthy; do not delete the preserved quarantine.

## Live acceptance state

- Consensus Commons remains clearly disclosed as a fictional property. A
  payment is a contribution to the OpenStays project, not a lodging purchase.
- One 1,000-sat Wavelength signet booking payment completed and reconciled
  authoritatively. It must not be sent again.
- The confirmed booking has one immutable Consensus Receipt:
  - state `submitted`;
  - four public OpenTimestamps calendar attestations;
  - a 702-byte downloadable `.ots` proof;
  - no Bitcoin block anchor yet, which is the honest expected state for a
    fresh timestamp.
- Its one-time 1,000-sat signet reward is eligible but unpaid. The merchant
  has 1,000 spendable sats while the fail-closed guard requires the
  1,000-sat principal plus the configured 210-sat maximum fee reserve. Do not
  lower the guard or attempt the payout without a fresh quote and explicit
  confirmation.
- No additional signet funds were moved during the release-hardening pass.

## Implemented

- Conflict-safe booking, authoritative payment reconciliation, guest/staff
  messaging, email notifications, manual refund cases, and the optional
  Channex adapter remain available.
- Wavelength stays signet-only and uses exact invoice, amount, prepared intent,
  completed merchant activity, and idempotent settlement matching.
- Zaprite uses authoritative server-side order reconciliation; redirect and
  webhook content are nudges only.
- Confirmed bookings receive deterministic, privacy-safe OpenTimestamps
  Consensus Receipts. Receipt submission and eventual Bitcoin anchoring are
  separate states.
- Submitted receipts unlock a one-time 1,000-sat signet reward claim in the
  self-custodial browser wallet.
- Code-only booking lookup no longer returns guest email. Checkout now requires
  the opaque booking ID and confirmation code before guest identity is
  returned, while manage-booking still requires normalized email plus code.
- Queued and submitted receipt copy now accurately distinguishes a pending
  reward, an absent reward, and an eligible reward.
- The Synology OTS worker now overrides locked-container `HOME` and
  `XDG_CACHE_HOME` with its writable state root. This permanently fixes the
  non-root OpenTimestamps cache failure without weakening container identity
  or permissions.
- The Synology merchant remains non-root, has no published ports, restores
  from atomic encrypted wallet backups, and uses commit/size/SHA-256-pinned
  source deployment with bounded recovery checks.
- Cloudflare eligibility configuration contains no Synology origin credential,
  wallet secret, recovery phrase, or merchant bridge token.

## Binding decisions

- Consensus Commons is fictional; no real lodging or reservation service is
  promised.
- Wavelength is signet-only. There is no OpenStays Wavelength mainnet wallet.
- OpenTimestamps calendar commitments may later anchor to Bitcoin mainnet;
  that is separate from the signet payment and reward flows.
- Reward payout fails closed on insufficient balance, excessive fees, an
  expired or amountless invoice, network mismatch, or incomplete activity.
- A payment row is never inferred from browser success alone.
- Real-payment rows are never touched by demo reset or retention cleanup.
- Zaprite receipts and OpenStays reservation confirmations remain distinct.
- Only dedicated OpenStays resources may be configured. CBAP, SHC, unrelated
  deployments, customer data, and unrelated credentials are out of scope.

## Verification

Fresh release gates passed on 2026-07-29:

- root: 476 tests, typecheck, production build, docs build, runtime audit, and
  `git diff --check`;
- CLI: 72 tests, typecheck, and build;
- Synology/Cloudflare operations: 187 tests, typecheck, build, and production
  audit with zero vulnerabilities;
- CLI production audit passed the high-severity threshold; two moderate
  findings remain in the MCP dependency's unused Hono adapter;
- public build contains the expected version-matched compressed Wavelength
  runtime, no raw WASM duplicate, and no repository credential;
- canonical home and property routes return HTTP 200;
- the canonical production bundle contains the hardened checkout query,
  corrected receipt/reward copy, and signet-only messaging;
- Convex deployed successfully to the dedicated production `openstays-demo`
  deployment with no index deletion;
- the live Wavelength booking payment, confirmation, receipt generation,
  four-calendar timestamp submission, and reward eligibility transitions
  completed;
- the public `.ots` download is enabled and the fresh receipt is truthfully
  shown as submitted rather than Bitcoin-anchored;
- GitHub CI run
  [30429909632](https://github.com/murdawkmedia/openstays/actions/runs/30429909632)
  passed the application, Cloudflare operations, reproducible merchant-image,
  wallet bootstrap/backup/restore, and blocking vulnerability gates.

## Remaining work

1. Submit the visible DSM password prompt, run the restored Wavelength enable
   task, require a healthy container/heartbeat, then set the two production
   Convex Wavelength flags back to `true`.
2. Diagnose the strict post-deploy recovery-drill container identity mismatch
   before running another forced recovery. Preserve all quarantine and backup
   generations.
3. Fund at least the fee reserve or obtain a fresh quote and explicit
   confirmation before testing the 1,000-sat reward payout.
4. Run a dedicated CA$1 Zaprite paid-order acceptance if public Zaprite
   payment testing is still desired.
5. Perform the scheduled 15-day retention check.
6. Rotate the merchant/container bridge, wallet password, SMTP, backup, and
   provider credentials after acceptance because the DSM environment view was
   exposed during interactive setup. Do not print the current values.

See:

- [Public live payments](./docs/public-live-payments.md)
- [Operator runbook](./docs/operations/public-live-payments-runbook.md)
- [Synology live merchant plan](./docs/superpowers/plans/2026-07-27-synology-live-merchant.md)
