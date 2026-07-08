# Configuration

**Your inventory is data, not code.** OpenStays ships with zero real
properties baked in — the only inventory in this repo is the fictional
"Pinewood Flats Campground" seed used for local development and the demo
deployment (`convex/seed.ts`). Your cabins, sites, rates, and policies live as
rows in your own Convex deployment, not as source files you fork and edit.

> **Admin UI status:** today, inventory is loaded via a seed-style Convex
> script or directly through the [Convex dashboard](https://dashboard.convex.dev)
> (Data tab, insert/edit rows by hand or import JSON). A proper admin CRUD UI
> for managing this data from the browser lands in **M1+** — see the
> [roadmap](/roadmap). Until then, treat `convex/seed.ts` as a template: copy
> it, replace the fictional data with yours, and run it with
> `npx convex run yourSeedFile:run`.

Two conventions apply everywhere below and are enforced by tests, not just
convention:

- **Money is integer cents.** `14900` means $149.00. Never floats.
- **Stay dates are property-local ISO strings** (`'2026-07-15'`), compared
  lexicographically. Nights are half-open: a booking `[checkIn, checkOut)`
  does not occupy the checkout date, so the next guest can check in that day.

## Domain objects

### `properties`

One row per physical property in your deployment (a deployment can host more
than one — `propertyId` is on every table below). Key fields:

| Field | Meaning |
|---|---|
| `slug` | URL-safe identifier, unique per deployment |
| `timezone` | IANA zone, e.g. `'America/Edmonton'` — this is what "today" means for lead-time and cancellation-window math |
| `currency` | `'CAD'` (default — OpenStays is built by a Canadian company), `'USD'`, or `'EUR'`. Set per property; every guest-facing price formats in it. Other valid ISO codes also work — these three are the curated options in the settings page. |
| `taxRateBps` | Tax rate in basis points; `500` = 5% GST |
| `taxLabel` | Display label for the tax line: `'GST'` (default for Canada), `'VAT'`, `'Sales Tax'`… |
| `gstNumber` | Optional tax registration number, shown on receipts |
| `checkInTime` / `checkOutTime` | Display-only, `'16:00'` / `'11:00'` |
| `active` | If `false`, the property stops accepting new bookings |

### `unitTypes`

A category of bookable thing — "Lakeview Cabin," "Ridge Yurt," "Full-Hookup
RV Site." Each has a `kind` (`room` | `cabin` | `site` | `rv_rental` | `yurt`
| `geodome`) for display/icon purposes, and a `bookingMode`:

- **`nightly`** — the normal case. Guests pick check-in/check-out dates and
  the availability calendar applies.
- **`seasonal`** — long-term site contracts (a full summer season, not
  night-by-night). The `seasonalContracts` table backs this; full seasonal
  workflow (invoicing schedule, renewal offers) lands in **M4**.

`comingSoon` lets you list a unit type before it's bookable; `sortOrder`
controls display order.

### `units`

The individual bookable thing within a unit type — "Cabin 1," "Site 103,"
"Yurt 1." Each unit carries:

- `status`: `active` | `coming_soon` | `offline`.
- `bookableFrom` (optional ISO date): the unit isn't offered for check-in
  dates before this — useful for a cabin still under construction.
- `icalExportToken`: a long random secret that identifies this unit's `.ics`
  export feed (`/api/ical/<token>.ics` — see `convex/ical.ts`). Anyone with
  the token can read the calendar, so treat it like a credential; regenerate
  it if it leaks.
- `icalImports`: an array of `{ url, label, lastSyncedAt, lastStatus }` for
  calendars you pull in from elsewhere (e.g. an Airbnb listing). Import
  polling/parsing is scoped for **M3**.

### `ratePlans`

One rate plan belongs to one `unitType` (a unit type can have more than one
active plan, e.g. a "Standard" and a promo). This is where most of the
booking-rules configuration lives:

- `baseNightlyCents` — the default nightly rate.
- `weeklyRateCents` (optional) — applied per full 7-night block when it's
  cheaper than the sum of nightly rates for those nights; remaining nights
  stay nightly.
