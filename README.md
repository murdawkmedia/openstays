# OpenStays

> **Bitcoin++ Toronto 2026 hackathon branch:** “Consensus Commons” adds
> authoritative Zaprite sandbox reconciliation, Wavelength signet payments,
> privacy-safe OpenTimestamps receipts, one-time 1,000 signet-sat rewards,
> provider-neutral OpenStays Mail,
> a bridge and browser wallet, booking-scoped chat, manual refund operations,
> and a consensus timeline. These rails are experimental and local-first; no
> production Zaprite, Wavelength mainnet, Channex
> certification, or customer inventory is included. See
> [the hackathon runbook](./docs/hackathon-mvp.md).

> **Public showcase candidate:** Consensus Commons can run as an explicitly
> fictional product demo with an exact CA$1 Zaprite contribution, an exact
> 1,000-sat Wavelength signet payment, a no-charge simulated tour, privacy-safe
> OpenTimestamps receipts, and one budgeted 1,000-sat signet reward. Live rails
> fail closed and remain disabled until deployment-specific acceptance passes.
> See [Public live payments](./docs/public-live-payments.md) and the
> [operator runbook](./docs/operations/public-live-payments-runbook.md).
> Visitors can explore a source-controlled, no-login backend simulation at
> `/tour/operations`; it never queries live bookings or exposes guest data.

> **Kokanee-first PMS expansion:** the source now includes a feature-gated,
> property-scoped reservation command center with 90-day inventory views,
> front-desk queues, housekeeping and maintenance, immutable folios, manual
> payment recording, night audit, groups, and seasonal-contract foundations.
> It is additive and disabled per property until migration and acceptance are
> complete; the existing public showcase and live deployment are unchanged.
> See [Reservation command center](./docs/command-center.md).

**Open-source booking engine and property-management system for independent
lodging — campgrounds, cabins, glamping, yurts, small resorts.**

Built by **[SebaHub](https://www.sebahub.com)** — a lakeside community hub in
Seba Beach, Alberta, Canada — after getting tired of legacy reservation systems
with no API, no iCal, and seven clicks to book a cabin. OpenStays is dogfooded
in production on SebaHub's own lodge, cabins, geodomes, yurts, and RV park.

> **Status: early & moving fast.** M1's conflict-proof booking core, Stripe and
> Square checkout, staff auth, guest email, and two-way iCal sync are shipped
> and test-covered. Consensus Commons is an experimental hackathon layer.

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

### M1 — shipped; hackathon rails experimental

Shipped in the source tree; operator configuration and live acceptance remain deployment-specific. See the
[roadmap](https://murdawkmedia.github.io/openstays/roadmap) for status:

- **Real payments via Stripe & Square** — Stripe Checkout and Square Payment
  Links behind one `PaymentProvider` interface, confirmation driven by
  verified webhooks (never a client redirect), executed refunds.
- **Staff logins** — Convex Auth email+password for the admin/front-desk
  side, plus optional "Sign in with GitHub / Google / Microsoft" once a
  deployment sets that provider's credentials; a signed-up account (by any
  method) grants nothing until explicitly promoted to staff. Every staff
  action is recorded in an append-only activity audit log, viewable in
  Settings.
- **Guest emails** — booking, chat, and refund notices via optional Resend or
  the authenticated generic SMTP bridge, with loopback Mailpit capture and a
  safe log-only fallback when unconfigured.
- **Two-way iCal** — a 15-minute import cron pulls external calendars in
  alongside the existing per-unit export, so a direct Airbnb listing and
  this deployment stay in sync in both directions. Imports never override an
  internal booking; conflicts are flagged for staff, not auto-resolved.
- **Public operations tour** — a curated fictional booking tape, payments,
  messages, refunds, receipts, rewards, channel state, and treasury preview
  that is interactive but entirely read-only. Public staff routes remain
  excluded unless a showcase build explicitly sets `VITE_PUBLIC_STAFF=true`.
- **Two Wavelength checkout paths** — the embedded self-custodial signet
  wallet remains primary; a valid merchant BOLT11 also offers **Pay using
  Wavelength’s official demo wallet** at
  <https://wavelength.lightning.engineering/demo/>. Both paths pay the same
  invoice, and only the authenticated merchant receive confirms the booking.

### Property-scoped operations

The private staff console now has fixed owner, manager, front-desk,
housekeeping, and accounting roles; a persistent property/staff shell; private
global search; a virtualized 30/45/60/90-day grid; and audited booking,
service, folio, closeout, group, and long-term workflows. Each workspace is
released independently through a reversible property feature flag.

## What it is NOT (yet)

- **No direct OTA channel management.** Airbnb / Booking.com / Expedia APIs are
  partner-gated and not buildable by an independent v1. Distribution today =
  your own site (direct bookings) + iCal sync with direct listings. A
  **channel-manager integration ([Channex](https://channex.io)) is scaffolded
  but dormant** (`convex/channel/**`, M6): connect it — a Channex account, one
  env var, object mapping, and Channex-side certification — to distribute to the
  OTAs *through* Channex. It is **not** a direct-OTA-API integration and is
  **not live in v1 by default**. See [docs/channels.md](./docs/channels.md).
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

## Automation (API / CLI / MCP)

Everything the guest and staff UI can do is also available over a versioned
HTTP API (`/api/v1`, API-key auth) backed by the same Convex queries and
mutations — no parallel business logic, so every booking guarantee holds for
automations too. A standalone CLI + MCP server ship in [`cli/`](./cli) as a
thin, well-tested client over that API: `openstays health|properties|
availability|bookings|hold|cancel|...`, plus `openstays mcp` for MCP clients
like Claude. See [docs/automation.md](./docs/automation.md) for the full
guide (getting a key, every command, MCP client config).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | [Convex](https://convex.dev) | Serializable transactions (booking safety), realtime queries, crons, file storage, HTTP endpoints. Free tier; self-hostable. |
| Frontend | React + Vite + TypeScript + Tailwind | Static output — host anywhere (GitHub Pages, Cloudflare Pages, Netlify…). |
| Payments | Stripe + Square; experimental Zaprite + Wavelength | Hosted providers share an interface; Wavelength stays a separate authenticated, signet-only bridge rail. |
| Email | OpenStays Mail | Provider-neutral durable queue with generic SMTP, local Mailpit, optional Resend, and safe log-only fallback. |

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
