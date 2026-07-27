# OpenStays Public Live Payment Rails Design

Date: 2026-07-26
Status: Approved design

## Goal

Extend the fictional Consensus Commons public showcase so visitors can exercise
two real payment integrations:

- contribute exactly CA$1 through a production Zaprite hosted checkout; or
- pay exactly 1,000 signet test sats through a self-custodial Wavelength browser
  wallet.

Either authoritative settlement confirms a fictional reservation, creates a
privacy-safe OpenTimestamps Consensus Receipt, and permits one 1,000-signet-sat
reward claim. The public experience must never imply that lodging or another
accommodation service is being purchased.

## Rail matrix

| Rail | Purpose | Network | Authority | Funds | Finality |
| --- | --- | --- | --- | --- | --- |
| Zaprite contribution | Confirm the fictional booking through a hosted production checkout | Provider-selected production payment rail | OpenStays fetches the exact Zaprite order with its server-held API key | Real CA$1 contribution | Confirmed only for an exact paid/complete order |
| Wavelength booking payment | Exercise the self-custodial booking flow | Bitcoin signet | Authenticated merchant bridge plus exact completed receive activity | 1,000 signet test sats supplied by the visitor | Confirmed only after completed receive reconciliation |
| OpenTimestamps receipt | Prove the privacy-safe canonical booking commitment existed | Public calendars eventually anchor into Bitcoin mainnet | Exact canonical bytes, matching `.ots` proof, and verified attestation | No wallet required | Submitted, pending Bitcoin confirmation, or Bitcoin anchored |
| Wavelength reward | Return a one-time project reward after either paid rail | Bitcoin signet | Eligibility policy plus authenticated merchant bridge and completed send activity | Exactly 1,000 signet test sats from the capped merchant wallet | Paid only after completed outgoing reconciliation |

Signet settlement and OpenTimestamps Bitcoin-mainnet anchoring are separate
networks and claims.

## Public disclosure and consent

The property, room, stay dates, and reservation are fictional. Before a visitor
can create either live payment request, they must actively accept copy with
substantially this meaning:

> Consensus Commons is a fictional property created to demonstrate OpenStays.
> No accommodation, reservation, or other lodging service is being purchased.
> Your CA$1 Zaprite payment is a voluntary contribution supporting continued
> development of the open-source OpenStays project. It is not tax-deductible,
> and no charitable receipt will be issued. You may request a refund through
> the booking-management page. Wavelength payments and rewards use valueless
> signet test sats.

The consent version, acceptance time, booking, and selected rail are recorded.
Marketing consent remains independent and optional.

The existing simulated payment remains available as an explicitly non-paying
way to explore the product. Simulated bookings do not qualify for a signet
reward.

## Architecture

### Cloudflare Pages

Cloudflare Pages continues to serve the React application. The public build:

- includes the version-matched Wavelength WASM and worker runtime;
- serves COOP and COEP headers on every wallet route;
- exposes no provider, bridge, SMTP, wallet, backup, or signing secret;
- renders live rail availability from authoritative backend health; and
- keeps staff operations out of the public navigation and public bundle.

The visitor's Wavelength wallet runs in browser OPFS using
`defaultConfig("signet")`. Seeds and passwords never leave the browser. A
visitor brings their own signet sats; OpenStays is not a public faucet.

### Convex

The dedicated `murdawkmedia/openstays-consensus` deployment remains the
authoritative system for:

- booking holds and conflict prevention;
- payment and refund ledgers;
- Zaprite order creation and reconciliation;
- Wavelength requests and settlement;
- immutable Consensus Receipts and proofs;
- reward eligibility and payment state;
- email rendering, leases, and audit; and
- bridge health, limits, and operator diagnostics.

Production Zaprite credentials belong in Convex environment secrets, not in
Cloudflare Pages. Required values include a dedicated production API key,
custom checkout ID, webhook URL secret, and an explicit provider enable flag.
The Zaprite organization and checkout must be dedicated to OpenStays rather
than reused from another product.

