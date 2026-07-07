# Availability & holds

The project's first principle is "never lose a booking, never double-book."
This page explains the mechanics that make that a guarantee rather than a
hope.

## Half-open nights

A stay is represented as `[checkIn, checkOut)` — a half-open range. If a
guest checks in `2026-07-15` and checks out `2026-07-18`, the occupied
nights are `07-15`, `07-16`, `07-17`. The 18th is free, and another guest
can check in that same day. This is why date math throughout the codebase
uses `enumerateNights(checkIn, checkOut)` from `shared/pricing.ts` rather
than inclusive ranges — getting this boundary wrong by one day is exactly
the kind of bug that either strands a night nobody can book or double-books
a turnover day.

## The derived `unitNights` table

`unitNights` is the single source of truth for "is this unit occupied on
this night." It's a derived table: one row per **blocked unit-night**, with
a `kind` of `stay` (an actual guest night), `prep` (a turnover buffer night
after checkout — see below), `external` (imported from an iCal feed, e.g.
Airbnb), or `block` (manual maintenance/owner block).

The invariant (enforced by convention and covered by tests, not by a
database constraint Convex doesn't have): **a row exists in `unitNights` if
and only if an active booking covers that night.** Rows are written and
deleted *only* inside the same mutation that changes the owning booking's
status — never as a separate step, never by a background job reconciling
later. When a hold expires, gets cancelled, or is otherwise released, the
same transaction that flips the booking's status also deletes its
`unitNights` rows.

## Why conflict checking is one indexed read

Because `unitNights` already reflects exactly what's occupied, checking
whether a new stay request overlaps an existing booking is **one indexed
range read** against the `by_unit_date` index — not a full table scan, not
a `.collect()`-then-filter over every booking for the unit. From
`convex/bookings.ts`:

```ts
const conflict = await ctx.db
  .query('unitNights')
  .withIndex('by_unit_date', (q) =>
    q.eq('unitId', args.unitId).gte('date', args.checkIn).lt('date', blockedUntil),
  )
  .first();
if (conflict) {
  throw new ConvexError({ code: 'DATES_UNAVAILABLE', message: 'Those dates were just taken.' });
}
```

This check and the subsequent insert of the booking row plus its
`unitNights` rows all happen inside **one Convex mutation**, and Convex
mutations are serializable transactions. That's what makes the "two guests
click Pay at the same instant" case safe: the two `createHold` calls are
serialized by Convex, and whichever runs second sees the first one's
`unitNights` rows already present and gets the conflict error. There's no
window where both can succeed — no distributed lock to manage, no optimistic
retry logic to get subtly wrong.

## Holds: 35-minute TTL, and why not 30

A booking starts life in `status: 'hold'` the moment a guest picks dates and
submits the checkout form — before any payment happens. This reserves the
nights (via the same `unitNights` rows described above) so nobody else can
take them while the guest is on the payment page.

The hold TTL is **35 minutes** (`HOLD_TTL_MS` in `convex/bookings.ts`), and
that number isn't arbitrary: Stripe Checkout Sessions cannot be configured
to expire sooner than **30 minutes** after creation. If the OpenStays hold
expired at or before 30 minutes, there would be a guaranteed window where
the Convex hold has already released the nights but the Stripe Checkout
page is still live and could still complete a payment against a
now-available (or now-rebooked) night. Giving the hold 5 extra minutes of
headroom, and having the checkout-creation step (M1) refuse to start a
Stripe session against a hold with less than 31 minutes left, closes that
gap in both directions.

## Expiry cron

A cron job (`convex/crons.ts`) runs every 2 minutes and calls
`bookings.expireHolds`, which finds bookings still in `status: 'hold'` whose
`holdExpiresAt` has passed, releases their `unitNights` rows, and flips them
to `status: 'expired'`. This is a plain internal mutation, not a
best-effort background sweep with eventual consistency concerns — each
expiry is a normal serializable transaction like any other status change.

## Prep buffer nights

Some unit types need turnover time between stays — cleaning a cabin, or
resetting a glamping yurt. `ratePlans.prepBufferNights` blocks that many
extra nights *after* checkout from being booked, recorded as `kind: 'prep'`
rows in `unitNights` alongside the `stay` rows. The conflict-check range
read above already accounts for this: the blocked range extends from
`checkIn` through `checkOut + prepBufferNights` days, so a request that
would land inside another booking's prep tail is rejected the same way a
double-booked night would be.
