# OpenStays — Agent & Contributor Conventions

Open-source booking engine / PMS. React + Vite + TS + Tailwind frontend, Convex backend.
MIT. Public repo. Built and dogfooded in production at Seba Beach, AB (that config is
data in a private deployment — never in this repo).

## Binding conventions (do not re-litigate)

1. **Money is integer cents.** Never floats. All price/tax/refund math lives in
   `shared/pricing.ts` (pure, dependency-free, shared by client preview and
   Convex mutations). Server-side pricing is authoritative; clients only preview.
2. **Stay dates are property-local ISO `YYYY-MM-DD` strings.** Lexicographic
   comparison == chronological. Epoch ms only for instants (createdAt, holdExpiresAt).
   All date math via `shared/pricing.ts` helpers — never `new Date(isoString)` math.
3. **Nights are half-open `[checkIn, checkOut)`.** Checkout day is free for the
   next check-in.
4. **`unitNights` is the derived occupancy table.** One row per blocked
   unit-night. Rows are written/deleted ONLY inside the same mutation that
   changes the owning booking's status (`convex/bookings.ts`, later
   `convex/ical*.ts`). Convex serializable transactions keep booking+rows atomic.
   Conflict check = one indexed range read on `by_unit_date`. Never check
   conflicts any other way; never `.collect()`-then-scan.
5. **Hold TTL is 35 minutes** (`HOLD_TTL_MS`). Not shorter: Stripe Checkout's
   minimum `expires_at` is 30 minutes. The checkout action must refuse to create
   a payment session on a hold with < 31 minutes remaining.
6. **Webhooks are idempotent** via check-and-insert on `webhookEvents` in the
   same transaction as the state change.
7. **Secrets live in Convex env vars** (`npx convex env set`), never in the
   settings table, never in this repo. The `settings` table is for non-secret
   deployment prefs (branding, GST number, default provider).
8. **`propertyId` on every domain table.** Multi-property per deployment;
   single operator per deployment (no SaaS tenancy in v1).
9. **Confirmation pages trust reactive queries, never redirects.** Success URLs
   render "finalizing…" until `byConfirmationCode` shows `confirmed`.
10. **Guests have no accounts.** Manage-booking auth = confirmation code + email
    match. Staff/admin auth = Convex Auth (lands M1).

## Review policy

Any diff touching `shared/pricing.ts`, `convex/payments/**`, the hold/booking
transaction in `convex/bookings.ts`, refunds, or the gift-certificate ledger
requires an adversarial review pass: *find a sequence of events where this loses
money, double-charges, double-books, or leaks a paid booking — write the failing
test.* Failing tests get committed either way.

## Build orchestration

- Contract-first: schema/type/signature changes move alone, get reviewed, then
  streams fan out with disjoint file territories (a stream owns whole files).
- Sub-builders never run `convex dev` (schema-push races) — develop against
  `convex-test` + `npx convex codegen`. Only the orchestrator pushes to live
  deployments, holds provider keys, merges to main, promotes `main → release`.
- Tests: `npm test` (vitest + convex-test). Typecheck: `npm run typecheck`.

## Deployments

| Deployment | Purpose | Frontend host |
|---|---|---|
| dev | local development | vite dev server |
| demo | public writable demo, `DEMO_MODE=true`, nightly reset | GitHub Pages `/openstays/demo/` |
| (operator prod) | each operator's own instance | anything static (Seba uses Cloudflare Pages, build `npx convex deploy --cmd 'npm run build'`, prod branch `release`) |

## Scope guard

v1 does NOT include OTA channel management (Airbnb/Booking.com APIs are
partner-gated). v1 distribution = direct bookings + per-unit iCal in/out.
Don't promise otherwise anywhere — docs, UI copy, commit messages.

## Decision log

- 2026-07-08: Project created. Convex chosen for serializable mutations
  (double-booking safety), team familiarity, self-hostable OSS story.
  Stripe + Square day 1 behind `PaymentProvider` interface; Square via Payment
  Links (hosted parity, no card-form code). Name check: npm `openstays` free,
  no active competing project.
- 2026-07-08: M0 scope = schema v1 + hold/expiry/conflict core + simulated
  demo payment path + seed (Pinewood Flats) + minimal public booking flow.
  Staff auth deferred to M1 with the real payment providers.
