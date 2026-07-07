# Changelog

## Unreleased (M0)

- Promo codes, Shopify-style: percent or fixed-amount, active windows,
  total-usage caps, once-per-customer, minimum spend, unit-type scoping.
  Redemptions are reserved at hold time, applied on confirmation, and
  released (with the usage slot returned) on expiry or cancellation — all
  inside the same serializable transactions that move the booking. Discounts
  are snapshotted onto the booking so editing a code never rewrites history.
- Accounting distinction enforced in the price breakdown: a promo code is a
  **pre-tax price reduction** (GST is charged on the discounted base) while a
  gift certificate is a **post-tax payment method** (GST on the full amount,
  certificate pays down the total). Deposits compute on total − gift cert.
- Public booking flow (Pinewood Flats demo): property → stay → date-range
  picker with live availability → add-ons → discount code with live preview →
  guest details → hold → simulated demo payment → reactive confirmation page;
  manage/cancel by confirmation code + email; admin booking tape (auth in M1).
- VitePress docs site (quickstart, configuration, self-hosting, concepts,
  roadmap) and GitHub Actions CI + Pages workflows.

- Schema v1: properties, unit types (nightly + seasonal modes), units,
  rate plans (seasons, min/max stay, lead time, prep buffers, deposit +
  cancellation policies), guests, bookings (10-state lifecycle), derived
  `unitNights` occupancy, payments, webhook idempotency ledger, add-ons,
  seasonal contracts (skeletal), gift certificates (skeletal), email log,
  settings.
- Booking core: `createHold` (serializable conflict check + 35-min TTL),
  hold-expiry cron, guest cancellation with policy refunds, confirmation-code
  lookup, `repairUnitNights` invariant repair.
- Pure pricing module shared by client and server: seasonal nightly rates,
  weekly-block pricing, GST single-rounding, deposits, refund windows.
- Per-unit iCal export feed (secret-token `.ics`, loop-prevention).
- Seed: fictional Pinewood Flats Campground (3 cabins, 1 yurt, 10 RV sites).
- Demo mode: simulated payment path + nightly reset (gated by `DEMO_MODE`).
- Test suite: pricing math (GST rounding, boundaries, weekly blocks, refund
  windows) + booking-conflict/expiry/invariant tests via convex-test.
