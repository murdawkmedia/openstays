# OpenStays status

**Updated: 2026-07-22 — Consensus Commons hackathon MVP, local branch.**

## Current state

- Worktree: `openstays-btcpp-consensus-mvp`
- Branch: `codex/btcpp-consensus-mvp`
- `main` remains untouched; no push, successful deploy, or merge has been performed.
- During development, `npx convex codegen` unexpectedly entered Convex's
  function-upload path, then exited non-zero on local TypeScript errors. No
  successful deployment was reported and it was not run again; verify the
  selected dev deployment before any live acceptance.
- Competition baseline: annotated local tag
  `btcpp-toronto-2026-pre-kickoff` points to `5c3038e`; see
  `HACKATHON_BASELINE.md` for the pre-existing capability disclosure.
- Current full gates: 350 root tests and 64 CLI tests passed; root and CLI
  typechecks/builds plus the documentation build passed. The four-case
  desktop/mobile browser smoke also passed against the live fictional booking.
  The existing Node `TimeoutNegativeWarning` remains non-fatal in the runner.
- Added: manual provider refund cases, authoritative Zaprite reconciliation,
  Wavelength signet bridge/wallet, booking chat and alerts, staff operations,
  fictional Consensus Commons seed/branding, and a consensus timeline.
- Post-kickoff addition: immutable privacy-safe OpenTimestamps consensus
  receipts, authenticated local OTS worker endpoints/CLI, guest proof downloads,
  and a one-time exact-210-sat Wavelength signet reward with prepared-send and
  completed-activity reconciliation.
- OpenStays Mail now renders into a durable provider-neutral Convex queue and
  delivers through an authenticated generic SMTP worker. Resend and log-only
  remain supported; the pinned Mailpit profile is loopback capture only.
- Live local runtime: isolated Murdawk Convex dev deployment
  `affable-wildcat-206`, seeded demo inventory, Vite on `127.0.0.1:5173`,
  and a loopback-only Wavelength v0.1.0 signet daemon plus merchant bridge.
- The dedicated Consensus Commons Zaprite API key/custom checkout are configured
  on the isolated deployment with the OpenStays webhook. Zaprite is visible as
  the hosted provider. No order or charge was created. Confirm the checkout has
  the Test Payment connection before live acceptance, and rotate the session-
  shared key after the hackathon.
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
- The pinned official OpenTimestamps client is installed in WSL because its
  `python-bitcoinlib` dependency could not discover the native Windows Python
  OpenSSL 3 DLL. The CLI now has a tested WSL invocation/path adapter while
  preserving native execution by default.
- `docs/demo/consensus-receipt-sample.json.ots` is a real proof for the
  fictional sample hash
  `2bebb8b87c3d27c9a875beae80355a1fde04c6bf66566f60740e4bdbddf132ba`.
  Four public calendars accepted it; all attestations are currently pending,
  not Bitcoin-anchored.
- Mailpit is running on loopback SMTP `127.0.0.1:1025` and inbox
  `127.0.0.1:8025`; the local mail bridge targets only the isolated dev
  deployment. Live acceptance captured exactly one fictional confirmation and
  one fictional staff message alert, both with code, HTML, text, and links.
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
- Each submitted receipt permits one exact 210 signet-sat reward. The bridge
  checks the prepared payment, fee cap, invoice, payment hash, and completed
  merchant activity before recording payment.
- Channex is adapter-ready but not connected/certified.
- Convex owns email rendering, deduplication, queue leases, retries, and audit;
  SMTP/Resend are replaceable delivery adapters. Public demo mode stays
  log-only by design.
- No customer data, credentials, production rail, push, deploy, or merge is in
  scope without explicit approval.

## Remaining acceptance

- Create a fresh `OTS_BRIDGE_TOKEN` only after Murphy's explicit credential
  approval, write it to the dedicated Murdawk Convex project, and start the
  local `openstays ots-bridge` worker.
- Stamp the fictional sample receipt early; show it honestly as submitted while
  pending, and upgrade it before the expo if public calendars have anchored it.
- Wait for the pending Wavelength payment hash to reach an authoritative
  terminal state, then use a fresh hold/invoice for the next acceptance. Do not
  replay the expired invoice. The merchant is funded; no mainnet wallet,
  invoice, or payment is in scope.
- Deploying the current Convex functions to the isolated dev deployment is
  still an explicit user gate. Until then, that stale backend has no receipt or
  reward routes, so the post-kickoff manage-booking flow cannot be accepted
  end-to-end against it.
- Confirm the dedicated Zaprite checkout has its Test Payment connection, then
  run the first sandbox order/payment/reconciliation acceptance.
- Create/select the dedicated Murdawk Media Convex project later. Do not inspect
  or use CBAP credentials/deployments.
- Murphy accepts the demo; only then consider a separately approved local merge.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
