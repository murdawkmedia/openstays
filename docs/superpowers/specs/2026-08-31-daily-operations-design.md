# Daily front-desk and housekeeping operations

Date: 2026-08-31

Status: approved design

## Purpose

This release makes OpenStays more useful during a normal campground or small-resort workday. It expands the existing front-desk queues and housekeeping board with temporary operational flags, dated assignments, checklists, and a shared audit trail.

ResNexus informed the workflow inventory. OpenStays will not copy its source, branding, layout, customer records, or internal terminology. The design keeps OpenStays' existing booking, payment, availability, channel, and property-isolation rules.

## Scope

The release includes:

- front-desk exception flags that do not change booking status;
- richer front-desk queues with compact and detailed views;
- dated housekeeping assignments with cleaning types and expected duration;
- reusable housekeeping checklist templates;
- checklist snapshots attached to an assignment;
- assignment, checklist, inspection, and unit-state history;
- printable and CSV daily work lists;
- links between front-desk records, housekeeping work, bookings, units, and folios;
- the same accepted actions through the API, CLI, and MCP interfaces; and
- fictional public-tour examples with no live queries or mutations.

The release does not include:

- house accounts or accounts receivable;
- till, stock, cost-of-goods, or utility-meter workflows;
- bookable equipment and services;
- marketing automation, general SMS, or newsletter tools;
- custom report building or the wider report catalogue;
- a new payment, booking, or channel-integration path; or
- customer data or Kokanee-specific configuration in the repository.

Those are separate releases because each has its own authority, accounting, privacy, and failure rules.

## Settled vocabulary

### Booking status

Booking status answers whether a reservation is held, confirmed, checked in, checked out, cancelled, a no-show, blocked, or external. It remains occupancy authority together with `unitNights`.

Late checkout, departure overdue, lockout, sleep-out, and payment concern are not booking statuses. They are temporary operational conditions. Resolving one does not rewrite booking history.

### Operational flag

An operational flag is an audited, temporary condition that asks staff to notice or resolve something about a booking. A flag may affect queue placement or attention indicators. It cannot confirm a booking, settle money, release inventory, or change channel availability.

The first supported kinds are:

- `late_checkout`: staff approved or recorded a later departure time;
- `due_out`: the booking is expected to leave during the selected business date;
- `departure_overdue`: the expected departure passed without checkout;
- `lockout`: staff must restrict unit access;
- `sleep_out`: the checked-in guest reported that they would not occupy the unit for a night; and
- `payment_concern`: staff must review a balance or settlement issue.

The UI uses plain labels. It does not use accusatory legacy terms such as "skipper."

### Housekeeping assignment

The existing `housekeepingAssignments` row is the persisted record for one unit's dated service visit. This release extends that record rather than creating a second visit table. Existing rows and APIs remain readable.

### Unit service state

`unitServiceStates` remains the current readiness summary for a unit. It is separate from the assignment history and from sellability. A service-state change never occupies or releases `unitNights`.

### Checklist snapshot

A checklist template defines reusable property instructions. When staff attach it to an assignment, OpenStays copies the template items into assignment-specific checklist rows. Later template edits do not rewrite completed or in-progress work.

## Data model

### `bookingOperationalFlags`

Each row contains:

- `propertyId`, `bookingId`, and the booking's `unitId` snapshot;
- flag kind and severity;
- `open` or `resolved` state;
- a short staff summary and optional bounded note;
- optional due time and responsible staff profile;
- version number;
- creator and creation time;
- last updater and update time; and
- resolver, resolution time, and bounded resolution note when resolved.

Indexes support property-and-state queues, booking history, assignee queues, and due-time scans. Only one open flag of the same kind may exist for a booking. A duplicate request replays the original result. A separate, deliberate request to create the same open condition returns the existing row rather than creating noise.

### `housekeepingAssignments`

Keep every existing field and add optional fields so old rows remain valid:

- cleaning type: `turnover`, `stayover`, `inspection`, `deep_clean`, or `custom`;
- optional custom cleaning label;
- expected duration in whole minutes;
- checklist template reference and template-version snapshot;
- assignment note;
- inspection result and bounded inspection note; and
- cancelling or verifying actor where the current record does not already preserve one.

The existing status lifecycle remains compatible:

`assigned -> in_progress -> ready_for_inspection -> verified`

Staff may cancel before verification. A failed inspection moves the same assignment from `ready_for_inspection` back to `in_progress`, increments its version, records the failure, and leaves the unit non-ready.

### `housekeepingChecklistTemplates`

Each property-scoped template contains a name, cleaning type, active state, version, ordered item definitions, creator, updater, and timestamps. An item definition contains a stable key, label, required flag, and sort order. Templates are configuration records; they do not describe completed work.

