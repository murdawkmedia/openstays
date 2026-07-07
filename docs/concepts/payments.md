# Payments

This page is deliberately blunt about what's real today versus what's
planned, because a booking engine is exactly the kind of project where
marketing copy and actual behavior drifting apart costs someone real money.

## What's implemented today

- **Simulated demo payments.** `bookings.confirmSimulated` lets a hold be
  confirmed without talking to any payment provider. It writes a `payments`
  row with `provider: 'simulated'` and flips the booking to `confirmed`.
  This mutation checks `process.env.DEMO_MODE === 'true'` and throws
  otherwise — it cannot be used to "confirm" a real booking on a production
  deployment by accident.
- **Policy-driven refund math**, fully implemented and tested in
  `shared/pricing.ts` (`computeRefundCents`) and wired into guest-initiated
  cancellation (`bookings.cancelByGuest`):
  - Each rate plan carries a `cancellationPolicy`: an array of
    `{ daysBefore, refundPercent }` windows, sorted descending by
    `daysBefore`. The first window whose `daysBefore` threshold the
    cancellation still satisfies (i.e. `daysUntilCheckIn >= daysBefore`)
    determines the refund percentage of whatever was actually paid.
  - For **simulated/demo** payments, a qualifying refund is recorded inline
    on the `payments` row (`status: 'refunded'` or `'partially_refunded'`,
    with a `refunds[]` ledger entry) — because there's no real provider to
    call back.
  - For real providers, the refund percentage is computed the same way, but
    *executing* it against Stripe/Square is not yet implemented — see M1
    below.
- **GST single-rounding**, implemented in `computePrice()`
  (`shared/pricing.ts`). Tax is rounded exactly once, on the aggregate
  taxable subtotal (nightly charges plus taxable add-ons, minus any
  gift-certificate discount applied proportionally to the taxable share)
  — never accumulated from per-line roundings. This matches CRA guidance for
  GST calculation and avoids the classic "sum of rounded lines != rounded
  sum" discrepancy that shows up on receipts.
- **Deposit policy math**, also in `computePrice()`: `full`, `percent`,
  `flat`, and `first_night` deposit types are all computed today, in the
  same pure function clients use to preview a price and Convex uses to
  charge one.
- **The `payments` schema already models real providers** (`stripe`,
  `square`, `manual`, `gift_certificate`, `simulated`), refund ledgers, and
  webhook idempotency (`webhookEvents`, checked-and-inserted in the same
  transaction as the state change it represents) — so M1 is wiring providers
  into an already-shaped data model, not redesigning it.

## What's landing in M1

- **Real Stripe Checkout integration** — creating a live Checkout Session
  against a hold (refusing to do so with less than 31 minutes of hold time
  remaining, per the 35-minute-hold reasoning in
  [Availability & holds](/concepts/availability)), and confirming bookings
  via verified webhook events rather than a client redirect.
- **Real Square integration** via Square Payment Links — chosen over a
  custom card form specifically so OpenStays doesn't have to build or
  maintain PCI-scoped card-entry UI; the hosted Payment Link page handles
  that.
- **Manual (record-only) payment entries** for front-desk cash / e-transfer /
  POS-terminal transactions, so staff can mark a booking paid without a
  provider in the loop.
- **Executing real refunds** against Stripe/Square (today the *math* is
  correct and tested; *calling the provider's refund API* is not yet built).
- **Staff/admin authentication** (Convex Auth) gating any of the above from
  the front desk.

## Provider-interface plan

Payments are designed behind one `PaymentProvider`-shaped interface so a
deployment can run Stripe, Square, both, or neither (manual-only). This is
why the `payments.provider` column is a union today even though only
`simulated` and `manual` recording paths exist right now — the schema
doesn't need to change when Stripe/Square land, only the mutations that
populate it.

## Deposits vs. balance due

Every price breakdown (`PriceBreakdown` in `shared/pricing.ts`) separates
`depositDueCents` from `balanceDueCents = totalCents - depositDueCents`.
Which one a guest actually pays at booking time is a product decision each
deployment makes via its rate plans' `depositPolicy` — OpenStays doesn't
hard-code "always full payment" or "always a deposit."

## Honesty over marketing

If you're evaluating OpenStays for a real property: as of this snapshot,
**you cannot yet take a real card payment from a guest.** The booking core,
pricing math, refund policy math, and data model are done and tested. The
provider wiring and staff auth needed to run this for real guests land in
M1. See the [roadmap](/roadmap) for the full sequencing.
