# OpenStays

**Open-source booking engine and property-management system for independent
lodging — campgrounds, cabins, glamping, yurts, small resorts.**

Built by operators who got tired of legacy reservation systems with no API, no
iCal, and seven clicks to book a cabin. OpenStays is dogfooded in production at
a real lakeside property in Alberta, Canada.

> **Status: early & moving fast.** The booking core (availability, holds,
> conflict-proof reservations, pricing/GST, cancellation policies, per-unit
> iCal export) is in and tested. Stripe + Square checkout, staff auth, and the
> front-desk views are landing next. Watch the repo.

## What it is

- **Guest booking flow** — availability calendar → date-range checkout →
  payment → email confirmation. No guest accounts required.
- **Double-booking-proof by construction** — reservations are written inside
  serializable ACID transactions ([Convex](https://convex.dev)) against a
  derived per-night occupancy table. Two guests can't take the same night,
  even clicking Pay at the same instant.
- **Real-world lodging rules** — seasonal rates, min/max stay, lead time,
  booking windows, prep/turnover buffer nights, deposits (full / percent /
  flat / first-night), time-windowed cancellation policies, taxable and
  non-taxable add-ons, GST/tax with single-rounding on the aggregate base.
- **Per-unit iCal in/out** — every unit gets a secret-token `.ics` feed, so
  direct-listed Airbnb calendars (and legacy PMS bridges) stay in sync.
- **Money is integer cents. Dates are property-local. Nights are half-open.**
  The boring correctness decisions are made and enforced by tests.

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

## License

[MIT](./LICENSE) © Murdawk Media