### `housekeepingChecklistItems`

Each row belongs to one assignment and stores the copied item key, label, required flag, order, status, optional bounded note, updater, completion time, and version.

Item status is `pending`, `completed`, `failed`, or `not_applicable`. Required items must be completed before an assignment can enter `ready_for_inspection`. A manager may mark a required item not applicable only with a reason. The audit log records the override.

## Authorization

The existing property assignment remains mandatory for every read and write.

- `front_desk`, `manager`, and `owner` may create and resolve ordinary front-desk flags.
- Only `manager` and `owner` may create or resolve `lockout` and `payment_concern` flags.
- `housekeeping` may start and update an assignment that is assigned to that staff profile. It may update checklist items on that assignment.
- `manager` and `owner` may assign, reassign, cancel, override a checklist requirement, and verify an assignment.
- `front_desk` may read housekeeping readiness and progress but cannot verify cleaning work.
- `accounting` may read payment-concern flags and related folio balances. It does not receive housekeeping write access.

Add focused capabilities instead of inferring authority from a broad role:

- `front_desk.flag.write`;
- `front_desk.restricted_flag.write`;
- `housekeeping.template.manage`;
- `housekeeping.checklist.update`; and
- `housekeeping.verify`.

Existing owner and manager assignments receive the new management capabilities. Existing housekeeping and front-desk assignments receive only the capabilities listed above.

## Front-desk workflow

`/admin/front-desk` opens on the property's current local business date. The date control includes previous day, today, and next day actions. Queue tabs retain the existing arriving, departing, staying-over, checked-in, no-show, and checked-out views.

The page adds:

- record search within the selected business date;
- compact and detailed display modes;
- flag-kind, severity, readiness, balance, and assignee filters;
- persistent counts for every queue;
- print and CSV export of the filtered view; and
- deep links that preserve date, queue, view mode, filters, and the selected record.

Compact rows show the guest, confirmation code, unit, stay dates, party size, readiness, balance, and open-flag badges. Detailed rows add policy summaries, service progress, operational notes, and recent audited events.

The record drawer keeps the existing check-in, checkout, and no-show transitions. It adds create, assign, edit, and resolve flag actions. It links to the booking, folio, unit, and active housekeeping assignment.

Queue derivation remains server authoritative:

- a confirmed arrival stays in Arriving;
- a checked-in departure stays in Departing;
- `departure_overdue` also adds the record to a Needs attention count;
- `late_checkout` changes the displayed expected time, not the booking's checkout date;
- `sleep_out` adds an informational badge but does not release the unit; and
- `lockout` and `payment_concern` appear as restricted warnings.

The browser never infers settlement or confirmation from a flag.

## Housekeeping workflow

`/admin/housekeeping` gains Board, Assignments, and Audit views.

### Board

The Board groups units by ready, dirty, cleaning, inspection, do-not-disturb, and out-of-service. Each card shows the current assignment, cleaner, cleaning type, priority, expected duration, and checklist progress. Staff can filter by unit group, unit type, state, assignee, cleaning type, and priority.

### Assignments

The Assignments view lists dated work in service order. Managers can create, assign, reassign, reprioritize, cancel, and print a daily work sheet. A housekeeper can start assigned work, update checklist items, add a bounded note, and submit work for inspection.

Starting work changes the unit summary to `cleaning`. Submitting a complete required checklist changes it to `inspection`. Manager verification changes it to `ready`. A failed inspection returns the assignment to `in_progress` and the unit to `cleaning`.

### Audit

The Audit view shows assignment history, last-cleaned time, cleaning type, cleaner, expected and actual duration, inspector, checklist result, notes, and state transitions. It supports date, unit, assignee, cleaning type, and result filters plus CSV export.

History reads from immutable audit events and completed assignment data. The interface does not construct history from the current state alone.

## Cross-workspace updates

The front desk and housekeeping pages query the same authoritative records. Convex subscriptions update both pages after a committed mutation.

Checkout keeps the existing behaviour of marking the unit dirty. The same transaction creates or refreshes the dated turnover assignment only when the housekeeping checklist feature is enabled. The operation uses a deterministic request identity derived from the checkout transition, so retries cannot create duplicate work.

Housekeeping verification updates readiness only. It does not change the booking, payment, folio, maintenance block, or channel state.

An out-of-service service state remains an operational warning. Removing inventory still requires the existing explicit maintenance workflow and linked blocked booking.

## Idempotency, versioning, and errors

Every new mutation accepts a caller-generated request ID and checks the expected version of every edited record.

