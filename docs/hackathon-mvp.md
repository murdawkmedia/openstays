# Consensus Commons hackathon runbook

This is the local-first Bitcoin++ Toronto MVP. Its consensus claim is narrow:
availability, authoritative payment observation, booking state, notifications,
refund intervention, and optional channel synchronization converge on one
auditable reservation state.

All seeded Consensus Commons inventory is fictional. Zaprite sandbox and
Wavelength signet are independent demo rails; the project does not claim that a
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

## Zaprite sandbox

Prefer a sandbox organization and custom API checkout dedicated to OpenStays.
For the local hackathon deployment, Murphy authorized the existing Signal21
organization-scoped API key and custom checkout; confirm that checkout has the
Test Payment plugin before creating a demo order. Set:

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

Never use a production payment method for acceptance. A separate sandbox
checkout keeps the production organization clean and remains the recommended
configuration after the initial local setup.

## Wavelength signet bridge

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
4. Repeat with Wavelength: merchant invoice, embedded signet wallet payment,
   bridge settlement, confirmation.
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

Live acceptance requires operator-started sandbox/signet services and is
deliberately separate from automated gates.