- `seasons`: an array of `{ label, startDate, endDate, nightlyCents,
  minStayNights? }`. `startDate`/`endDate` are inclusive. The first season
  whose range contains a given night wins; a season can also override
  minimum stay for nights that fall inside it (e.g. "2-night minimum in
  peak summer").
- `minStayNights` / `maxStayNights` — default stay-length bounds.
- `minLeadTimeHours` — how much notice is required before check-in (`0` =
  same-day bookings allowed).
- `maxAdvanceDays` — how far out the booking window opens.
- `prepBufferNights` — turnover nights blocked *after* checkout before the
  unit can be booked again (cleaning, glamping setup, etc.). These show up
  as `kind: 'prep'` rows in `unitNights` — see
  [Availability & holds](/concepts/availability).
- `depositPolicy`: `{ type, value }` where `type` is one of:
  - `'full'` — the entire total is due at booking.
  - `'percent'` — `value` is a percentage (0–100) of the total.
  - `'flat'` — `value` is a flat cents amount.
  - `'first_night'` — the first night's rate plus tax.
- `cancellationPolicy`: an array of `{ daysBefore, refundPercent }` windows.
  The policy is evaluated by "how many days before check-in is the guest
  cancelling," matched against the *largest* `daysBefore` threshold the
  cancellation date still qualifies for. See
  [Payments](/concepts/payments) for the refund math.

### `addOns`

Extras like firewood bundles or late checkout. Each has `priceCents`,
`taxable` (whether GST applies to it), and `appliesTo` — an array of
`unitTypeId`s it's restricted to, or empty for "available with any unit
type." Add-ons are sold per booking via `bookingAddOns`, which snapshots the
name and price at time of sale so historical bookings don't change if you
later edit the add-on.

## Money and dates, precisely

- **Money is integer cents everywhere** — in the schema, in
  `shared/pricing.ts`, in every mutation. `$14.90` is `1490`, not `14.9`.
  There is exactly one rounding point for tax (GST is rounded once on the
  aggregate taxable base — see [Payments](/concepts/payments)); nothing else
  in the pricing pipeline rounds.
- **Dates are property-local ISO `YYYY-MM-DD` strings**, not JavaScript
  `Date` objects and not UTC instants. "Today" for lead-time and
  cancellation-window purposes is computed from the property's `timezone`
  field, not the server's local time. Only genuine instants — `createdAt`,
  `holdExpiresAt` — are epoch milliseconds.

## Environment variables

Copied from `.env.example` — this is the authoritative list, don't add to it
without updating that file too.

```bash
# ── Frontend (Vite) ─────────────────────────────────────────────────────
# Set automatically by `npx convex dev` into .env.local during development.
VITE_CONVEX_URL=

# ── Convex deployment env vars ──────────────────────────────────────────
# These are NOT read from this file. Set them per deployment with:
#   npx convex env set NAME value
#
# Payments (configure one or both; M1, in progress):
#   STRIPE_SECRET_KEY            sk_live_... / sk_test_...
#   STRIPE_WEBHOOK_SECRET        whsec_...
#   SQUARE_ACCESS_TOKEN
#   SQUARE_LOCATION_ID
#   SQUARE_WEBHOOK_SIGNATURE_KEY
#   SQUARE_ENV                   'sandbox' | 'production'
#
# Staff/admin auth (M1, in progress — Convex Auth):
#   JWT_PRIVATE_KEY
#   JWKS
#
# Email (M1, in progress):
#   RESEND_API_KEY
#   EMAIL_FROM
#
# Channel manager (Channex, M6 — scaffolded, dormant until connected):
#   CHANNEX_API_KEY              the 'user-api-key' value; unset = channel sync off
#   CHANNEX_BASE_URL             default https://staging.channex.io (prod once certified)
#   CHANNEX_WEBHOOK_SECRET       optional shared secret echoed on the webhook nudge
#
# App:
#   SITE_URL                     https://your-booking-site.example
#   DEMO_MODE                    "true" ONLY on the public demo deployment
#                                (enables simulated payments + nightly reset)
```

**Binding rule: secrets only via `npx convex env set`.** Every variable below
is a Convex deployment env var, never a row in the `settings` table and never
committed to this repo. The `settings` table is for non-secret deployment
prefs only (branding, GST number, default provider) — see
[self-hosting](/self-hosting) for the exact setup commands for each provider.

Everything below is **not fully live in a default deployment**: the payments,
auth, and email variables are **M1 — in progress** (code paths exist in this
snapshot but aren't fully wired end-to-end yet), and the `CHANNEX_*` variables
are **M6 — scaffolded, dormant** (present but doing nothing until an operator
connects Channel manager). In every case, unsetting the variable degrades
gracefully — the relevant feature is simply off, never an error. See
[Payments](/concepts/payments), [Channels](/channels), and the
[roadmap](/roadmap) for what's implemented today versus what's landing next.

| Variable | Purpose | If unset |
|---|---|---|
| `STRIPE_SECRET_KEY` | Restricted API key used server-side to create Stripe Checkout Sessions. | Stripe isn't "configured" for this deployment — the Stripe button is absent from checkout; guests only see providers that are configured. |
| `STRIPE_WEBHOOK_SECRET` | Verifies that incoming `/webhooks/stripe` requests are authentically from Stripe (signature check) before any booking state changes. | Same as above — a deployment needs both Stripe vars to offer Stripe at all. |
| `SQUARE_ACCESS_TOKEN` | Server-side token used to create Square Payment Links. | Square isn't configured — the Square button is absent from checkout. |
| `SQUARE_LOCATION_ID` | The Square location the Payment Link is created against. | Same as above. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Verifies incoming `/webhooks/square` requests are authentically from Square. | Same as above. |
| `SQUARE_ENV` | `'sandbox'` or `'production'` — selects which Square API base URL and credentials set applies. | Defaults to sandbox behavior; always set explicitly for a real deployment so you don't accidentally run production traffic against sandbox credentials (or vice versa). |
| `SITE_URL` | Frontend origin used to build Checkout success/cancel redirect URLs, Payment Link redirects, and links inside guest emails. | Checkout session creation and email links can't be built correctly — set this before enabling any real provider. |
| `RESEND_API_KEY` | Bearer token for the Resend API, used to actually send guest/staff transactional email. | Email sends degrade to an `emailLog` row with `status: 'logged'` instead of a real send — nothing errors, nothing blocks the booking flow, but guests don't receive email. This is also the default on `DEMO_MODE=true` deployments regardless of this key. |
| `EMAIL_FROM` | The `From:` address/name Resend sends as, e.g. `'Pinewood Flats <stays@pinewood.example>'`. | Falls back to a generic sender identity (or the send is only logged if `RESEND_API_KEY` is also unset) — set this alongside `RESEND_API_KEY` so confirmation emails look like they came from your property. |
| `DEMO_MODE` | `"true"` ONLY on the public demo deployment. Enables simulated payments (`bookings.confirmSimulated`) and the nightly reset cron. | Real payment providers and real staff-managed data are in play — this is the correct state for every real operator deployment. |
| `JWT_PRIVATE_KEY` | Convex Auth's RS256 private key (PKCS8 PEM) used to sign staff session JWTs. | Staff sign-in cannot issue valid sessions — the `/admin/login` flow will fail. Generate this once per deployment; see [self-hosting](/self-hosting). |
| `JWKS` | The matching public JWKS document Convex Auth uses to verify the JWTs `JWT_PRIVATE_KEY` signs. | Same as above — these two are generated together and both required. |
| `CHANNEX_API_KEY` | The `user-api-key` value for the [Channex](https://channex.io) channel manager (M6 — scaffolded, dormant). Its presence is what flips channel sync from off to configured. | **Channel sync is simply off.** No availability/rates are pushed, the booking-revisions feed isn't polled, the admin Channels page shows "not configured," and the booking flow is completely unaffected. This is the default and the correct state for any deployment not using OTA distribution — see [Channels](/channels). |
| `CHANNEX_BASE_URL` | Channex API base URL. | Defaults to `https://staging.channex.io`. Point at the production base URL only after Channex certifies your integration and issues production credentials — verify the exact production host during certification. |
| `CHANNEX_WEBHOOK_SECRET` | A shared secret you invent and register on the Channex webhook so OpenStays can validate the inbound nudge (Channex has no HMAC signing — this static header is the only check). | The `/webhooks/channex` nudge isn't secret-checked, and inbound OTA bookings still arrive reliably on the 2-minute pull-feed poll (the webhook is only a latency optimization, never the authoritative path). |

Note `JWT_PRIVATE_KEY`/`JWKS` gate **staff/admin** auth only. Guests never
have accounts — manage-booking access is confirmation code + email match, as
today (see binding convention #10 in `CLAUDE.md`).
