# OpenStays 1,000-sat consensus reward design

**Date:** 2026-07-22

**Status:** Approved design

**Scope:** Local `codex/btcpp-consensus-mvp` hackathon branch only

## Outcome

The permanent Consensus Commons reward is exactly 1,000 Wavelength signet
sats. This replaces the 210-sat reward invariant everywhere while leaving the
fictional CA$0.21 Zaprite booking price unchanged.

Wavelength's public signet operator currently advertises a 1,000-sat minimum
vTXO amount. A 1,000-sat receive uses the standard Lightning receive path and
has been verified locally to return an invoice immediately. A 210-sat receive
uses the separate sub-dust `CreateCredit` path, which currently times out on
the hosted signet service. The hackathon flow will use the reliable documented
minimum rather than depend on an unavailable alpha service path.

## Reward invariant

- Every newly created reward has `network: "signet"` and
  `satsAmount: 1000`.
- Guest invoice submission, bridge claiming, prepared-send validation,
  dispatch, activity reconciliation, and settlement reporting must all agree
  on exactly 1,000 sats.
- An amountless, expired, non-signet, or non-1,000-sat invoice is rejected
  before the merchant moves funds.
- Duplicate reports remain no-ops, and one receipt can still produce at most
  one paid reward.
- `WAVELENGTH_REWARD_MAX_FEE_SATS` remains a separate fee ceiling and defaults
  to 210 sats. It does not alter the 1,000-sat principal.

## Existing reward rows

An explicit, idempotent maintenance operation may upgrade an existing
210-sat reward only when its status is `eligible`, `expired`, or `failed` and
it has no active invoice or authoritative settlement. It must clear any stale
invoice, lease, failure, and payment-attempt fields while preserving the
booking, receipt, and audit timestamps needed to explain the transition.

Rows in `invoice_ready`, `paying`, or `paid` are never rewritten. No such row
currently exists in the isolated demo deployment; its sole live acceptance
reward is still `eligible` and can be safely upgraded.

## Guest and staff experience

- Guest calls to action, progress states, success messages, timeline entries,
  email copy, and semantic announcements say **1,000 signet sats**.
- Staff Operations displays the exact 1,000-sat principal separately from the
  configured fee ceiling.
- Documentation explains that the amount matches Wavelength's current public
  signet minimum and that signet sats have no monetary value.
- The pitch keeps the simple story: a timestamped consensus receipt unlocks a
  one-time 1,000-sat test reward into the guest's self-custodial wallet.
- The OpenTimestamps proof may eventually anchor to Bitcoin mainnet; the
  Wavelength reward remains signet-only. The networks are not conflated.

## Failure handling

- OpenStays never silently falls back to 210 sats or increases an invoice after
  the guest creates it.
- If the standard 1,000-sat receive path is unavailable, the reward remains
  eligible and the UI reports a retryable service failure without recording a
  payout.
- Insufficient merchant balance, excessive fees, mismatched prepared payment,
  expired invoice, or incomplete outgoing activity cannot mark the reward
  paid.
- Existing lease recovery, invoice replacement, and authoritative settlement
  rules remain unchanged.

## Verification

- Replace exact-210 assertions with exact-1,000 assertions across Convex,
  bridge, browser, documentation, and pitch tests.
- Add boundary tests rejecting 999 and 1,001 sats at invoice submission and
  bridge settlement.
- Test the maintenance operation against each allowed and forbidden status,
  including replay and a row with an active invoice.
- Confirm the browser wallet creates an amount-bearing 1,000-sat signet BOLT11
  invoice and the merchant bridge prepares, sends, and reconciles exactly
  1,000 sats.
- Run all existing root and CLI tests, typechecks, and builds, plus the browser
  acceptance flow.
- Keep Zaprite reconciliation, refunds, messaging, OpenTimestamps, booking
  conflicts, Stripe/Square, and Channex safety tests green.

## Alternatives considered

1. **Configurable reward amount.** Rejected because runtime variability weakens
   the invariant and adds avoidable demo configuration risk.
2. **Dual 210/1,000 support.** Rejected because it complicates validation and
   leaves the judge-facing flow dependent on Wavelength's unavailable sub-dust
   credit service.
3. **Keep 210 and retry indefinitely.** Rejected because retries cannot repair
   the hosted `CreateCredit` service and would consume a material part of the
   three-minute judging window.

## Boundaries

This design does not authorize a push, merge, production deployment, mainnet
Wavelength use, CBAP access, credential handling, or changes to the CA$0.21
Zaprite booking price. Updating the already approved isolated Convex
development deployment remains a separate execution step after local changes
and verification.
