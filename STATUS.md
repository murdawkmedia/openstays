# OpenStays status

**Updated: 2026-07-22 — Consensus Commons hackathon MVP, local branch.**

## Current state

- Worktree: `openstays-btcpp-consensus-mvp`
- Branch: `codex/btcpp-consensus-mvp`
- `main` remains untouched; no push, deploy, or merge has been performed.
- Baseline: 292 root tests and 51 CLI tests passed; both compile/build sets passed.
- Final automated gates: 318 root tests and 53 CLI tests passed; root and
  CLI typechecks/builds passed. Existing Node `TimeoutNegativeWarning` remains
  non-fatal in the test runner.
- Added: manual provider refund cases, authoritative Zaprite reconciliation,
  Wavelength signet bridge/wallet, booking chat and alerts, staff operations,
  fictional Consensus Commons seed/branding, and a consensus timeline.

## Decisions in force

- Zaprite webhook content is untrusted; authenticated fetch is authoritative.
- Zaprite/Wavelength refunds remain paid until staff records an external
  reference; no premature guest success email.
- Wavelength is signet-only and separate from Zaprite; the demo quote is
  snapshotted per request.
- Channex is adapter-ready but not connected/certified.
- No customer data, credentials, production rail, push, deploy, or merge is in
  scope without explicit approval.

## Remaining acceptance

- Start local Convex and execute the browser/demo flow.
- Operator-approved Zaprite sandbox and Wavelength daemon live acceptance.
- Murphy accepts the demo; only then merge locally into `main`.

See [docs/hackathon-mvp.md](./docs/hackathon-mvp.md).
