# Configuration

**Your inventory is data, not code.** OpenStays ships with zero real
properties baked in — the only inventory in this repo is the fictional
"Pinewood Flats Campground" seed used for local development and the demo
deployment (`convex/seed.ts`). Your cabins, sites, rates, and policies live as
rows in your own Convex deployment, not as source files you fork and edit.

> **Inventory setup status:** initial property, unit, and rate inventory is
> still loaded through a seed-style Convex script or the
> [Convex dashboard](https://dashboard.convex.dev). Once loaded, the
> feature-gated command center handles daily reservations, front desk,
> housekeeping, maintenance, folios, closeout, groups, and seasonal records.
> Treat `convex/seed.ts` as a template; never put customer data in the public
> repository.

Two conventions apply everywhere below and are enforced by tests, not just
convention:

- **Money is integer cents.** `14900` means $149.00. Never floats.
- **Stay dates are property-local ISO strings** (`'2026-07-15'`), compared
  lexicographically. Nights are half-open: a booking `[checkIn, checkOut)`
  does not occupy the checkout date, so the next guest can check in that day.

## Property operations flags

The PMS expansion is additive and disabled per property until a row in
`propertyFeatures` explicitly enables it. Supported flags are
`command_center`, `front_desk`, `housekeeping`, `maintenance`, `commerce`,
`night_audit`, `groups`, `long_term`, `front_desk_exceptions`, and
`housekeeping_checklists`. An absent row is disabled.

| Flag | Enables |
|---|---|
| `front_desk_exceptions` | Operational flags, attention filters, and flag mutations |
| `housekeeping_checklists` | Templates, snapshots, checklist work, inspections, and checkout handoff |

Before enabling a property, run the idempotent
`staff:backfillPropertyAssignments` migration, inspect its assignments, and
run it a second time to confirm it inserts zero additional rows. Then enable
one workspace at a time and follow the acceptance sequence in
[Kokanee-first command center](/command-center). Disabling a flag removes its
operator workspace without changing guest booking, payment reconciliation, or
existing records.

### Housekeeping checklist migration

Use the exact property slug from the target deployment. Do not run the command
against an unverified default property.

```powershell
npx convex run dailyOperationsMigration:preview '{"propertySlug":"test"}'
npx convex run dailyOperationsMigration:apply '{"propertySlug":"test","cleaningType":"turnover","expectedMinutes":45}'
```

Inspect the preview before running `apply`. Run `apply` twice and confirm that
the second run reports `updated: 0`. Enable `housekeeping_checklists` only after
that replay check passes.

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
  workflows now support auditable contract records and balanced payment
  schedules. Automated invoicing and renewal offers remain future work.

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
VITE_PUBLIC_SHOWCASE=false
VITE_PUBLIC_STAFF=false

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
# Optional OAuth sign-in (in addition to password; each pair is independently
# env-gated — set a pair to show that provider's button, leave unset to hide it):
#   AUTH_GITHUB_ID / AUTH_GITHUB_SECRET
#   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
#   AUTH_MICROSOFT_ENTRA_ID_ID / AUTH_MICROSOFT_ENTRA_ID_SECRET
#   AUTH_MICROSOFT_ENTRA_ID_ISSUER  optional, restricts sign-in to one tenant
#
# Email (M1+):
#   EMAIL_PROVIDER              'resend' | 'mail_bridge' | 'log_only'
#   RESEND_API_KEY
#   EMAIL_FROM
#   MAIL_BRIDGE_TOKEN
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

Payment, authentication, and email code paths are shipped, but every deployment
must supply and live-test its own provider credentials. The `CHANNEX_*`
variables remain **M6 — scaffolded, dormant** until an operator connects a
channel manager. In every case, unsetting a variable degrades gracefully —
the relevant feature is simply off or log-only, never a booking error. See
[Payments](/concepts/payments), [Channels](/channels), and the
[roadmap](/roadmap) for what's implemented today versus what's landing next.

| Variable | Purpose | If unset |
|---|---|---|
| `VITE_PUBLIC_SHOWCASE` | Build-time switch for the sanitized fictional public showcase. | Normal operator-facing build. |
| `VITE_PUBLIC_STAFF` | Independently includes authenticated `/admin/*` routes in a showcase build only when exactly `true`. | Staff routes are excluded from public-showcase bundles. |
| `STRIPE_SECRET_KEY` | Restricted API key used server-side to create Stripe Checkout Sessions. | Stripe isn't "configured" for this deployment — the Stripe button is absent from checkout; guests only see providers that are configured. |
| `STRIPE_WEBHOOK_SECRET` | Verifies that incoming `/webhooks/stripe` requests are authentically from Stripe (signature check) before any booking state changes. | Same as above — a deployment needs both Stripe vars to offer Stripe at all. |
| `SQUARE_ACCESS_TOKEN` | Server-side token used to create Square Payment Links. | Square isn't configured — the Square button is absent from checkout. |
| `SQUARE_LOCATION_ID` | The Square location the Payment Link is created against. | Same as above. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Verifies incoming `/webhooks/square` requests are authentically from Square. | Same as above. |
| `SQUARE_ENV` | `'sandbox'` or `'production'` — selects which Square API base URL and credentials set applies. | Defaults to sandbox behavior; always set explicitly for a real deployment so you don't accidentally run production traffic against sandbox credentials (or vice versa). |
| `SITE_URL` | Frontend origin used to build Checkout success/cancel redirect URLs, Payment Link redirects, and links inside guest emails. | Checkout session creation and email links can't be built correctly — set this before enabling any real provider. |
| `EMAIL_PROVIDER` | Selects `resend`, `mail_bridge`, or `log_only`. | Uses Resend when its key exists; otherwise safely logs. `DEMO_MODE=true` always forces log-only. |
| `RESEND_API_KEY` | Server-held bearer token for the optional Resend provider. | Resend is unavailable; choose the SMTP bridge or log-only mode. |
| `EMAIL_FROM` | The stored sender identity, e.g. `'Pinewood Flats <stays@pinewood.example>'`. | Falls back to a generic identity. Set it for either Resend or SMTP. |
| `MAIL_BRIDGE_TOKEN` | Random bearer secret shared by Convex and the local SMTP worker. It never enters Vite/browser state. | Authenticated SMTP claims are disabled. |
| `DEMO_MODE` | `"true"` ONLY on the public demo deployment. Enables simulated payments (`bookings.confirmSimulated`) and the nightly reset cron. | Real payment providers and real staff-managed data are in play — this is the correct state for every real operator deployment. |
| `JWT_PRIVATE_KEY` | Convex Auth's RS256 private key (PKCS8 PEM) used to sign staff session JWTs. | Staff sign-in cannot issue valid sessions — the `/admin/login` flow will fail. Generate this once per deployment; see [self-hosting](/self-hosting). |
| `JWKS` | The matching public JWKS document Convex Auth uses to verify the JWTs `JWT_PRIVATE_KEY` signs. | Same as above — these two are generated together and both required. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app client id/secret, enabling "Sign in with GitHub" on the login page. | That pair isn't fully set — the GitHub button is simply absent from the login page. Password sign-in is unaffected. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client id/secret, enabling "Sign in with Google." | Same graceful-degradation pattern — the Google button is absent. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Microsoft Entra ID app registration client id/secret, enabling "Sign in with Microsoft." | Same pattern — the Microsoft button is absent. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Optional. Restricts Microsoft sign-in to a single tenant's issuer URL instead of accepting any Microsoft account. | Microsoft sign-in (if that pair above is set) accepts any Microsoft account rather than one tenant. |
| `CHANNEX_API_KEY` | The `user-api-key` value for the [Channex](https://channex.io) channel manager (M6 — scaffolded, dormant). Its presence is what flips channel sync from off to configured. | **Channel sync is simply off.** No availability/rates are pushed, the booking-revisions feed isn't polled, the admin Channels page shows "not configured," and the booking flow is completely unaffected. This is the default and the correct state for any deployment not using OTA distribution — see [Channels](/channels). |
| `CHANNEX_BASE_URL` | Channex API base URL. | Defaults to `https://staging.channex.io`. Point at the production base URL only after Channex certifies your integration and issues production credentials — verify the exact production host during certification. |
| `CHANNEX_WEBHOOK_SECRET` | A shared secret you invent and register on the Channex webhook so OpenStays can validate the inbound nudge (Channex has no HMAC signing — this static header is the only check). | The `/webhooks/channex` nudge isn't secret-checked, and inbound OTA bookings still arrive reliably on the 2-minute pull-feed poll (the webhook is only a latency optimization, never the authoritative path). |

Note `JWT_PRIVATE_KEY`/`JWKS` gate **staff/admin** auth only. Guests never
have accounts — manage-booking access is confirmation code + email match, as
today (see binding convention #10 in `CLAUDE.md`). The `AUTH_GITHUB_*` /
`AUTH_GOOGLE_*` / `AUTH_MICROSOFT_ENTRA_ID_*` variables are additional
staff/admin sign-in methods layered on top of the same session machinery —
none of them changes what a signed-in account can do; that's still entirely
gated on a `staffProfiles` row (see
[Staff & auth](/concepts/staff-auth)).

## SMTP delivery and local capture

`openstays mail-bridge` reads `OPENSTAYS_URL`, `MAIL_BRIDGE_TOKEN`, and the
standard local worker variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USERNAME`, `SMTP_PASSWORD`, and `MAIL_BRIDGE_POLL_MS`. Convex—not the
worker—is authoritative for rendered content, deduplication, queue state,
leases, and retry audit. The worker sends claimed mail sequentially and never
puts credentials in its command line or logs.

The included Mailpit profile binds SMTP to `127.0.0.1:1025` and its inbox to
`127.0.0.1:8025`. It captures mail locally and does not deliver it. Generic
SMTP keeps deployment portable: an operator can later point the same worker at
a hosted service or a separately self-hosted Postal instance. Rotate
`MAIL_BRIDGE_TOKEN` by stopping the worker, setting a new Convex value, and
restarting it with the matching value.
