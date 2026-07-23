# OpenStays status

**Updated: 2026-07-23 — final judge-flow hardening in progress.**

## Current state

- Working branch: `codex/judge-opening-infographics`.
- The Consensus Commons MVP is merged and pushed on `main` at `3f45b70`.
  Final judge-flow hardening is on `codex/judge-opening-infographics`; the
  branch will remain unmerged and is pushed only after the fresh gates pass.
- With Murphy's explicit approval, commit `0b45c3f` was uploaded only to the
  isolated `affable-wildcat-206` development deployment. The receipt, reward,
  and bridge routes are live there; no production deployment was touched.
- Competition baseline: annotated local tag
  `btcpp-toronto-2026-pre-kickoff` points to `5c3038e`; see
  `HACKATHON_BASELINE.md` for the pre-existing capability disclosure.
- Fresh 2026-07-23 gates: 374 root tests and 69 CLI tests passed; root and CLI
  typechecks/builds plus the documentation build passed. The existing Node
  `TimeoutNegativeWarning` remains non-fatal in the runner.
- Current unpushed hardening adds exact Wavelength terminal-failure
  reconciliation, paid-state crash recovery, single-use prepared payments, a
  tracked Signet deposit address for empty wallets, and bounded/consistent fee
  validation. Failed or pending money cannot be rewritten as settled.
- Consensus Commons now has three generated fictional property images, an
  accessible gallery/lightbox, clickable stay amenities, an idempotent
  `CONSENSUS10` demo promotion, and honest marketing-consent copy. A fresh
  desktop/390px production-preview pass found no broken images, horizontal
  overflow, or browser warnings.
- Fresh judge walkthrough passed on the production preview: homepage, fictional
  inventory, date picker, guest booking form, authenticated guest chat,
  consensus timeline, receipt/reward card, and desktop/mobile layouts. The
  390px checks had no horizontal overflow or browser warnings.
- Three editable 1600×900 judge-opening infographics and matching jot-note
  scripts are under `docs/demo/judge-opening/`. Variation A, Consensus
  Convergence, is the recommended 30–40 second opener.
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
- With Murphy's explicit live-acceptance approval, the current functions were
  uploaded using `convex dev --once` only to the isolated development
  deployment. No production deployment was touched.
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
  remained pending. It was not retried or reported paid; its OpenStays request
  is now expired and that payment hash must not be reused.
- The production browser build now starts exactly one embedded Wavelength
  engine, serves all required runtime assets with cross-origin isolation, and
  has no horizontal overflow at the tested mobile viewport. Confirmation query
  parameters use `confirmation` because Convex Auth consumes the reserved
  OAuth `code` parameter.
- A persistent browser guest wallet was created under
  `%LOCALAPPDATA%\OpenStays\wavelength-browser-guest-demo`; its 24-word
  recovery material and Chrome profile are protected by a user-only ACL. Its
  funded recovery material was never printed, but the reused local demo
  password appeared in the automation trace and must be rotated before public
  use. It creates/unlocks correctly. Diagnostic reward
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
- A second browser-driven acceptance completed from a fresh public booking
  through both directions of the signet flow. Booking `OS-X2A4RP` charged the
  fictional CA$0.21 reservation as a 1,000-sat signet demo quote, confirmed only
  after the merchant receive completed, produced a receipt accepted by four OTS
  calendars, and paid one 1,000-sat reward back to the same guest wallet. The
  wallet moved from 1,000 to 0 to 1,000 sats across reloads. Both booking and
  reward rows have exactly one authoritative settlement/attempt.
- Wavelength booking quotes now floor at 1,000 signet sats to match the public
  operator while keeping the fiat booking amount authoritative. Queue claims
  mark expired requests expired and cancelled/non-hold requests failed before
  returning payable work, preventing stale 210-sat requests from blocking the
  bridge. The first incompatible unpaid test hold was cancelled normally with
  $0 paid and $0 refunded.
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
  calendars. The normal background upgrade later verified a Bitcoin attestation
  at block 959197 and advanced it to `bitcoin_anchored`; both browser downloads
  round-tripped successfully. The newer `OS-X2A4RP` receipt has now also
  matured to a verified Bitcoin attestation at block 959201.
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
- Wavelength booking invoices use `max(1,000, ceil(amountCents × rate / 100))`
  so every public-signet request is at least 1,000 sats; the stored fiat amount
  remains the authoritative reservation payment amount.
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

- Upload the current branch functions and seed only to the isolated
  `affable-wildcat-206` deployment after the explicit configuration gate is
  approved. Its current server state does not yet include the new failure route
  or `CONSENSUS10`.
- Configure isolated-demo Convex Auth (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`)
  and bootstrap a demo owner; staff account creation currently fails closed
  because those keys are intentionally absent.
- Keep the fictional sample receipt labeled pending. Use either genuinely
  anchored live receipt (`OS-A52VVM` at block 959197 or `OS-X2A4RP` at block
  959201) to demonstrate final Bitcoin verification.
- Use `docs/demo/judge-opening/variation-a-consensus-convergence.png` as the
  recommended opening visual; B and C remain ready alternatives.
- Rehearse the three-minute judge path once with Murphy operating the UI; the
  automated production-like desktop/mobile flow and live signet reward payout
  are complete.
- Do not inspect or use CBAP credentials/deployments.
- `codex/btcpp-consensus-mvp` has been fast-forwarded into and pushed on `main`;
  production deployment remains separately controlled.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
