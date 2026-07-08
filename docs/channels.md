# Channel manager (Channex)

> **Status: scaffolded, dormant by default (M6-prep).** The provider, the
> availability/rates push, and the OTA-booking ingest are all built and in the
> tree (`convex/channel/**`), but a deployment does **nothing** with them until
> an operator connects a Channex account and maps objects. Nothing here is a
> shipped, promised v1 feature — see the [roadmap](/roadmap). This page is the
> operator guide for turning it on when you want it.

## What this is (and what it is not)

OpenStays can distribute your availability and rates to the big OTAs —
Booking.com, Airbnb, Expedia, VRBO — and pull the resulting reservations back
in. It does this by talking to **one channel manager, [Channex](https://channex.io)**,
which in turn fans out to each OTA.

That indirection is the honest part of the scope, so be clear about it:

- **This is not a direct Airbnb / Booking.com / Expedia API integration.**
  Those APIs are partner-gated and not buildable by an independent project.
  OpenStays speaks only to Channex; Channex holds the OTA partnerships.
- **It is not live out of the box.** A fresh deployment has no Channex account,
  no API key, and no object mappings, so every channel code path is a no-op.
  Distribution stays exactly what v1 promises — direct bookings on your own
  site plus [per-unit iCal sync](/self-hosting#ical-import-m1-—-in-progress) —
  until you deliberately connect it.
- **Going live is four steps you own, not a switch we flip:** (a) you have a
  Channex account, (b) you set `CHANNEX_API_KEY`, (c) you map your unit types
  and rate plans to their Channex objects in OpenStays admin, and (d) you do
  the OTA-side mapping in the **Channex dashboard**. Miss any one and nothing
  syncs.

If you only want to keep a direct Airbnb listing from double-booking against
your own site, you do **not** need this — plain [iCal import/export](/self-hosting#ical-import-m1-—-in-progress)
already covers that and needs no third-party account.

## How the sync works, plainly

There are two directions, and OpenStays stays the system of record for
availability in both.

### Outbound: availability + rates → Channex (ARI push)

Whenever your occupancy changes — a hold is taken, a booking is cancelled, an
external event is imported — OpenStays recomputes and pushes the affected
dates to Channex. Two separate messages go out
([Channex keeps availability and rates on distinct endpoints](https://docs.channex.io/api-v.1-documentation/ari)):

- **Availability** is a **count of free units per room type per night** — not a
  per-unit calendar. For each unit type you've mapped, OpenStays pushes
  `(active units of that type) − (units occupied that night)`. Channex's model
  tracks inventory as a count per room type per date, so this is exactly the
  shape it wants.
- **Rates and restrictions** go per mapped rate plan per night — the nightly
  rate (converted from integer cents to a decimal string in major units) plus
  min-stay, closed-to-arrival/departure, and stop-sell.

Pushes are batched (a whole date horizon in one availability call and one
restrictions call per property) and fired within about a minute of a change by
the `channex ari flush` cron. On top of the change-driven pushes, a **nightly
full resync** re-pushes each connected property's complete state as a
reconciliation backstop — this matches
[Channex's own recommendation to send a daily full update per property](https://docs.channex.io/guides/pms-integration-guide).

### Inbound: OTA bookings → OpenStays (pull feed)

When a guest books your cabin on Booking.com, the reservation comes back to
OpenStays through Channex's **booking-revisions feed**, which is the
**authoritative path**:

1. OpenStays polls `GET /api/v1/booking_revisions/feed` every 2 minutes
   (`channex booking poll` cron) for unacknowledged revisions.
2. Each revision is ingested into a real OpenStays booking (a free unit of the
   mapped type is assigned, nights are blocked, the booking is recorded with
   source `channel:<ota>`).
3. **Only after that durable local write** does OpenStays acknowledge the
   revision back to Channex. Acking before the write would lose a booking;
   un-acked revisions safely re-appear in the feed for about 30 minutes
   ([then Channex emails a warning](https://docs.channex.io/guides/best-practices-guide)),
   so a missed poll never drops a reservation.

**Webhooks are only a low-latency nudge, never the data.** You can register a
Channex webhook at your deployment (see [setup](#step-5-—-register-the-webhook-nudge-optional)),
but all it does is tell OpenStays "go pull the feed now" so you're not waiting
up to 2 minutes for the next poll.
[Channex webhooks arrive out of order and carry no booking payload](https://docs.channex.io/api-v.1-documentation/webhook-collection),
so OpenStays never trusts one as booking data — it always reconciles through
the pull feed.

### How overselling is prevented

Channex does not manage a shared inventory counter on your behalf — the PMS is
the system of record and must keep availability current. OpenStays does this by
pushing the updated free-unit count **immediately after each booking** (the
ingest step schedules an ARI push as soon as the new occupancy lands), so the
OTA-facing count drops right after a sale. The minute-level flush cron and the
nightly full resync are the backstops behind that immediate push.

If a channel booking arrives for dates where **every** unit of the mapped type
is already taken, OpenStays treats it as a genuine oversell: the OTA sale is a
confirmed reservation, so the booking is still created (never silently dropped),
flagged `syncConflict`, logged, and escalated to staff to resolve. The exact
window in which an oversell can occur — how Channex behaves between an OTA
confirming on its side and your next push landing — is one of the items to
**confirm during Channex certification** (see [limits and gotchas](#limits-and-gotchas)).

## Setup

Order matters: get a Channex account and key, wire the key into your
deployment, map objects in OpenStays admin, then do the OTA-side mapping in
Channex. Nothing syncs until all four are done.

### Step 1 — Get a Channex account and API key

Sign up at **[staging.channex.io](https://staging.channex.io)**. Staging is
free and fully self-serve — no sales call — and lets you build and test the
whole integration end to end
([API key access](https://docs.channex.io/application-documentation/api-key-access)).
Channex also offers an ["Open Channel"](https://docs.channex.io/for-ota/open-channel-api)
fake OTA you can attach to a staging property to exercise ARI push and booking
ingest without real OTA test credentials.

Create the API key from the organisation's **API Keys** section ("Create new
API Key"). The key is shown once — copy it immediately.

> **Production requires certification.** Before you can go live against real
> OTAs, Channex runs a
> [multi-stage PMS certification process](https://docs.channex.io/api-v.1-documentation/pms-certification-tests)
> that ends in a scheduled live screenshare, after which production credentials
> are issued. Plan for that gate — you cannot self-serve your way from staging
> straight to real Booking.com traffic. Certification and production pricing
> terms are Channex's; treat any figures you find as **confirm during
> certification** rather than settled fact.

### Step 2 — Set the environment variables

Channel manager secrets are Convex deployment env vars, set with
`npx convex env set` — never committed to the repo, never stored in the
`settings` table (same rule as every other secret; see
[Configuration](/configuration#environment-variables)).

```bash
# Required — the 'user-api-key' value from step 1. Presence of this key is what
# flips the channel manager from "off" to "configured".
npx convex env set CHANNEX_API_KEY <your-channex-api-key>

# Optional — defaults to https://staging.channex.io. Point at the production
# base URL only once Channex has certified you and issued production creds.
npx convex env set CHANNEX_BASE_URL https://staging.channex.io

# Optional — a shared secret you invent and register on the Channex webhook.
# Channex has no HMAC signing; this static header is the only nudge check.
npx convex env set CHANNEX_WEBHOOK_SECRET <a-long-random-string>
```

**If `CHANNEX_API_KEY` is unset, channel sync is simply off** — no crons do any
work, the admin Channels page shows "not configured," and the booking flow is
completely unaffected. This is the default and the correct state for any
operator who isn't using OTA distribution.

### Step 3 — Map objects in OpenStays admin

In OpenStays admin, open **Settings → Channels**. For each property you want to
distribute:

1. Paste the **Channex Property UUID** (from your Channex dashboard) and enable
   sync. This creates the property's channel-sync record.
2. Map **each unit type** to its Channex **Room Type UUID**. Availability is
   pushed per room type, so an unmapped unit type is simply skipped.
3. Map **each rate plan** to its Channex **Rate Plan UUID**. Rates and
   restrictions are pushed per rate plan; an unmapped rate plan is skipped.

Only the non-secret mapping (the Channex UUIDs) and the enable toggle live
here — the API key is never entered on this page. You can leave a property
mapped but paused (`enabled: false`) if you want everything wired without
pushing yet.

### Step 4 — Do the OTA-side mapping in the Channex dashboard

This step is **dashboard-only** and cannot be done through the OpenStays API.
In Channex, connect each OTA (Booking.com, Airbnb, Expedia, VRBO…) and, on the
property's **Mapping** tab, match each Channex Room Type + Rate Plan to the
corresponding OTA listing/rate
([example: the Airbnb mapping guide](https://docs.channex.io/channel-mapping-guides/airbnb)).

OTA mapping is per-channel and bespoke — each OTA maps differently, and some
(e.g. Airbnb) accept only one rate plan per listing. Programmatic OTA mapping
exists only for
[Channex WhiteLabel partners](https://docs.channex.io/api-v.1-documentation/channel-api);
as an ordinary integrator you do this in the dashboard, once per channel.

### Step 5 — Register the webhook nudge (optional)

Registering a Channex webhook lowers inbound latency from the 2-minute poll to
near-real-time. In Channex, point a booking webhook at your deployment's HTTP
Actions URL:

```
https://<your-deployment>.convex.site/webhooks/channex
```

If you set `CHANNEX_WEBHOOK_SECRET`, configure Channex to send that value as a
header so OpenStays can validate the nudge (Channex has no cryptographic
signature — this shared secret is the only check available). The webhook is
purely a "go poll now" trigger; skipping it just means bookings arrive on the
next 2-minute poll instead of immediately, so it's optional, not required for
correctness.

## What OpenStays does vs. what you do in Channex

| Responsibility | OpenStays (via API) | You, in the Channex dashboard |
|---|---|---|
| Create/hold the Channex account | — | ✅ Sign up, hold the subscription, own billing |
| Create the Channex Property, Room Types, Rate Plans | — (you create them in Channex; OpenStays references their UUIDs) | ✅ Create the objects, get their UUIDs |
| Map OpenStays unit types / rate plans → Channex UUIDs | ✅ In **Settings → Channels** | — |
| Push availability counts + rates/restrictions | ✅ Automatic on every change + nightly resync | — |
| Connect each OTA (Booking.com / Airbnb / Expedia / VRBO) | — (partner-gated; not an OpenStays capability) | ✅ Connect + authorize each channel |
| Map Channex Room Type + Rate Plan → each OTA listing/rate | — (dashboard-only unless you're a WhiteLabel partner) | ✅ On the property's Mapping tab |
| Ingest OTA bookings + keep availability decremented | ✅ Pull feed (authoritative) + ack + immediate re-push | — |
| Resolve an oversell / unmapped-room flag | ✅ Surfaces it on the tape + staff alert | ✅ Fix the mapping / inventory on the OTA side |

## Limits and gotchas

These come from the Channex documentation and are worth designing your
operations around. Where a fact was not directly confirmable in the docs, it's
flagged **confirm during Channex certification** rather than stated as settled.

- **A 200 OK is not "all rows applied."** ARI pushes can return per-row
  problems as `meta.warnings` **inside** a 200 response, so a batch can
  partially succeed. OpenStays logs warnings to the channel sync log — check
  the Channels page after enabling a property.
  [Source.](https://docs.channex.io/api-v.1-documentation/ari)
- **Rate limit: 10 requests/minute/property** for availability and 10/min for
  restrictions, tracked separately; exceeding returns `429`. OpenStays batches
  a whole horizon into one call each per flush to stay well under this, but a
  429 is surfaced as retryable rather than silently dropped.
  [Source.](https://docs.channex.io/api-v.1-documentation/rate-limits)
- **New Channex room types default to 0 availability.** A freshly created room
  type sells nothing until availability is pushed — don't assume a nonzero
  default. The first successful ARI push (or a "Sync now") is what makes a newly
  mapped room type sellable.
  [Source.](https://docs.channex.io/api-v.1-documentation/room-types-collection)
- **Un-acked bookings re-appear for ~30 minutes, then Channex emails a
  warning.** This is a safety net, not an error to fear — it's exactly why
  OpenStays acks only after a durable local write. A missed poll cycle recovers
  on the next one.
  [Source.](https://docs.channex.io/guides/best-practices-guide)
- **The pull feed is authoritative; webhooks are unreliable nudges.** Webhook
  ordering is not guaranteed and the payload carries no booking data, so never
  treat a webhook as the reservation itself.
  [Source.](https://docs.channex.io/api-v.1-documentation/webhook-collection)
- **Confirm during Channex certification:** the exact **production base URL**
  (vs. `staging.channex.io`), the precise **oversell-window mechanics** (whether
  Channex momentarily reserves availability the instant an OTA confirms, pending
  your next push), and **production pricing / certification fees**. These were
  not fully pinned down in public docs at build time — verify them against your
  own production account and the certification screenshare before relying on
  them operationally.

## Where this sits in the codebase

For contributors, the whole integration lives under `convex/channel/`:

- `types.ts` — the `ChannelManagerProvider` contract (the fixed abstraction,
  mirroring the `PaymentProvider` pattern).
- `channex.ts` — the Channex implementation and env-var handling.
- `ari.ts` — the outbound availability/rates push and the free-unit
  computation.
- `ingest.ts` — the inbound booking pull/ack and oversell handling.
- `admin.ts` — the staff-facing mapping surface behind **Settings → Channels**.

Schema fields (`channexPropertyId`, `channexRoomTypeId`, `channexRatePlanId`,
`channelSync`, `channelSyncLog`), the crons (`channex ari flush`,
`channex booking poll`, `channex full resync`), and the webhook route
(`/webhooks/channex`) are all present but dormant until a property is connected
and `CHANNEX_API_KEY` is set.
