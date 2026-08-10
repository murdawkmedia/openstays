---
layout: home

hero:
  name: OpenStays
  tagline: Open-source booking engine & PMS for independent lodging
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/murdawkmedia/openstays

features:
  - title: Double-booking-proof by construction
    details: >-
      Reservations are written inside serializable ACID transactions
      (Convex) against a derived per-night occupancy table. Two guests
      can't take the same night, even clicking Pay at the same instant.
  - title: Real-world lodging rules
    details: >-
      Seasonal rates, min/max stay, lead time, booking windows, prep/turnover
      buffer nights, deposits (full / percent / flat / first-night),
      time-windowed cancellation policies, taxable and non-taxable add-ons.
  - title: Per-unit iCal in/out
    details: >-
      Every unit gets a secret-token .ics feed, so direct-listed Airbnb
      calendars and legacy PMS bridges stay in sync.
  - title: Your own deployment, your own data
    details: >-
      No SaaS — each operator runs their own Convex deployment. Free tiers
      get you to ~$0/month, and self-hosting is possible with the open-source
      convex-backend if you want everything on your own infrastructure.
  - title: Campground-first command center
    details: >-
      Property-scoped staff roles, a 30/45/60/90-day reservation grid,
      operational search, front desk, housekeeping, maintenance, immutable
      folios, night audit, groups, and seasonal records—released per property
      behind reversible feature flags.
---
