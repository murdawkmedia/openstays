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
- Final automated gates: 344 root tests and 64 CLI tests passed; root and CLI
  typechecks/builds plus the documentation build passed. The existing Node
  `TimeoutNegativeWarning` remains non-fatal in the test runner.
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
  The guest demo wallet remains intentionally unfunded. A live 210-sat invoice
  could not yet be created because the public signet operator's `CreateCredit`
  RPC timed out for both wallets; retry when the service recovers.
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
- Retry invoice creation after the Wavelength signet operator's `CreateCredit`
  RPC recovers, then execute the prepared, fee-capped 210-sat merchant-to-guest
  reward acceptance. The merchant is funded; no mainnet wallet, invoice, or
  payment is in scope.
- Execute the complete browser/demo flow against the running local stack.
- Confirm the dedicated Zaprite checkout has its Test Payment connection, then
  run the first sandbox order/payment/reconciliation acceptance.
- Create/select the dedicated Murdawk Media Convex project later. Do not inspect
  or use CBAP credentials/deployments.
- Murphy accepts the demo; only then consider a separately approved local merge.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
