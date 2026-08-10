# Roadmap

OpenStays is early and moving fast. This table is the condensed milestone
plan — see `CLAUDE.md` and `CHANGELOG.md` in the repo for the fully detailed,
living version.

| Milestone | Focus |
|---|---|
| **M0** | Scaffold + demo. Schema v1, hold/expiry/conflict-proof booking core, GST/deposit/refund pricing math, per-unit iCal export, simulated demo payment path, Pinewood Flats seed, minimal public booking flow. |
| **M1** (shipped in source) | Payments, staff auth, transactional email, and two-way iCal are implemented and test-covered; each deployment still completes its own provider configuration/live acceptance. |
| **Consensus Commons** (experimental) | Bitcoin++ Toronto MVP: Zaprite sandbox reconciliation, Wavelength signet payments, OpenTimestamps consensus receipts, one-time 1,000 signet-sat rewards, booking chat, manual refund cases, OpenStays Mail, and consensus timeline. Not production rails. |
| **Kokanee command center** (implemented, feature-gated) | Property-scoped roles and shell; 30/45/60/90-day grid; operational search; audited reserve/block/quote/repair/call/complimentary/retail/move/resize/rate workflows; front desk; housekeeping; maintenance; immutable folios; manual payment records; night audit; reporting; groups and seasonal-contract foundations. Promotion remains deployment-specific. |
| **M2** (implemented behind flags) | Front-desk queues, record-only folios and retail, and cash/e-transfer/cheque/external-terminal payment recording. Card-present hardware control remains out of scope. |
| **M3** | Hardening — load testing, edge-case coverage on the availability/hold core. |
| **M4** | Complete seasonal operations: automated invoicing and renewal offers, redeemable gift certificates, and agreement e-signing. The preferred future shape is a lightweight built-in signing flow plus an optional self-hosted [DocuSeal](https://github.com/docusealco/docuseal) integration for remote delivery and audit trails. |
| **M5** | 1.0. |
| **M6** | OTA distribution via the [Channex](https://channex.io) channel manager. The plumbing is already **scaffolded** in this snapshot — a `ChannelManagerProvider` contract, the availability/rates push, the OTA-booking pull/ack ingest, the admin mapping surface, the schema fields, crons, and webhook route (`convex/channel/**`) — but it is **dormant until an operator connects it**. Going live still requires an operator to hold a Channex account, set `CHANNEX_API_KEY`, map objects, do the OTA-side mapping in Channex's dashboard, **and pass Channex's production certification**. It is *not* a direct Airbnb/Booking.com API integration (those stay partner-gated) and *not* a shipped v1 feature — see [Channels](/channels). |

> **M4 scope correction:** the command-center branch implements feature-gated
> seasonal contract records and balanced schedules, group prospects, reminders,
> gift-certificate issuance, night-audit snapshots, and reports. Renewal offers,
> full certificate redemption, invoicing automation, and e-signature delivery
> remain future work; “fully wired” should not be inferred from the schema.

### M1 checklist (shipped in source)

- [x] **Real payments** — Stripe Checkout + Square Payment Links behind the
      `PaymentProvider` interface, real webhook-driven confirmation
      (`convex/payments/*`), executed refunds.
- [x] **Staff/admin authentication** — Convex Auth email+password sign-in;
      a signed-up user grants nothing until an active `staffProfiles` row
      exists (bootstrap command or owner grant).
- [x] **Transactional email** — durable provider-neutral OpenStays Mail queue,
      generic SMTP bridge and Mailpit capture, optional Resend, and log-only fallback.
- [x] **iCal import** — a 15-minute cron pulls external calendars in;
      imports never clobber internal bookings, conflicts are flagged for
      staff to resolve manually.

See [Payments](/concepts/payments) for the lifecycle and trust-model detail
behind each of these, and [Configuration](/configuration) /
[Self-hosting](/self-hosting) for the env vars and setup steps. None of the
above becomes production-ready merely by existing in source: operators must
configure providers and complete their own live acceptance before real guests.

## OTA channel management (M6 — scaffolded, dormant, not a v1 feature)

**Direct** OTA integrations (Airbnb / Booking.com / Expedia partner APIs)
remain out of scope: those APIs are partner-gated and not buildable by an
independent project without a partnership agreement. OpenStays does **not** and
will not talk to them directly.

What *is* now in the tree (M6-prep) is the plumbing to distribute through **one
channel manager, [Channex](https://channex.io)**, which holds the OTA
partnerships and fans out to Booking.com / Airbnb / Expedia / VRBO. The
provider contract, the availability/rates push, the OTA-booking pull-and-ack
ingest, the admin mapping surface, the schema fields, the crons, and the
`/webhooks/channex` route are all scaffolded (`convex/channel/**`) — but
**dormant by default**. A deployment does nothing with any of it until an
operator sets `CHANNEX_API_KEY`, maps objects, and does the OTA-side mapping in
Channex's dashboard, and **OTA distribution only goes live after Channex's
production certification**. See [Channels](/channels) for the full operator
guide.

To be precise about scope: this is **not a shipped v1 feature**. The foundation
is in place, but out of the box a deployment still distributes exactly as v1
promises — **direct bookings on your own site + per-unit iCal sync with direct
listings**, good enough to keep an Airbnb calendar from double-booking against
your direct site. No docs, UI copy, or commit message should imply channels are
live by default or that OpenStays speaks to any OTA API directly.
