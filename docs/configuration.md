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
| `currency` | `'CAD'`, etc. |
| `taxRateBps` | Tax rate in basis points; `500` = 5% GST |
| `gstNumber` | Optional, shown on receipts |
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
# Payments (configure one or both; M1+):
#   STRIPE_SECRET_KEY            sk_live_... / sk_test_...
#   STRIPE_WEBHOOK_SECRET        whsec_...
#   SQUARE_ACCESS_TOKEN
#   SQUARE_LOCATION_ID
#   SQUARE_WEBHOOK_SIGNATURE_KEY
#
# Email (M1+):
#   RESEND_API_KEY
#
# App:
#   SITE_URL                     https://your-booking-site.example
#   DEMO_MODE                    "true" ONLY on the public demo deployment
#                                (enables simulated payments + nightly reset)
```

Everything marked **M1** isn't wired up yet in this early snapshot of the
project — see [Payments](/concepts/payments) and the [roadmap](/roadmap) for
what's implemented today versus what's landing next.