`DEMO_MODE=true` is not compatible with live payments because it forces
simulated behaviour and log-only email. Add an explicit live-showcase mode
whose fictional inventory can coexist with real contributions without
weakening payment authority.

### Cloudflare Worker, Durable Object, and Container

A dedicated Cloudflare Worker controls exactly one Durable Object and one
merchant operations container. The public never receives a route to the raw
Wavelength daemon.

The container runs supervised, independently restartable processes for:

- the Wavelength signet merchant daemon;
- the authenticated OpenStays Wavelength bridge;
- the stateless official OpenTimestamps worker; and
- the provider-neutral SMTP delivery bridge.

The Worker handles health checks, Turnstile verification, opaque eligibility
tokens, container lifecycle, and operator-only diagnostics. Container and
bridge endpoints require separate scoped secrets. CORS is restricted to the
production showcase origin.

Start with Cloudflare's `basic` container shape. The instance stays warm for
payment responsiveness; a scheduled health task renews activity while the
service is enabled. A stale heartbeat automatically makes Wavelength and reward
actions unavailable while leaving Zaprite and the simulated tour operational.

## Merchant wallet persistence

Cloudflare Container disk is disposable and is never the only copy of wallet
state.

- Bootstrap the merchant wallet exactly once through an operator-only command.
- Keep the recovery words offline outside Cloudflare and outside the repository.
- Store the Wavelength data directory in the container only while running.
- After every wallet-changing operation, and at least once per minute while
  changes are pending, create an application-encrypted archive and upload it to
  a private R2 bucket.
- Upload a new immutable object first, verify its digest, then atomically
  advance a Durable Object manifest pointer.
- Retain the seven most recent verified archives.
- Restore and digest-check the newest archive before starting the daemon.
- Never create a replacement wallet automatically when restore fails.
- Keep the archive-encryption key separate from R2 and from the wallet database
  password.

The merchant wallet holds no more than the configured signet operating budget.
Loss of a current archive must fail closed and page the operator. Convex remains
the source of truth for whether a booking payment or reward was recorded; a
container restart never infers settlement from local intent alone.

## Zaprite flow

1. The guest creates a payable fictional hold and accepts the current
   contribution disclosure.
2. OpenStays creates an order for exactly 100 CAD cents with the booking's hold
   expiry, normalized guest details, dedicated custom checkout ID, receipt
   enabled, opaque metadata, and unique reconciliation ID.
3. The browser navigates to Zaprite's hosted checkout.
4. The redirect and webhook are treated only as prompts to refresh state.
5. Convex fetches the order using the API key and validates organization,
   order ID, unique ID, checkout ID, currency, amount, metadata, expiry, and
   provider status.
6. Exact `PAID` or `COMPLETE` orders confirm the booking. `PENDING`,
   `PROCESSING`, and `UNDERPAID` remain unconfirmed. `OVERPAID` confirms the
   expected CA$1 and opens an idempotent manual refund case for the excess.
7. Deterministic reconciliation event IDs make retries no-ops.

The Zaprite receipt and OpenStays reservation confirmation are separate
messages.

## Wavelength payment flow

1. The guest creates a payable hold, accepts the disclosure, and authenticates
   it with confirmation code plus normalized email.
2. The guest creates or restores a signet Wavelength wallet locally.
3. Convex snapshots an immutable exact 1,000-sat quote for the hold.
4. The merchant bridge creates one amount-bearing, expiring signet BOLT11
   invoice and binds it to the request and merchant receive activity.
5. The browser wallet prepares the send and shows principal, fee, balance, and
   expiry before confirmation.
6. The bridge confirms only a completed receive whose network, invoice,
   principal, request, activity, and payment hash all match.
7. Failed, expired, mismatched, or merely pending activity never confirms the
   booking. A consumed invoice is replaced rather than retried.

## Consensus Receipt and reward flow

Either authoritative paid rail confirms the fictional booking and idempotently
queues its immutable privacy-safe Consensus Receipt. The container's
OpenTimestamps worker verifies the canonical bytes and hash, submits the proof
to public calendars, and reports the proof to Convex. Submission unlocks the
reward; Bitcoin anchoring remains a later, separately verified status.

