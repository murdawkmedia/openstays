# Local Demo Wallet Preflight Design

**Date:** 2026-07-23  
**Status:** Awaiting final review  
**Scope:** Local Bitcoin++ judge demo only

## Goal

Make the three-minute Consensus Commons walkthrough independent of on-chain
Wavelength boarding while preserving real, self-custodial Signet payments.
One reusable browser wallet should start each judging session with enough
spendable balance for twelve 1,000-sat booking attempts.

## Chosen approach

Add a localhost-only demo-wallet setup mode to the existing Wavelength browser
wallet. It is reached through an explicit setup query parameter and is never
shown on non-loopback hosts or in the normal guest booking flow.

The setup mode:

- uses the existing persisted, self-custodial browser wallet;
- creates one amount-bearing 12,000-sat Wavelength Lightning receive invoice;
- shows the invoice and funding status without transmitting wallet passwords,
  recovery words, or keys;
- refreshes balance while funding is pending;
- reports **Demo wallet ready** once at least 12,000 sats are spendable;
- shows the conservative number of funded 1,000-sat attempts.

The existing 2,500-sat on-chain deposit may board later, but it is not counted
as demo-ready until Wavelength reports it as spendable.

## Merchant funding

Funding is a one-time local preflight operation, not part of the judge flow.
The existing loopback merchant daemon pays the 12,000-sat invoice only after
the operator verifies:

- the daemon is on Signet;
- the BOLT11 invoice is amount-bearing and unexpired;
- the principal is exactly 12,000 sats;
- the prepared rail is off-chain, never on-chain;
- the quote has known totals;
- principal plus fee equals total outflow;
- the fee is no more than 210 sats.

The send uses the daemon's single-use prepared intent. Funding is considered
complete only after the outgoing merchant activity reports complete and the
browser wallet reports at least 12,000 spendable sats.

## Three-minute judge flow

Before the first judge group:

1. Open and unlock the prepared browser wallet.
2. Confirm the green **Demo wallet ready** state.
3. Confirm the merchant, Wavelength bridge, OTS worker, and mail bridge are
   healthy.

During each judging session:

1. Create a fictional CA$0.19 reservation.
2. Pay the real 1,000-sat Signet merchant invoice from the prepared wallet.
3. Show the authoritative booking confirmation and Consensus Receipt.
4. Claim the real 1,000-sat Signet reward back to the same wallet.

A successful cycle replenishes the guest principal. The 12,000-sat starting
balance also permits twelve booking attempts if reward settlement is delayed.

## Failure handling

- Never label pending inbound sats as spendable.
- Never auto-pay a newly generated setup invoice.
- Reject wrong amount, network, rail, expiry, unknown totals, inconsistent
  totals, and excessive fees before moving merchant funds.
- Do not retry a consumed send intent or invoice.
- If hosted Signet or the Wavelength operator stalls during judging, use an
  already confirmed booking and genuinely anchored receipt as the honest
  fallback; do not fabricate settlement.

## Verification

- Unit tests pin the localhost guard, 12,000-sat target, and funded-attempt
  calculation.
- UI tests pin the setup-only controls and ready state.
- Root and CLI tests, typechecks, builds, and documentation build remain green.
- Live acceptance creates the invoice, verifies the merchant quote, pays once,
  reconciles the completed activity, and observes at least 12,000 spendable
  sats in the browser wallet.
- Desktop and mobile checks confirm no console errors or horizontal overflow.

## Exclusions

- No production deployment, mainnet, faucet service, automatic public subsidy,
  guest account, seed export, or reusable server-side wallet credential.
- No changes to authoritative booking, refund, receipt, or reward settlement
  rules.
