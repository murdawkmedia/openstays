# Public live payments

OpenStays can publish Consensus Commons as a fictional, public product
demonstration with two independent payment rails:

- Zaprite accepts an exact **CA$1 voluntary project contribution**.
- Wavelength accepts exactly **1,000 signet test sats**.
- A simulated tour remains available without a charge.

Consensus Commons is not a real property. No accommodation, reservation, or
other lodging service is sold. A Zaprite payment supports continued
development of the open-source project, is not tax-deductible, and does not
receive a charitable receipt. Wavelength uses valueless signet test funds.

## Authoritative flow

The browser never decides that money moved.

1. The guest accepts the public-payment disclosure and completes Turnstile.
2. The edge returns a five-minute, action- and booking-scoped eligibility
   token. It contains keyed digests rather than the raw email, device ID, or
   network address.
3. OpenStays creates either an exact CA$1 Zaprite order or an exact 1,000-sat
   Wavelength request.
4. A Zaprite webhook or redirect is only a nudge. Convex fetches the order
   through the server-held API credential and confirms only an exact
   authoritative state.
5. Wavelength settlement is reported only by the authenticated merchant
   bridge after a completed receive activity matches the request, invoice,
   network, amount, and payment identifier.
6. Confirmation creates one immutable, privacy-safe Consensus Receipt.
7. The OpenTimestamps worker validates and submits the proof. Submission and a
   later Bitcoin block attestation are separate states.
8. A verified submission makes a live-rail guest eligible to claim one exact
   1,000-sat signet reward, subject to the daily budget and merchant balance.

The simulated tour exercises the booking ledger and receipt UI without
creating a provider charge or a signet reward.

## Deployment and recovery boundary

For this showcase, the signet merchant runtime is hosted on the Synology NAS.
SHC is deliberately excluded. The runtime has no published container ports:
the browser and the eligibility-only Cloudflare Worker cannot reach the NAS.
Both talk only to public application services, while the merchant initiates
authenticated bridge calls to authoritative Convex state.

Encrypted wallet generations are written atomically to
`/volume2/openstays-wallet-backups`, a separate volume from live application
state. Those verified archive/manifest pairs are the recovery authority.
Missing, corrupt, or stale recovery data fails closed. A required restore
drill proves the same redacted signet wallet identity and activity before
Wavelength may be enabled. Zaprite does not depend on the signet wallet or its
recovery drill.

Zaprite and Wavelength enable independently. Zaprite can operate while
Wavelength is unhealthy or disabled; the simulated tour remains available
without either live rail. The Zaprite API key previously pasted during
development is treated as exposed and must be replaced before public
enablement.

### Optional backup-manifest timestamp

OpenTimestamps may be used as an optional audit layer for a sanitized
generation-manifest commitment. It can provide evidence that the commitment
existed by a particular time, but it does not make a backup valid and does not
replace atomic publication, SHA-256 verification, encryption, or the restore
drill.

No backup bytes, secret values, recovery material, wallet data, guest data,
invoice, or payment hash may enter the timestamped document. Calendar
submission is distinct from a later Bitcoin block attestation, and anchoring
is never required for merchant startup, restore, or payment processing.

## Privacy and retention

Public booking data uses a 14-day minimization policy:

- booking messages older than 14 days are deleted;
- guest name, email, phone, marketing choice, and notes are purged once all of
  that guest's bookings are older than 14 days;
- recipient, sender, subject, rendered body, provider identifier, delivery
  error, and lease data are removed from email logs after 14 days;
- expired disposable demo bookings older than 14 days are removed only when
  they have no payment record.

Payment ledgers, refund dispositions, booking-state evidence, opaque receipt
commitments, and Bitcoin attestations are retained because they are
authoritative operational records. The canonical Consensus Receipt excludes
guest identity, email, confirmation code, dates, unit, messages, notes,
invoices, wallet data, and payment identifiers.

## Refund requests

A guest authenticates on the manage-booking page with the confirmation code
and normalized email, then selects **Request contribution refund**.

Zaprite and Wavelength refunds are manual:

1. OpenStays creates at most one refund disposition per payment and alerts
   staff.
2. The payment remains `paid`; the guest sees that resolution is pending.
3. Staff completes the external refund and records the provider reference or
   Bitcoin transaction identifier.
