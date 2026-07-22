# OpenStays status

**Updated: 2026-07-22 — Consensus Commons hackathon MVP, local branch.**

## Current state

- Worktree: `openstays-btcpp-consensus-mvp`
- Branch: `codex/btcpp-consensus-mvp`
- `main` remains untouched; no push, deploy, or merge has been performed.
- Baseline: 292 root tests and 51 CLI tests passed; both compile/build sets passed.
- Final automated gates: 338 root tests and 59 CLI tests passed; root and
  CLI typechecks/builds plus the documentation build passed. Existing Node
  `TimeoutNegativeWarning` remains non-fatal in the test runner.
- Added: manual provider refund cases, authoritative Zaprite reconciliation,
  Wavelength signet bridge/wallet, booking chat and alerts, staff operations,
  fictional Consensus Commons seed/branding, and a consensus timeline.
- OpenStays Mail now renders into a durable provider-neutral Convex queue and
  delivers through an authenticated generic SMTP worker. Resend and log-only
  remain supported; the pinned Mailpit profile is loopback capture only.
- Live local runtime: isolated Murdawk Convex dev deployment
  `affable-wildcat-206`, seeded demo inventory, Vite on `127.0.0.1:5173`,
  and a loopback-only Wavelength v0.1.0 signet daemon plus merchant bridge.
- Signal21's organization-scoped Zaprite API key/custom checkout are configured
  on the isolated deployment with a dedicated OpenStays webhook. No order or
  charge was created. Confirm the reused checkout has the Test Payment plugin,
  or create a dedicated sandbox checkout, before live acceptance.
- Wavelength merchant recovery material is stored outside the repository under
  `%LOCALAPPDATA%\OpenStays\wavelength-signet` with user-only ACLs.
- Mailpit is running on loopback SMTP `127.0.0.1:1025` and inbox
  `127.0.0.1:8025`; the local mail bridge targets only the isolated dev
  deployment. Live acceptance captured exactly one fictional confirmation and
  one fictional staff message alert, both with code, HTML, text, and links.
- Nodemailer was advanced to 9.0.3 after the original pin surfaced a direct
  high-severity advisory. CLI audit now has no Nodemailer finding; one high
  (`fast-uri`) and two moderate findings remain transitive through the existing
  MCP SDK dependency tree and need an upstream-compatible update.

## Decisions in force

- Zaprite webhook content is untrusted; authenticated fetch is authoritative.
- Zaprite/Wavelength refunds remain paid until staff records an external
  reference; no premature guest success email.
- Wavelength signet remains the fallback. The isolated mainnet profile is
  opt-in, external-wallet-only, and hard-capped at exactly 210 sats; its
  network and amount are snapshotted and rechecked by Convex and the bridge.
- Channex is adapter-ready but not connected/certified.
- Convex owns email rendering, deduplication, queue leases, retries, and audit;
  SMTP/Resend are replaceable delivery adapters. Public demo mode stays
  log-only by design.
- No customer data, credentials, production rail, push, deploy, or merge is in
  scope without explicit approval.

## Remaining acceptance

- Guarded Wavelength mainnet code, external-wallet UI, and fail-closed startup
  scripts are implemented locally. No mainnet daemon, wallet, invoice, or
  payment has been created.
- Before any real sats move, confirm the mainnet operator/swap endpoints and
  210-sat receive support with Murphy's Lightning Labs contact, then stop for a
  fresh payment approval.
- Execute the complete browser/demo flow against the running local stack.
- Create the dedicated Zaprite sandbox/Test Payment checkout before its first
  acceptance run; the temporary Signal21 configuration must then be replaced.
- Murphy accepts the demo; only then merge locally into `main`.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
