# OpenStays 210-sat mainnet and open mail design (superseded)

> Historical pre-kickoff design only. The active hackathon implementation is
> signet-only; it cannot create, claim, or process a Wavelength mainnet request.

**Date:** 2026-07-22

**Status:** Approved design; implementation not yet started

**Scope:** Consensus Commons hackathon branch only

## Outcome

The judge demo will settle one fictional Consensus Commons reservation with a
real 210-sat Lightning payment received by Wavelength. OpenStays will also gain
a provider-neutral email path that captures messages locally in Mailpit and can
later deliver through any SMTP server. Zaprite remains a separate sandbox rail.

The mainnet path is deliberately narrow. It is not a general-purpose mainnet
wallet switch and does not authorize production deployment or balances beyond
the demo amount.

## Decisions

### Real-sat demonstration

- Wavelength mainnet is the merchant/receiver rail.
- The payable amount is exactly 210 sats. The mainnet demo refuses any other
  amount at request creation, invoice publication, settlement, and UI payment
  presentation.
- Consensus Commons uses a clearly disclosed hackathon peg of CAD 0.21 to
  210 sats. This is a fixed demonstration price, not a live exchange quote.
- The existing signet daemon, wallet, data, and configuration remain intact as
  a fallback. Mainnet uses a different data directory, wallet, password,
  recovery file, bridge token, and Convex configuration.
- OpenStays never receives a Wavelength seed or wallet password.
- The merchant daemon remains loopback-only with TLS and macaroon protection.
  Mainnet requires Wavelength's explicit `--allow-mainnet` guard and never uses
  `--allow-insecure-mainnet`.
- Before any wallet is funded or invoice is paid, the operator's Wavelength
  contact should review the selected public operator/swap endpoints and confirm
  that a 210-sat receive is supported.
- Invoice creation is tested before real money is sent. If the operator rejects
  210 sats because of a minimum, OpenStays reports the constraint and does not
  silently increase the amount.
- A normal external Lightning wallet pays the BOLT11 invoice for the mainnet
  demo. The embedded Wavelength browser wallet remains available for the signet
  fallback; funding a new browser mainnet wallet is unnecessary scope and risk.

### Settlement authority

The authenticated local bridge remains the only Wavelength settlement
authority. It may confirm a booking only when all of the following match the
stored request:

- request and booking identifiers;
- the exact BOLT11 invoice;
- a completed receive activity and payment hash;
- mainnet as the reported network; and
- exactly 210 sats.

Retries and duplicate settlement reports are no-ops. A conflicting amount,
network, invoice, or activity opens an operational error and cannot confirm the
booking. Refunds remain manual and require an external Lightning reference.

### Zaprite boundary

Zaprite remains an independent sandbox flow. The operator will create an
`OpenStays Consensus Commons Sandbox` organization, enable Test Payment, and
create a dedicated API checkout/key. Credentials from another project are
temporary local configuration only and are replaced before the first live
Zaprite acceptance run. OpenStays should remind the operator at that blocker.

## Mainnet components and flow

1. Staff enables the explicit local hackathon mainnet profile.
2. OpenStays creates one Wavelength request with `network: mainnet`,
   `satsAmount: 210`, the CAD 0.21 demo peg, and a short expiry.
3. The authenticated bridge claims the request and asks the loopback merchant
   daemon for a 210-sat Lightning receive invoice.
4. OpenStays displays the invoice, QR code, real-money warning, network, amount,
   and expiry. It never initiates payment automatically.
5. The operator pays from a separate external Lightning wallet.
6. The bridge observes completed receive activity and reports the matching
   invoice, hash, network, and amount.
7. Convex idempotently records the payment and confirms the booking. The
   consensus timeline explains why settlement was accepted.

Mainnet is disabled by default. Starting it requires a dedicated script with
an explicit acknowledgement argument. The script performs preflight checks for
the separate data directory, protected recovery files, loopback listeners,
TLS/macaroons, exact amount cap, and configured operator endpoints.

## OpenStays Mail

### Chosen approach

OpenStays will own email composition, queueing, idempotency, and audit logs but
will not implement an internet mail transfer agent. A local mail bridge provides
the open transport boundary:

