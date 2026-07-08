# Roadmap

OpenStays is early and moving fast. This table is the condensed milestone
plan — see `CLAUDE.md` and `CHANGELOG.md` in the repo for the fully detailed,
living version.

| Milestone | Focus |
|---|---|
| **M0** | Scaffold + demo. Schema v1, hold/expiry/conflict-proof booking core, GST/deposit/refund pricing math, per-unit iCal export, simulated demo payment path, Pinewood Flats seed, minimal public booking flow. |
| **M1** (in progress) | Bookable engine goes live for real guests. See checklist below. |
| **M2** | Front-desk core: front-desk booking views, add-ons folio, Square in the front-desk flow, manual (cash/e-transfer/terminal) payment recording. |
| **M3** | Hardening — load testing, edge-case coverage on the availability/hold core. |
| **M4** | Seasonal site contracts (the `seasonalContracts` table goes from skeletal to fully wired — invoicing schedules, renewal offers), gift certificates (ledger goes from skeletal to redeemable), reporting. Agreement e-signing for seasonal contracts: a lightweight built-in flow (client-side PDF + on-device signature capture) as the default, with an optional [DocuSeal](https://github.com/docusealco/docuseal) integration for remote, email-based signing with audit trails — DocuSeal is open source, self-hostable, and consumed over its API as a separate service, so it pairs cleanly with this MIT codebase. Renewal season is the killer use case: emailing a couple hundred seasonal agreements beats collecting signatures one clipboard at a time. |
| **M5** | 1.0. |

### M1 checklist (in progress — not shipped)

- [ ] **Real payments** — Stripe Checkout + Square Payment Links behind the
      `PaymentProvider` interface, real webhook-driven confirmation
      (`convex/payments/*`), executed refunds.
- [ ] **Staff/admin authentication** — Convex Auth email+password sign-in;
      a signed-up user grants nothing until an active `staffProfiles` row
      exists (bootstrap command or owner grant).
- [ ] **Transactional email** — guest confirmation/cancellation email via
      Resend, with a log-only fallback when unconfigured.
- [ ] **iCal import** — a 15-minute cron pulls external calendars in;
      imports never clobber internal bookings, conflicts are flagged for
      staff to resolve manually.

See [Payments](/concepts/payments) for the lifecycle and trust-model detail
behind each of these, and [Configuration](/configuration) /
[Self-hosting](/self-hosting) for the env vars and setup steps. None of the
above is live yet in the sense of "point a real deployment at real guests" —
this section tracks what's landing, not what's shipped.

## Not planned for v1

**OTA channel management** (Airbnb / Booking.com / Expedia partner APIs) is
explicitly out of scope for v1. Those integrations are partner-gated and not
buildable by an independent project without a partnership agreement.
v1 distribution is **direct bookings on your own site + per-unit iCal
sync with direct listings** — good enough to keep an Airbnb calendar from
double-booking against your direct site, but not a replacement for a full
channel manager. Channel management may be revisited post-1.0, contingent on
partner access; nothing in this project currently promises it, and no docs,
UI copy, or commit message should imply otherwise.
