---
layout: home

hero:
  name: OpenStays
  tagline: Open-source booking engine & PMS for independent lodging
  actions:
    - theme: brand
      text: Restart & hosting
      link: /restart
    - theme: alt
      text: View on GitHub
      link: https://github.com/murdawkmedia/openstays

features:
  - title: Transactional booking-conflict checks
    details: >-
      Reservations are written inside serializable ACID transactions
      (Convex) against a derived per-night occupancy table. Two guests
      overlapping internal holds are rejected atomically. External calendar
      conflicts still need operator resolution.
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
      Each operator runs a fresh backend and supplies their own inventory.
      The project site is static; managed and self-hosted Convex are options
      for the application. Hosting and providers have their own costs.
  - title: Campground-first command center
    details: >-
      Property-scoped staff roles, a 30/45/60/90-day reservation grid,
      operational search, front desk, housekeeping, maintenance, immutable
      folios, night audit, groups, and seasonal records—released per property
      behind reversible feature flags.
---
