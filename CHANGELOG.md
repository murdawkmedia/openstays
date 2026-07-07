# Changelog

## Unreleased (M0)

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