- An exact replay returns the first result.
- Reusing a request ID for another action fails with `IDEMPOTENCY_KEY_REUSED`.
- A stale edit returns a typed version conflict with the current server version and a safe current-state projection.
- Cross-property identifiers fail before any detail is returned.
- Invalid state transitions leave all records unchanged.
- Checklist completion and service-state changes commit together when both must advance.
- A failed multi-record operation writes no partial assignment, checklist, readiness, or audit state.

The UI keeps the drawer open after a conflict, refreshes the record, and explains which field changed. It never silently retries a judgment-bearing edit. Network retries may replay only the same request ID and payload.

## API, CLI, and MCP parity

Add operations to the existing claim-based automation path:

- list, create, assign, and resolve operational flags;
- list daily housekeeping assignments;
- create and update an assignment;
- update a checklist item;
- submit an assignment for inspection; and
- verify or fail an inspection.

The API issues a single-use automation claim and calls the same Convex mutation used by the browser. CLI and MCP commands call those API routes. No alternate service mutation may bypass role, feature, version, idempotency, or audit checks.

Read responses minimize guest data. Housekeeping automation receives the unit, assignment, checklist, and the smallest guest-state summary needed for service. It does not receive guest contact information, messages, payment identifiers, or confirmation credentials.

## Public tour

The public operations tour adds fictional examples of:

- a late checkout;
- a departure-overdue alert;
- a turnover assignment in progress;
- a checklist awaiting one required item;
- a failed inspection returned for correction; and
- a verified ready unit.

The fixture remains source-controlled and local to the page. It uses no production queries, mutations, names, contact details, booking codes, payment identifiers, or wallet data. Every write control stays disabled and says that staff must sign in to act.

## Migration and compatibility

The schema change is additive. Existing `housekeepingAssignments` rows remain valid because every new field is optional.

An idempotent migration may add default cleaning type and duration to open assignments after an operator reviews the defaults. The migration never creates flags from historical booking states and never fabricates completed checklist evidence.

Existing front-desk, housekeeping, API, CLI, and MCP reads keep their current fields. New fields are additive. Existing feature flags remain authoritative, and two new sub-feature flags control exposure:

- `front_desk_exceptions`; and
- `housekeeping_checklists`.

Disabling either sub-feature removes its UI and write routes without disabling the existing front desk, housekeeping board, guest booking, payment processing, refunds, or channel synchronization.

## Verification

Backend tests cover:

- property and role isolation;
- ordinary and restricted flag authority;
- duplicate open-flag suppression;
- flag assignment, resolution, and replay;
- stale versions and conflicting edits;
- queue derivation for every flag kind;
- late checkout without date or occupancy mutation;
- sleep-out without inventory release;
- checkout-created turnover assignment idempotency;
- template snapshot immutability;
- required, failed, and not-applicable checklist items;
- reassignment and housekeeper ownership;
- inspection success and failure;
- service-state and checklist atomicity;
- explicit maintenance-block separation; and
- complete actor attribution.

Interface tests cover:

- compact and detailed front-desk modes;
- saved deep-link state;
- filtering, queue counts, print, and CSV output;
- Board, Assignments, and Audit views;
- visible focus and keyboard operation;
- semantic live announcements after mutations;
- desktop, tablet, and mobile layouts; and
- no page-level horizontal overflow.

Regression gates retain the full root, CLI, documentation, Cloudflare operations, payment, refund, booking-conflict, iCal, Channex-safety, Consensus Receipt, Wavelength, Zaprite, and public-tour suites.

## Release sequence

1. Deploy the additive schema with both sub-feature flags absent.
2. Run migration dry runs and replay checks on fictional or disposable property data.
3. Enable `front_desk_exceptions` on a non-production property and accept every flag lifecycle.
4. Enable `housekeeping_checklists` and accept checkout, assignment, checklist, failed inspection, and verification flows.
5. Test a complete front-desk-to-housekeeping handoff on desktop and mobile.
6. Verify API, CLI, and MCP parity with a scoped non-owner operator.
7. Enable each sub-feature for a production property only after an owner reviews the role mapping and default checklist templates.

Rollback disables one sub-feature flag. It does not delete records or rewrite audit history.

## Later releases

The remaining ResNexus-informed gaps are grouped into separate designs:

1. bookable equipment and services with their own availability and fulfilment records;
2. house accounts, accounts receivable, tills, stock, cost of goods, and utilities;
3. reporting for revenue, occupancy, payments, reservations, guest behaviour, cancellations, retail, housekeeping, and audits;
4. general messaging, welcome and thank-you automation, promotions, feedback, and newsletter consent; and
5. custom fields, property rules, rate controls, map tools, and reviewed integrations.

OpenStays will implement these as audited workflows. It will not add menu labels that lead to unfinished or unauthoritative controls.