- **Mailpit** is the default local SMTP destination and judge-facing inbox.
- **Generic SMTP** is supported by changing bridge configuration, without
  changing OpenStays application code.
- **Resend** remains an optional HTTPS provider for existing deployments.
- **Postal** is documented as a future self-hosted SMTP/MTA option, not operated
  as part of the hackathon.

This avoids locking OpenStays to Resend while also avoiding the DNS, reputation,
bounce, abuse, and port-25 operations of building a deliverability service.

### Mail flow

1. A booking event writes one idempotent email log with rendered subject, HTML,
   text, recipient, and provider disposition.
2. In `mail_bridge` mode, an authenticated local CLI command polls a bounded
   `/mail-bridge/pending` endpoint and claims queued messages.
3. The CLI sends through configured SMTP. For the local demo this is Mailpit on
   loopback, so no message leaves the machine.
4. The CLI reports delivery or a sanitized failure. Convex records the attempt,
   external message ID when available, and next retry time.
5. Claims expire safely after a worker crash. Replays use the email log's stable
   idempotency key and cannot create a second logical notification.

The bridge token never reaches the browser. SMTP passwords stay in the local
bridge process and never enter Convex or the repository.

## Interfaces and configuration

### Wavelength

- Add `network: "signet" | "mainnet"` to Wavelength requests and bridge
  reports.
- Add a fixed mainnet configuration value of 210 sats. It is validated against
  a compiled maximum of 210 for the hackathon profile.
- Split startup into explicit signet and guarded mainnet scripts.
- Preserve the existing bridge bearer authentication and add network matching.

### Email

- Add an `EmailProvider` interface with `resend`, `mail_bridge`, and `log_only`
  implementations/dispositions.
- Add authenticated endpoints for claiming email work and reporting results.
- Add `openstays mail-bridge` with SMTP host, port, TLS, username, password,
  sender, poll interval, and Mailpit-local defaults.
- Add a pinned local Mailpit startup helper and keep its generated binary/data
  outside Git.

## Failure handling

- Mainnet preflight failure prevents daemon/bridge startup.
- A non-210-sat request or settlement is rejected before any booking mutation.
- An expired invoice remains unpaid; late completed money creates a manual
  operational/refund case rather than resurrecting a booking.
- Bridge or daemon downtime leaves requests pending and retryable.
- SMTP failures remain queued with bounded exponential retry and sanitized
  diagnostics. A notification is never marked delivered before the bridge
  reports success.
- Mailpit mode is visibly labelled local capture, not external delivery.

## Verification

### Automated

- Mainnet is disabled by default and requires explicit acknowledgement.
- Exact 210-sat request/invoice/settlement matching and rejection of 209/211.
- Network mismatch, replay, expiry, late settlement, forged bridge report, and
  manual-refund behavior.
- Existing signet tests and Stripe/Square/Zaprite behavior remain green.
- Mail claim authentication, bounded claiming, lease expiry, retry, replay,
  HTML/text rendering, opposite-party alerts, and SMTP error sanitization.
- Mailpit integration test confirms both guest and staff messages appear once.
- Full root and CLI test, typecheck, and build gates.

### Live acceptance

1. Lightning Labs contact reviews Wavelength mainnet endpoints and 210-sat
   support.
2. Start the isolated mainnet daemon without funding it and create a 210-sat
   invoice.
3. Fund/pay only what the reviewed flow requires, then observe authoritative
   210-sat settlement and booking confirmation.
4. Complete a guest/staff chat round trip and inspect both rendered emails in
   Mailpit.
5. Create the dedicated Zaprite sandbox resources, replace any temporary
   credentials, and run simulated Zaprite reconciliation.

No push, public deployment, local merge, mainnet amount above 210 sats, or
production customer configuration is included.
## Alternatives considered

1. **Keep Wavelength on signet and use real Zaprite only.** Safest, but rejected
   because a Lightning Labs collaborator is available and the real Wavelength
   integration strengthens the demo.
2. **Fund both embedded guest and merchant Wavelength wallets on mainnet.** More
   visually complete but adds seed, funding, liquidity, and browser-runtime risk
   with no necessary consensus benefit.
3. **Run Postal immediately or build an MTA.** More self-hosted, but excessive
   for the hackathon. The chosen SMTP bridge preserves that future option.
