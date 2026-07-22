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

Wavelength is signet-only. Any legacy mainnet rows remain readable for schema
compatibility, but active configuration, UI, request claiming, and bridge
processing reject them. All displayed amounts are signet test sats.

## OpenTimestamps receipt bridge

Install the pinned official Python client into a local environment on Linux or
macOS:

```powershell
python -m pip install -r cli/requirements-ots.txt
```

On this Windows demo machine, the client's pinned `python-bitcoinlib`
dependency cannot discover Python's OpenSSL 3 DLL by its legacy library name.
Use the tested WSL execution path instead of patching cryptographic packages:

```powershell
wsl.exe --exec bash -lc 'TARGET="$HOME/.local/share/openstays/ots-bridge-python"; mkdir -p "$TARGET"; python3 -m pip install --target "$TARGET" opentimestamps-client==0.7.2'
$env:OTS_WSL='true'
$env:OTS_WSL_PYTHONPATH='/root/.local/share/openstays/ots-bridge-python'
```

The CLI translates only its temporary receipt/proof paths into WSL mount paths;
the canonical bytes and SHA-256 check remain unchanged. Native execution remains
the default everywhere else, and `OTS_COMMAND` can select another native `ots`
executable.

After an operator creates a fresh secret and writes the same value to the
selected Convex deployment as `OTS_BRIDGE_TOKEN`, start the worker:

```powershell
$env:OPENSTAYS_URL='https://<deployment>.convex.site'
$env:OTS_BRIDGE_TOKEN='<same-token>'
npm --prefix cli run start -- ots-bridge
```

Do not reuse the Wavelength token. The worker reconstructs the stored canonical
UTF-8 JSON, checks its SHA-256, stamps it with the official `ots` client's
default public calendars, validates the proof commitment, and uploads the
bounded `.ots` proof. Submission unlocks the reward immediately; a later proof
upgrade reports an authoritative Bitcoin block attestation. Pending is expected
for a fresh stamp and must never be presented as anchored.

The guest downloads both the canonical JSON and binary `.ots` proof. Neither
contains guest identity, email, stay dates, unit details, messages, invoices,
wallet data, or payment hashes.

The fictional proof at `docs/demo/consensus-receipt-sample.json.ots` was
submitted to four default public calendars. Its canonical SHA-256 is
`2bebb8b87c3d27c9a875beae80355a1fde04c6bf66566f60740e4bdbddf132ba`.
Keep it labeled pending unless `ots upgrade` and `ots info` report a real
Bitcoin block attestation.

## 210-sat signet reward

After proof submission, the authenticated guest opens the receipt card and
taps **Claim 210 signet sats**. The browser's self-custodial Wavelength wallet
creates an amount-bearing invoice; its seed and password stay in the browser.
The existing merchant bridge prepares the outgoing payment, verifies signet,
the exact 210-sat principal, expiry, off-chain rail, and fee cap, then sends and
reconciles the completed activity before marking the reward paid.

The default fee ceiling is 210 sats. Override it only for signet testing:

```powershell
$env:WAVELENGTH_REWARD_MAX_FEE_SATS='210'
```

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

## Three-minute judge demo

1. Explain how availability, payment, and notifications converge on one booking.
2. Complete a Wavelength signet booking payment and show “Consensus reached.”
3. Show the privacy-safe receipt hash, download JSON and `.ots`, and distinguish
   submitted from Bitcoin-anchored.
4. Claim exactly 210 signet sats into the embedded self-custodial guest wallet.
5. Show guest/staff chat, the optional Zaprite reconciliation/refund operations,
   and “Channex — adapter ready, not connected.”
6. Show `git diff btcpp-toronto-2026-pre-kickoff..HEAD` as the honest build window.

## Verification gates

```powershell
npm test
npm run typecheck
npm run build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Live Zaprite, Wavelength signet, and OpenTimestamps acceptance require
operator-started services and test funds. Local Mailpit capture is safe to run
without external delivery.

## Competition baseline

Annotated tag `btcpp-toronto-2026-pre-kickoff` points to commit `5c3038e`.
`HACKATHON_BASELINE.md` inventories the substantial pre-existing booking,
payment, messaging, email, refund, and channel-adapter work. Judge-facing
evidence is:

```powershell
git diff --stat btcpp-toronto-2026-pre-kickoff..HEAD
git diff btcpp-toronto-2026-pre-kickoff..HEAD
```

The OpenTimestamps receipt and one-time signet reward are the post-kickoff
feature. PowerShell 7 is optional; Windows PowerShell 5.1 is sufficient.
