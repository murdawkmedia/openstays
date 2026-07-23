# OpenStays status

**Updated: 2026-07-22 — Consensus Commons hackathon MVP, local branch.**

## Current state

- Worktree: `openstays-btcpp-consensus-mvp`
- Branch: `codex/btcpp-consensus-mvp`
- `main` remains untouched; no push or merge has been performed.
- With Murphy's explicit approval, commit `0b45c3f` was uploaded only to the
  isolated `affable-wildcat-206` development deployment. The receipt, reward,
  and bridge routes are live there; no production deployment was touched.
- Competition baseline: annotated local tag
  `btcpp-toronto-2026-pre-kickoff` points to `5c3038e`; see
  `HACKATHON_BASELINE.md` for the pre-existing capability disclosure.
- Current full gates: 356 root tests and 68 CLI tests passed; root and CLI
  typechecks/builds plus the documentation build passed. Desktop/mobile public
  browser smoke passed; the two live-wallet cases skipped without their explicit
  live inputs. The existing Node `TimeoutNegativeWarning` remains non-fatal in
  the runner.
- Added: manual provider refund cases, authoritative Zaprite reconciliation,
  Wavelength signet bridge/wallet, booking chat and alerts, staff operations,
  fictional Consensus Commons seed/branding, and a consensus timeline.
- Post-kickoff addition: immutable privacy-safe OpenTimestamps consensus
  receipts, authenticated local OTS worker endpoints/CLI, guest proof downloads,
  and a one-time exact-1,000-sat Wavelength signet reward with prepared-send and
  completed-activity reconciliation.
- The permanent reward principal is now implemented locally as exactly 1,000
  signet sats. Convex keeps legacy 210-sat rows readable, creates only 1,000-sat
  rows, and includes an idempotent migration limited to inactive unpaid rewards.
  The isolated demo migration upgraded its one eligible unpaid legacy row; an
  immediate replay upgraded zero rows.
- During required TypeScript binding generation, `npx convex codegen` reported
  uploading function bundles to the configured isolated development deployment.
  No `convex dev`, production deploy, or migration command was run. Treat the
  isolated function/schema refresh as possible and verify it before migration.
- OpenStays Mail now renders into a durable provider-neutral Convex queue and
  delivers through an authenticated generic SMTP worker. Resend and log-only
  remain supported; the pinned Mailpit profile is loopback capture only.
- Live local runtime: isolated Murdawk Convex dev deployment
  `affable-wildcat-206`, seeded demo inventory, Vite on `127.0.0.1:5173`,
  loopback-only Wavelength v0.1.0 wallets/merchant bridge, the WSL-backed OTS
  worker, and Mailpit plus its SMTP bridge.
- The dedicated Consensus Commons Zaprite API key/custom checkout are configured
  on the isolated deployment with the OpenStays webhook. Live acceptance created
  the fictional CA$0.21 order `od_3nG1v01J53`; Zaprite's own test-payment
  connection marked it paid, an authenticated nudge triggered authoritative
  API reconciliation, and OpenStays confirmed booking `OS-A52VVM`. Rotate the
  session-shared API key after the hackathon.
- Wavelength merchant recovery material is stored outside the repository under
  `%LOCALAPPDATA%\OpenStays\wavelength-signet` with user-only ACLs.
- Two independent Wavelength signet wallets are running on loopback. The
  merchant received two confirmed 10,000-sat faucet deposits and completed its
  boarding round with 19,490 spendable sats after the operator's 510-sat fee.
  A real merchant-to-guest 210-sat signet payment completed, leaving the guest
  with 210 sats of reusable operator credit. A later guest-to-merchant booking
  payment passed `prepare-send` with an exact 210-sat principal and zero fee,
  but remained in `settling` through invoice expiry while the merchant receive
  remained pending. It was not retried or reported paid; the alpha service must
  reconcile/refund it before that payment hash is reused.
- The production browser build now starts exactly one embedded Wavelength
  engine, serves all required runtime assets with cross-origin isolation, and
  has no horizontal overflow at the tested mobile viewport. Confirmation query
  parameters use `confirmation` because Convex Auth consumes the reserved
  OAuth `code` parameter.
- A persistent browser guest wallet was created under
  `%LOCALAPPDATA%\OpenStays\wavelength-browser-guest-demo`; its password,
  24-word recovery material, and Chrome profile are protected by a user-only
  ACL and were never printed. It creates/unlocks correctly. Diagnostic reward
  invoice attempts isolated Wavelength's public signet `CreateCredit` failure
  to amounts below the operator's 1,000-sat minimum: two native wallets and the
  browser timed out at 210 sats, while a 1,000-sat control invoice returned
  immediately.