4. Only then does OpenStays append the refund ledger, update payment state,
   and send the completion notice.

OpenStays never tells a guest that a manual refund succeeded before that
authoritative staff action.

## Public configuration

These are configuration names and inert examples only. Secret values belong in
the relevant provider's secret store and must never use a `VITE_` prefix.

### Cloudflare Pages build variables

| Name | Public example |
| --- | --- |
| `VITE_CONVEX_URL` | `https://deployment-name.convex.cloud` |
| `VITE_PUBLIC_SHOWCASE` | `true` |
| `VITE_PUBLIC_ZAPRITE` | `false` until accepted |
| `VITE_PUBLIC_WAVELENGTH` | `false` until accepted |
| `VITE_PUBLIC_SIMULATED` | `true` |
| `VITE_TURNSTILE_SITE_KEY` | `public-site-key` |
| `VITE_PAYMENT_EDGE_URL` | `https://openstays-eligibility-edge.<account-subdomain>.workers.dev` until deployment provides the actual URL |

### Convex non-secret policy

| Name | Required value |
| --- | --- |
| `SITE_URL` | Public Pages origin |
| `PUBLIC_LIVE_PAYMENTS` | `true` for this mode |
| `PUBLIC_SIMULATED_PAYMENTS` | `true` |
| `PUBLIC_ZAPRITE_CONTRIBUTION_CENTS` | `100` |
| `WAVELENGTH_PUBLIC_PAYMENT_SATS` | `1000` |
| `WAVELENGTH_REWARD_SATS` | `1000` |
| `WAVELENGTH_REWARD_DAILY_BUDGET_SATS` | `0` before acceptance; capped value after |
| `WAVELENGTH_REWARD_MAX_FEE_SATS` | `210` |
| `WAVELENGTH_NETWORK` | `signet` |
| `ZAPRITE_ENABLED` | `false` before acceptance |
| `WAVELENGTH_ENABLED` | `false` before acceptance |
| `WAVELENGTH_REWARDS_ENABLED` | `false` before acceptance |
| `EMAIL_PROVIDER` | `mail_bridge` or `log_only` |

`DEMO_MODE` must not be `true` when a live rail is enabled.

### Convex secrets

- `ELIGIBILITY_HMAC_SECRET`
- `ZAPRITE_API_KEY`
- `ZAPRITE_CUSTOM_CHECKOUT_ID`
- `ZAPRITE_WEBHOOK_SECRET`
- `WAVELENGTH_BRIDGE_TOKEN`
- `WAVELENGTH_HEARTBEAT_TOKEN`
- `OTS_BRIDGE_TOKEN`
- `OTS_HEARTBEAT_TOKEN`
- `MAIL_BRIDGE_TOKEN`
- `MAIL_HEARTBEAT_TOKEN`
- `BACKUP_HEARTBEAT_TOKEN`

Optional mail delivery also uses `EMAIL_FROM`; the Synology merchant may use
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, and
`SMTP_PASSWORD`.

### Eligibility-only Cloudflare Worker

Non-secret variables:

- `PUBLIC_ORIGIN`
- `RELEASE`
- `OPERATIONS_MODE=synology_external`

Worker secrets:

- `TURNSTILE_SECRET`
- `ELIGIBILITY_HMAC_SECRET`
- `OPERATIONS_ADMIN_TOKEN`

This Worker has no Container, Durable Object, R2, Synology origin, or
Synology credential. The HMAC secret must match only its intended Convex
counterpart.

### Synology merchant

The private `merchant.env` holds the Convex API key, container control token,
wallet backup key, wallet password, service-scoped bridge and heartbeat
tokens, and optional SMTP settings. It is mode `0600` and never committed.
Each token matches only its intended Convex counterpart; do not reuse tokens
across services.

## Availability and fail-closed behavior

- A Wavelength heartbeat older than 60 seconds hides the public Wavelength
  action without disabling Zaprite or the simulated tour.
- A reward additionally requires at least 1,000 sats plus the configured fee
  ceiling in the merchant wallet.
- A missing, corrupt, or stale encrypted `/volume2` wallet generation prevents
  the merchant container from becoming ready.
- The live reward budget defaults to zero.
- Reset and retention jobs never rewrite real payment, refund, reward, or
  receipt authority.

See the [operator runbook](./operations/public-live-payments-runbook.md) before
configuring or enabling any public rail.
