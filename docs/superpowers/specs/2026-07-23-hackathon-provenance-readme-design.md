# Hackathon provenance README design

**Date:** 2026-07-23  
**Scope:** `codex/btcpp-consensus-mvp` documentation only

## Goal

Make the first screen of the branch README clearly distinguish OpenStays'
pre-existing booking platform from the work added during Bitcoin++ Toronto
2026. Judges should understand the provenance without reading the full project
history or mistaking the entire platform for a hackathon build.

## Design

Replace the current introductory hackathon callout with a compact section titled
**What existed vs. what we built at Bitcoin++**.

The section will contain:

- a short sentence explaining that OpenStays existed before the event and the
  branch adds the Consensus Receipt + Reward contribution;
- a two-column comparison table:
  - **Before Bitcoin++:** conflict-proof booking, payment abstractions,
    Zaprite reconciliation, messaging/email, manual refunds, staff operations,
    the fictional Consensus Commons shell, and the dormant Channex adapter;
  - **Built at Bitcoin++:** privacy-safe canonical receipts, OpenTimestamps
    proof submission and downloads, authoritative Wavelength reward settlement,
    the permanent 1,000-sat signet reward, and the judge-facing proof-and-reward
    experience;
- links to `HACKATHON_BASELINE.md`, baseline commit `5c3038e`, and the
  `btcpp-toronto-2026-pre-kickoff` tag;
- copyable `git diff` and `git log` commands for transparent verification;
- an explicit note that the hackathon rails are experimental and local-first.

The existing OpenStays product description will remain directly below this
section. No application behavior, runtime configuration, credentials,
deployment, or baseline history will change.

## Acceptance

- The distinction is visible without scrolling through the product README.
- The table does not claim pre-existing capabilities as hackathon work.
- The active reward is described as exactly 1,000 signet sats.
- Evidence links and comparison commands are correct.
- Markdown renders cleanly on GitHub.
