# OpenStays

**Open-source booking engine and property-management system for independent
lodging — campgrounds, cabins, glamping, yurts, small resorts.**

Built by **[SebaHub](https://www.sebahub.com)** — a lakeside community hub in
Seba Beach, Alberta, Canada — after getting tired of legacy reservation systems
with no API, no iCal, and seven clicks to book a cabin. OpenStays is dogfooded
in production on SebaHub's own lodge, cabins, geodomes, yurts, and RV park.

> **Status: early & moving fast.** The booking core (availability, holds,
> conflict-proof reservations, pricing/GST, cancellation policies, per-unit
> iCal export) is in and tested. Stripe + Square checkout, staff auth, guest
> email, and two-way iCal sync are landing now (M1 — in progress). Watch the
> repo.

## What it is

- **Guest booking flow** — availability calendar → date-range checkout →
  payment → email confirmation. No guest accounts required.
- **Double-booking-proof by construction** — reservations are written inside
  serializable ACID transactions ([Convex](https://convex.dev)) against a
  derived per-night occupancy table. Two guests can't take the same night,
  even clicking Pay at the same instant.
- **Real-world lodging rules** — seasonal rates, min/max stay, lead time,
  booking windows, prep/turnover buffer nights, deposits (full / percent /
  flat / first-night), time-windowed cancellation policies, promo codes,
  taxable and non-taxable add-ons, tax with single-rounding on the aggregate
  base (GST/VAT/sales-tax label configurable).
- **Multi-currency** — CAD by default (we're Canadian), with USD and EUR
  offered out of the box; currency is configured per property and every
  price in the guest flow formats accordingly.
- **Per-unit iCal export** — every unit gets a secret-token `.ics` feed, so
  direct-listed Airbnb calendars (and legacy PMS bridges) stay in sync.
- **Money is integer cents. Dates are property-local. Nights are half-open.**
  The boring correctness decisions are made and enforced by tests.

### M1 — in progress

Landing now, not yet live for real guests — see the
[roadmap](https://murdawkmedia.github.io/openstays/roadmap) for status:

- **Real payments via Stripe & Square** — Stripe Checkout and Square Payment
  Links behind one `PaymentProvider` interface, confirmation driven by
  verified webhooks (never a client redirect), executed refunds.
- **Staff logins** — Convex Auth email+password for the admin/front-desk
  side; a signed-up account grants nothing until explicitly promoted to
  staff.
- **Guest emails** — booking confirmation and cancellation email via Resend,
  with a safe log-only fallback when unconfigured.
- **Two-way iCal** — a 15-minute import cron pulls external calendars in
  alongside the existing per-unit export, so a direct Airbnb listing and
  this deployment stay in sync in both directions. Imports never override an
  internal booking; conflicts are flagged for staff, not auto-resolved.

## What it is NOT (yet)

- **No OTA channel management.** Airbnb / Booking.com / Expedia APIs are
  partner-gated and not buildable by an independent v1. Distribution today =
  your own site (direct bookings) + iCal sync with direct listings. Channel
  management is a post-1.0 roadmap item, contingent on partner access.
- No SaaS — each operator runs their own deployment (that's a feature: your
  guest data lives in your own project, and the free tiers make it ~$0/month).
- No card-present / POS hardware integration (record-only cash / e-transfer /
  terminal entries cover the front desk).

## Quickstart

```bash
git clone https://github.com/murdawkmedia/openstays
cd openstays
npm install
npx convex dev          # creates your free Convex dev deployment
npm run seed            # loads the fictional Pinewood Flats Campground
npm run dev             # http://localhost:5173
```

Book a stay at Pinewood Flats, then open the admin tape and watch it appear
live. Your real inventory is **data, not code** — see `docs/configuration.md`.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | [Convex](https://convex.dev) | Serializable transactions (booking safety), realtime queries, crons, file storage, HTTP endpoints. Free tier; self-hostable. |
| Frontend | React + Vite + TypeScript + Tailwind | Static output — host anywhere (GitHub Pages, Cloudflare Pages, Netlify…). |
| Payments | Stripe + Square behind one provider interface | Choose either or both per deployment. Manual (cash/e-transfer) entries built in. |
| Email | Resend | Booking confirmations, cancellations. |

## Project principles

1. **Never lose a booking, never double-book.** Correctness over features.
2. **Simple for the end user** — guests book in a couple of clicks; front-desk
   staff shouldn't need a manual.
3. **Your data is yours.** Own deployment, own database, exportable.
4. **Honest scope.** The feature matrix says what works today, not someday.

## Built by SebaHub

OpenStays is built and run in production by [SebaHub](https://www.sebahub.com),
a lakeside community hub in Seba Beach, Alberta, Canada. If you're visiting
lake country west of Edmonton — come say hi.

## License

[MIT](./LICENSE) © Murdawk Media