The guest explicitly claims the reward:

1. A Cloudflare Turnstile challenge succeeds.
2. The Worker issues a short-lived signed eligibility token bound to booking,
   action, normalized-email digest, browser-device digest, daily salted network
   digest, and expiry.
3. Convex verifies the token and checks that the payment was Zaprite or
   Wavelength, the receipt was submitted, no reward settled previously, and
   all limits permit another payout.
4. The browser wallet creates an amount-bearing invoice for exactly 1,000
   signet sats.
5. The merchant bridge prepares the send and verifies signet, invoice amount,
   expiry, off-chain rail, fee cap, reward, booking, and expected payment hash.
6. It dispatches a single-use intent and reports payment only after matching
   completed outgoing activity.

Invoice replacement is permitted only after expiry or definitive failure and
never after settlement.

## Abuse limits

A paid booking can exist without a reward. Reward availability is constrained
independently:

- deny a second reward when any matching normalized email, browser-device
  digest, or daily network digest has received one in the preceding 24 hours;
- require Turnstile for live payment-request creation and reward claims;
- default `WAVELENGTH_REWARD_DAILY_BUDGET_SATS` to zero when missing;
- initially configure a 12,000-sat daily ceiling;
- stop new claims when merchant spendable balance cannot cover principal plus
  the configured maximum fee; and
- keep every limit and enable flag change in an operator audit log.

The Worker never stores a raw IP address. It derives the network digest with a
rotating daily secret and passes only the signed opaque claim to Convex.

## Refunds

Zaprite and Wavelength use manual refunds.

- The guest requests a refund from the authenticated booking-management page.
- OpenStays creates one idempotent refund case and alerts the operator.
- The original payment remains paid while the case is open.
- Staff completes the external refund and records the Zaprite reference or
  Bitcoin transaction/payment identifier.
- Only then does OpenStays append the refund ledger and notify the guest that
  the refund completed.

The contribution disclosure promises a refund-request path, not instant or
automatic settlement.

## Retention and reset policy

The current destructive nightly demo reset is prohibited once real payments
are enabled.

- Nightly cleanup may remove expired unpaid holds and disposable simulated
  browsing state.
- It must never delete paid bookings, payment ledgers, contribution records,
  receipts, reward attempts, email audit, or refund cases.
- Guest name, phone, messages, and nonessential email data are purged 14 days
  after the fictional booking.
- Minimal financial records retain amount, currency, provider, opaque provider
  order/reference, status, timestamps, consent version, and refund audit.
- Seed repair remains idempotent and cannot overwrite a payment-linked record.

## Secrets and access boundaries

Cloudflare secrets:

- container/Worker bridge credentials;
- Wavelength wallet password;
- R2 archive-encryption key;
- Turnstile secret;
- eligibility-token signing key;
- SMTP credentials; and
- Convex bridge URLs/tokens needed by container workers.

Convex secrets:

- Zaprite production API key;
- Zaprite custom checkout ID;
- Zaprite webhook URL secret;
- bridge bearer tokens and eligibility verification key;
- provider enable flags and fixed amounts; and
- email-provider configuration that is not container-specific.

Browser-visible configuration contains only public URLs, site keys, fixed
display amounts, and non-secret feature state. Secrets, recovery words, wallet
passwords, raw IP addresses, and payment hashes do not enter documentation,
screenshots, analytics, or client logs.

Unrelated credentials, deployments, checkouts, and wallets
remain out of scope.

## Failure behaviour

- Zaprite remains independently usable when the operations container is down.
- Simulated exploration remains usable when all live rails are disabled.
- Stale bridge health hides Wavelength payment and reward controls.
- Missing secrets, zero daily budget, stale backups, failed Turnstile, expired
  eligibility, insufficient balance, excessive fees, or ambiguous provider
  state fail closed.
- Duplicate webhooks, bridge reports, sends, proof uploads, and refund
  completions are no-ops.
- The UI distinguishes requested, pending, paid, failed, refund requested,
  proof submitted, pending Bitcoin confirmation, Bitcoin anchored, reward
  eligible, and reward paid.
