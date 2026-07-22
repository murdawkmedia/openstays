# Consensus Commons hackathon runbook

This is the local-first Bitcoin++ Toronto MVP. Its consensus claim is narrow:
availability, authoritative payment observation, booking state, notifications,
refund intervention, and optional channel synchronization converge on one
auditable reservation state.

All seeded Consensus Commons inventory is fictional. Zaprite sandbox and
Wavelength are independent demo rails; the project does not claim that a
Wavelength wallet pays a simulated Zaprite invoice.

## Local startup

```powershell
npm install
npx convex dev
npm run seed
npm run wavelength:runtime
npm run dev
```

`wavelength:runtime` downloads the pinned Wavelength 0.1.0 web runtime and
verifies its SHA-256 digest before placing it under `public/wavewalletdk/`.
Those generated assets are ignored. Vite and `public/_headers` set COOP/COEP.
The wallet SDK is lazy-loaded only on `/wallet/*`, uses
`defaultConfig("signet")`, and never sends a seed or password to OpenStays.

## Customer and staff surfaces

OpenStays is the booking engine, not the property's marketing website. A real
property can link its existing “Book now” button to `/p/<property-slug>` (or
later embed that route). The public funnel is property → room → availability
and guest details → checkout → confirmation → manage booking/chat. Staff use
the separate `/admin`, `/admin/operations`, and `/admin/settings` routes for
the booking tape, messages, refunds, and configuration. Both surfaces converge
on the same authoritative Convex booking ledger.

Channex remains an optional server-side distribution adapter for future OTA
inventory and reservations. It does not sit in the customer checkout path and
is deliberately not required for this hackathon demo.

## Zaprite sandbox

Use a sandbox organization and custom API checkout dedicated to OpenStays. The
isolated hackathon deployment now has its Consensus Commons API key and checkout
configured. Confirm that checkout has the Test Payment connection before
creating the first demo order. Set:

```powershell
npx convex env set ZAPRITE_API_KEY <sandbox-key>
npx convex env set ZAPRITE_CUSTOM_CHECKOUT_ID <checkout-id>
npx convex env set ZAPRITE_WEBHOOK_SECRET <random-secret>
```

Register
`https://<deployment>.convex.site/webhooks/zaprite?secret=<random-secret>`.
The URL secret authenticates only the nudge. OpenStays ignores its body and
fetches each bounded pending order using the server-held key. Only exact
`PAID`/`COMPLETE` orders settle. `UNDERPAID` waits; `OVERPAID` settles the
expected amount and opens a manual refund case for excess.

Never use a production payment method for acceptance. Rotate the current API
key after the hackathon because it was shared through the working session.

## Wavelength bridge

Run the Wavelength merchant daemon locally on signet, then configure Convex:

```powershell
npx convex env set WAVELENGTH_BRIDGE_TOKEN <random-token>
npx convex env set WAVELENGTH_SIGNET_SATS_PER_CURRENCY_UNIT 1000
```

Start the bridge from another terminal:

```powershell
$env:OPENSTAYS_URL='https://<deployment>.convex.site'
$env:WAVELENGTH_BRIDGE_TOKEN='<same-token>'
$env:WAVELENGTH_DAEMON_URL='http://localhost:10031'
npm --prefix cli run start -- wave-bridge
```

On Windows, after `.env.local` points to the intended Convex deployment, the
helper script retrieves the bridge token without echoing it and starts the
same bridge hidden:

```powershell
.\scripts\start-local-bridge.ps1
```

The bridge polls pending requests, calls `POST /v1/wallet/recv`, publishes the
invoice, inspects `POST /v1/wallet/inspect/activity`, and reports only a
completed receive whose request, invoice, activity, and snapshotted sats amount
match. Replays are no-ops. The clearly synthetic quote is
`ceil(amountCents × rate / 100)` at 1,000 signet sats per currency unit.

Signet remains the fallback. The guarded mainnet profile uses a fictional
one-night CAD 0.21 booking and exactly 210 real sats. It displays a BOLT11
invoice for a separate external Lightning wallet; it never auto-pays or mounts
the embedded browser wallet. Mainnet has a separate data directory, token, and
loopback ports 11029/11031, requires TLS/macaroons and `--allow-mainnet`, and
forbids `--allow-insecure-mainnet`.

Before running either mainnet startup script, confirm the operator and swap
endpoints plus 210-sat receive support with the Lightning Labs contact. Then set
the reviewed endpoints and run the daemon only with an explicit acknowledgement:

```powershell
$env:WAVELENGTH_MAINNET_OPERATOR_HOST='<reviewed-host>'
$env:WAVELENGTH_MAINNET_SWAP_HOST='<reviewed-host>'
.\scripts\start-wavelength-mainnet.ps1 -AcknowledgeRealSats
.\scripts\start-mainnet-bridge.ps1 -AcknowledgeRealSats
```

Startup alone creates no wallet, invoice, or payment. Stop again for fresh
approval immediately before creating or paying the 210-sat invoice.

## OpenStays Mail

Convex renders each notification once and owns its idempotency key, queue,
30-second lease, retry schedule, and audit row. The local CLI worker only
delivers claimed payloads through standard SMTP and reports the result. Resend
remains supported, but it is no longer required.

For a localhost inbox that cannot deliver externally:

```powershell
npm run mailpit:install
npm run mailpit:start
npm run mail:bridge
```

Mailpit listens only on SMTP `127.0.0.1:1025` and web
`http://127.0.0.1:8025`. Its pinned Windows archive is checksum-verified before
installation. Configure the selected Convex dev deployment with
`EMAIL_PROVIDER=mail_bridge`, `EMAIL_FROM`, and a random `MAIL_BRIDGE_TOKEN`.
The startup helper reads that token without echoing it. Set `DEMO_MODE=false`
for this acceptance because public demo mode deliberately forces log-only
mail. Mailpit is capture-only; use any operator-approved SMTP service later,
or self-host Postal, by changing the worker's `SMTP_*` variables.

## Manual refunds

Zaprite and Wavelength use `refundMode: manual`. Cancellation, payment
conflict, duplicate capture, mismatch, and overpayment create one idempotent
case. The payment remains paid. Staff use `/admin/operations`, perform the
refund externally, then record a provider reference or Bitcoin transaction ID.
Only that mutation appends the refund ledger. Staff get the required-action
notice; guests get completion email only after resolution.

## Five-minute judge demo

1. Create a fictional Consensus Commons Node Room hold.
2. Choose Zaprite sandbox, simulate paid, and trigger the nudge; show that the
   server fetch—not webhook content—confirms it.
3. Open Manage Booking with code + normalized email; show “Consensus reached”
   and a guest/staff message round trip.
4. Repeat with Wavelength: use the embedded signet wallet, or—only after a
   fresh real-money approval—the isolated 210-sat mainnet invoice with an
   external wallet; show bridge settlement and confirmation.
5. Simulate overpayment/cancellation, resolve the manual case with a demo
   reference, and show the ledger/status transition.
6. Point out “Channex — adapter ready, not connected”; no certification or OTA
   mapping is claimed.

## Verification gates

```powershell
npm test
npm run typecheck
npm run build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Zaprite and real-sat Wavelength acceptance require operator-started services
and remain deliberately separate from automated gates. Local Mailpit capture
is safe to run without external delivery.
