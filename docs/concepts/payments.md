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
provider wiring and staff auth needed to run this for real guests are
**landing now in M1** — see the [roadmap](/roadmap) for the full sequencing,
and the sections below for how the M1 pieces fit together once they're live.

## The hold → checkout → webhook → confirmed lifecycle (M1 — in progress)

This is the full path a real (non-simulated) payment takes, end to end:

1. **Hold.** A guest picks dates and submits checkout. `createHold` writes a
   `bookings` row with `status: 'hold'` and `holdExpiresAt = now + 35
   minutes` (`HOLD_TTL_MS`), plus its `unitNights` rows — see
   [Availability & holds](/concepts/availability) for why 35 minutes and not
   less.
2. **Checkout.** The client asks for a Checkout Session against that hold.
   The checkout action first re-checks freshness: if `holdExpiresAt − now <
   31 minutes`, it refuses outright (`HOLD_TOO_STALE`) rather than start a
   Stripe/Square session it can't guarantee will outlive the hold — Stripe
   Checkout Sessions can't be configured to expire in under 30 minutes, so
   31 minutes of hold headroom is the safety margin. On success, a `payments`
   row is inserted with `status: 'pending'` *before* the guest is redirected
   to the hosted payment page, so the webhook that arrives later always has
   a row to update.
3. **Webhook.** Stripe/Square call back to `/webhooks/stripe` or
   `/webhooks/square` (see `convex/http.ts`). The signature is verified
   first — an unverifiable request is rejected (`400`) and nothing about the
   booking changes. A verified `payment_succeeded` event runs one
   serializable transaction (`internal.bookings.confirmFromPayment`) that
   checks-and-inserts into `webhookEvents` (idempotency — a duplicate
   `eventId` is a no-op), records the payment, and confirms the booking.
4. **Confirmed — the normal case.** If the hold's nights are still reserved
   (the common case), the booking flips to `status: 'confirmed'` and a
   confirmation email is scheduled.
5. **Payment-after-expiry: re-acquire or conflict.** If the hold already
   expired before the payment webhook arrived (nights were released back to
   availability by the 2-minute expiry cron), the same transaction first
   tries to **re-acquire** those exact nights. If they're still free, the
   booking still confirms normally. If someone else has since taken any of
   those nights, the booking instead becomes `status: 'payment_conflict'` —
   the guest *paid*, but OpenStays cannot honor the reservation as booked.
   That triggers an **automatic refund** of the full captured amount (the
   refund executor retries transiently-failing provider calls up to 3 times
   before alerting staff) plus an apology email to the guest. `payment_conflict`
   is a distinct booking status specifically so this rare case is visible on
   the tape and never silently double-booked or silently un-refunded.
6. **Confirmation pages never trust redirects.** The success URL a guest
   lands on after paying renders "finalizing…" until the booking's status —
   read via a live reactive query, not the redirect itself — actually shows
   `confirmed`. The webhook, not the browser coming back from the payment
   page, is what makes a booking real.

## Staff-auth trust model (M1 — in progress)

Guests never have accounts in OpenStays — manage-booking access is
confirmation code + email match, unchanged by M1. **Staff/admin** access is
new in M1, via [Convex Auth](https://labs.convex.dev/auth) (email+password).

The load-bearing rule: **a signed-up user grants nothing**. Signing up
creates a Convex Auth `users` row and nothing else. Every staff-only query or
mutation calls a single chokepoint, `requireStaff()` (`convex/staff.ts`),
which requires an **active `staffProfiles` row** for that user — role
`owner` or `staff`. No `staffProfiles` row (or one with `active: false`) means
`NOT_STAFF`, full stop, regardless of whether the user can sign in.

`staffProfiles` rows only get created two ways:

- **Bootstrap** (`staff:bootstrap`, orchestrator-run, one time, refuses if an
  owner already exists) — turns the first signed-up user into an `owner`.
  See [self-hosting](/self-hosting) for the exact command.
- **An existing owner grants more staff** from the admin UI
  (`staff.grantStaff`), which is the ongoing way a deployment adds front-desk
  accounts after bootstrap.

This two-step design (sign-up is public and free; staff rights are a
separate, gated grant) is what lets `/admin/login` exist on a public-facing
deployment without turning it into an open door — anyone can create a
`users` row, but that row can't read or write anything staff-only until an
owner says so.

## iCal import conflict semantics (M1 — in progress)

Export (`/ical/u/<token>.ics`) has shipped since M0. **Import** — pulling an
external calendar (a direct Airbnb listing, a legacy-PMS bridge) in so it
blocks availability here too — is new in M1, on a 15-minute sync cron.

The binding rule, matching the "never lose a booking" principle from
[Availability & holds](/concepts/availability): **an external event can
never displace an internal booking.** Concretely, per unit and per feed:

- A new external UID becomes a `bookings` row with `status: 'external'`,
  `source: 'ical:<label>'`, and its own `unitNights` rows (`kind:
  'external'`) — same conflict-tracking mechanism as any other booking.
- If dates for an already-imported UID change, its `unitNights` rows are
  deleted and rewritten to match.
- If a UID present in a previous sync is missing from the current feed, that
  external booking is cancelled and its nights released.
- **If an external event's nights overlap nights already held by a
  non-external booking**, the internal booking is left untouched and
  authoritative. Only the external event's *free* nights (if any) get
  `unitNights` rows; the external booking itself is flagged
  (`syncConflict: true`) instead of silently dropped or allowed to steal the
  night. Staff see and resolve the conflict manually on the booking tape —
  there is no automatic cancellation of a real guest's booking to make room
  for an imported one.
- Loop prevention: the export feed never re-emits `kind: 'external'` rows, so
  a sync cycle can't feed back into itself across two linked calendars.

Because conflicts are surfaced, not silently resolved, a property with an
active Airbnb listing should still expect to check the tape periodically
during the transition — iCal sync closes the double-booking gap, it doesn't
replace human judgment on the rare overlap.