- No guest receives a success message before the corresponding authority has
  recorded the state.

Separate runtime flags can immediately disable Zaprite, Wavelength payments,
or rewards without publishing a new frontend bundle.

## Observability and operations

Alert on:

- stale container or bridge heartbeat;
- failed container start or wallet restore;
- R2 backup age or digest mismatch;
- Zaprite reconciliation mismatch or repeated provider errors;
- Wavelength pending activity beyond its expected window;
- low merchant signet balance;
- reward budget exhaustion or abuse-limit spikes;
- failed OpenTimestamps work; and
- newly opened or aging refund cases.

Logs contain opaque internal IDs and normalized status categories only. The
operator runbook covers funding the capped signet wallet, pausing each rail,
restoring R2 state, rotating secrets, resolving refunds, and reconciling a
container restart.

## Verification

### Automated

- Dependency-security preflight must resolve every critical or high advisory
  that affects the runtime application before live payment credentials are
  configured. Development-only advisories require an explicit documented
  exposure decision and must never leave a development server publicly
  reachable.
- Disclosure version and required-consent tests.
- Fixed CA$1 Zaprite and exact 1,000-sat Wavelength enforcement.
- Every Zaprite status, redirect forgery, webhook replay, mismatched
  amount/currency/metadata, underpayment, overpayment, late payment, and API
  failure.
- Wavelength wrong-network, amountless, wrong-amount, expired, consumed,
  replayed, pending, failed, insufficient-balance, and excessive-fee invoices.
- Reward eligibility, 24-hour limits, daily global budget, Turnstile failure,
  forged/expired token, invoice replacement, crash recovery, and one-paid-
  reward invariant.
- R2 archive encryption, digest verification, atomic pointer update, retention,
  restore failure, and seven-version pruning.
- Reset safety and 14-day PII purge.
- Existing booking conflict, Stripe, Square, Channex, refund, messaging,
  OpenTimestamps, accessibility, mobile, and no-overflow regressions.
- Built frontend and container-image secret/recovery/local-path scans.

### Live acceptance

1. Complete one production CA$1 Zaprite contribution, reconcile it
   authoritatively, confirm the fictional booking, submit its receipt, claim
   1,000 signet sats, and exercise the refund-request path.
2. Complete one 1,000-sat Wavelength booking payment, confirm it from completed
   merchant receive activity, submit its receipt, and receive exactly one
   1,000-sat reward.
3. Force-stop and replace the operations container, restore the encrypted
   wallet archive, reconcile prior state, and complete another payment/reward
   without duplication.
4. Verify email delivery, public wording, runtime health fallbacks, COOP/COEP,
   desktop/mobile layouts, keyboard operation, and no console errors.
5. Re-run root and CLI tests, typechecks, builds, documentation build, audit
   checks, and `git diff --check`.

Public enablement occurs only after the forced-restart recovery rehearsal
passes and the dependency-security preflight contains no unresolved critical or
high runtime finding. Both rails are enabled together immediately after those
gates; there is no public beta phase.

## Deployment and rollback

- Build and push a versioned operations-container image.
- Create private R2 storage, Worker secrets, Durable Object migration, one
  container binding, Turnstile widget, and scoped observability.
- Deploy Convex schema/functions and configure only the dedicated OpenStays
  deployment.
- Bootstrap and fund the capped signet merchant wallet through an
  operator-only procedure.
- Configure a dedicated production Zaprite checkout and webhook.
- Run live acceptance with provider and reward flags disabled for general
  visitors.
- Enable Zaprite, Wavelength, and rewards together after all gates pass.

Rollback disables the affected runtime flag first. Code rollback never rewrites
authoritative payment, refund, receipt, or reward records. Container rollback
restores the last compatible verified R2 archive and reconciles Convex before
new work is accepted.

## Deferred

- Wavelength mainnet.
- Real accommodation inventory or fulfilment.
- Automatic Zaprite refunds.
- Public staff administration.
- A public signet faucet.
- Guest accounts, saved production payment methods, and recurring payments.
- Custom-domain or multi-property production rollout.
