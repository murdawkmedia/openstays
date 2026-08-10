# Kokanee-first reservation command center

The command center expands OpenStays from a fixed booking tape into a staged
property-management workspace for independent campgrounds and small resorts.
Kokanee defines the workflow priorities, but the source contains only generic
models and fictional fixtures—no Kokanee inventory, branding, guests, or
operator data.

## Release status

The code is additive and disabled per property until an operator explicitly
enables its feature flags. It does not change an existing public showcase or
operator deployment merely by being merged.

| Flag | Workspace |
|---|---|
| `command_center` | 30/45/60/90-day grid, search, block, move/resize, quote, waitlist, call, complimentary, and rate workflows |
| `front_desk` | arrivals, departures, staying-over, check-in, no-show, and checkout |
| `housekeeping` | service-state board, assignments, inspection, and readiness |
| `maintenance` | repair tasks and optional dated inventory blocks |
| `commerce` | booking/retail folios, immutable entries, manual payments, reversals, and gift certificates |
| `night_audit` | daily preview, immutable closeout snapshot, report, and accounting export |
| `groups` | non-occupying group prospects and reminders |
| `long_term` | seasonal contract records and payment schedules |

An absent flag is disabled. The staff shell may show a staged explanation, but
write controls remain unavailable until the relevant flag is enabled.

## Roles and authority

Staff access is property scoped. Fixed roles are `owner`, `manager`,
`front_desk`, `housekeeping`, and `accounting`; the capability matrix lives in
`shared/operations.ts`. Every mutation:

1. derives the person from Convex Auth or a short-lived API automation claim;
2. verifies an active assignment for the selected property;
3. checks the role capability and feature flag;
4. accepts a caller-supplied idempotency request ID;
5. checks the expected record version when editing existing state; and
6. appends an actor-attributed audit event.

The idempotent `staff:backfillPropertyAssignments` internal migration maps
legacy owners to `owner` and legacy staff to `front_desk` for each active
property. Run and inspect it before enabling a property. The legacy fallback
keeps existing profiles readable during that migration; once a profile has any
explicit assignment, access to every other property must be explicit.

The private operational search index is rebuilt with
`operationalSearch:rebuild`. It is staff-only, property-bounded, capped, and
contains the normalized contact fields needed for operations. Search documents
are never queried by the public tour.

## Operational invariants

- `bookings` remain occupancy authority; `unitNights` remain conflict
  authority.
- Move and resize release and reacquire nights in one serializable mutation.
  A conflict aborts the transaction and preserves the original reservation.
- Quotes and waitlist entries never occupy inventory. Accepting a quote
  rechecks inventory and creates the standard 35-minute hold.
- Housekeeping readiness is independent of sellability. Only an explicit
  maintenance block removes inventory.
- Payments remain settlement authority. Folio entries reference payments but
  never replace or reinterpret them.
- Posted folio entries are immutable. Corrections create equal-and-opposite
  reversal entries.
- Complimentary authorization preserves the original booking value and records
  the approved zero-value adjustment separately.
- Every occupancy mutation dirty-marks channel availability. Channex remains an
  optional, certification-gated channel-manager adapter—not a direct OTA API.

## Automation

Accepted workspaces and workflows are available from `/api/v1/operations/*`,
the `openstays ops` / `openstays ops-action` CLI commands, and the matching MCP
tools. A write key does not become a deployment-wide superuser: it inherits the
active property role of the owner who minted it. The HTTP layer issues a random,
single-use, 60-second claim; the normal browser mutation consumes that claim in
the same transaction as the operation. Successful automation records both the
staff actor and API-key provenance. Expired claims are cleaned in bounded
batches, and each key is capped at 100 outstanding claims to prevent failed
requests from growing the claim table without limit. This keeps UI, API, CLI,
and MCP on one business path and one audit trail.

See [Automation](/automation) for request examples.

## Safe rollout

1. Deploy the schema with every new feature flag absent or false.
2. Run the property-assignment backfill twice and confirm the second run inserts
   zero rows.
3. Enable `command_center` on a non-production property and rebuild its private
   search index.
4. Exercise block, quote acceptance, conflict rollback, move/resize,
   complimentary approval, and audit attribution.
5. Enable and accept front desk, housekeeping, maintenance, commerce, closeout,
   groups, and long-term workspaces independently.
6. Keep public staff routes excluded unless the build explicitly sets
   `VITE_PUBLIC_STAFF=true`.
7. Promote only after the root, CLI, docs, Cloudflare operations, and browser
   gates pass. Disable an individual flag to roll back that workspace without
   disabling guest booking or payment reconciliation.