- Live reward acceptance completed on the isolated development deployment. The
  protected browser guest wallet created a fresh amount-bearing invoice, the
  merchant prepared and sent exactly 1,000 signet sats, and Wavelength reported
  one completed outgoing activity. The bridge now requires Wavelength's signed
  outgoing amount (`-1000`) before reporting settlement. OpenStays recorded one
  paid reward with one attempt, and repeated bridge polls produced no second
  payment. The guest wallet and reloaded reward UI both showed 1,000 sats and
  the authoritative paid announcement.
- A separate, unfunded disposable in-app-browser wallet was abandoned after its
  recovery words appeared in the local automation trace. It never received an
  invoice payment and must not be used. The protected persistent demo wallet's
  recovery material was not exposed.
- The pinned official OpenTimestamps client is installed in WSL because its
  `python-bitcoinlib` dependency could not discover the native Windows Python
  OpenSSL 3 DLL. The CLI now has a tested WSL invocation/path adapter while
  preserving native execution by default.
- `docs/demo/consensus-receipt-sample.json.ots` is a real proof for the
  fictional sample hash
  `2bebb8b87c3d27c9a875beae80355a1fde04c6bf66566f60740e4bdbddf132ba`.
  Four public calendars accepted it; all attestations are currently pending,
  not Bitcoin-anchored.
- Live acceptance also created receipt
  `cr_jd7e1w0s3wb1t719gvnsctpsed8b27wp`: its 724-byte canonical JSON hashes to
  `55172b52543346ce34558f7ac7558fa7e40c5036e17d735d4e96dc6afeacc0bb`.
  The OTS worker validated and uploaded a 700-byte proof accepted by four
  calendars. Its state is `submitted`, not Bitcoin-anchored, and both browser
  downloads round-tripped successfully.
- Mailpit is running on loopback SMTP `127.0.0.1:1025` and inbox
  `127.0.0.1:8025`; the local mail bridge targets only the isolated dev
  deployment. Current live acceptance delivered the fictional confirmation,
  consensus-receipt notice, and guest-to-staff message alert for `OS-A52VVM`.
  The booking-scoped message also persisted and rendered without mobile
  overflow.
- Nodemailer was advanced to 9.0.3 after the original pin surfaced a direct
  high-severity advisory. The stale `fast-uri` lock entry is also patched. CLI
  audit now has zero high/critical findings and two moderate findings in the
  MCP SDK's unused Hono static-file adapter; an upstream-compatible MCP update
  is the remaining dependency follow-up.
- Root `npm audit` reports one high and two moderate development-only findings
  in VitePress 1.6.4's nested Vite/esbuild toolchain, with no compatible fix
  currently offered. The booking application uses the separately resolved
  Vite 7.3.6 build; do not expose the documentation development server.

## Decisions in force

- Zaprite webhook content is untrusted; authenticated fetch is authoritative.
- Zaprite/Wavelength refunds remain paid until staff records an external
  reference; no premature guest success email.
- Wavelength is signet-only. Legacy mainnet schema rows remain readable, but
  active configuration, UI, claims, tests, scripts, and bridges reject them.
- Receipt canonical JSON/hash never mutate. A valid submitted proof unlocks
  the reward; `bitcoin_anchored` requires a later verified Bitcoin block
  attestation and is never inferred from calendar submission.
- Each submitted receipt permits one exact 1,000 signet-sat reward. This matches
  Wavelength's public signet minimum and uses its standard receive path. The bridge
  checks the prepared payment, fee cap, invoice, payment hash, and completed
  merchant activity before recording payment.
- Channex is adapter-ready but not connected/certified.
- Convex owns email rendering, deduplication, queue leases, retries, and audit;
  SMTP/Resend are replaceable delivery adapters. Public demo mode stays
  log-only by design.
- No customer data, credentials, production rail, push, deploy, or merge is in
  scope without explicit approval.

## Remaining acceptance

- Stamp the fictional sample receipt early; show it honestly as submitted while
  pending, and upgrade it before the expo if public calendars have anchored it.
- Rehearse the three-minute judge path once with Murphy operating the UI; the
  automated production-like desktop/mobile flow and live signet reward payout
  are complete.
- Do not inspect or use CBAP credentials/deployments.
- Murphy accepts the demo; only then consider a separately approved local merge.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
