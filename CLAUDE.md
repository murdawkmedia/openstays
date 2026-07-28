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
    match. Staff/admin auth = Convex Auth (M1): a users row grants NOTHING —
    staff rights require an active staffProfiles row via requireStaff().
11. **Settled payment rows are immutable.** Once a payments row leaves
    'pending' (paid/refunded/partially_refunded/failed), no webhook event may
    change it — redundant events return 'duplicate' and touch nothing. New
    captured money (a 'pending' row) is ALWAYS recorded; if the booking isn't
    in a confirmable state (cancelled, already confirmed, conflict), the
    money is flipped to paid and immediately auto-refunded with an apology —
    never silently swallowed, and a payment never resurrects a booking.
    (Adversarial review 2026-07-08 — both CRITICALs traced to violating this.)
12. **Every meaningful state gets a canonical URL.** Property, unit type,
    checkout, confirmation, manage-booking, admin pages — all deep-linkable;
    builds ship an SPA fallback so cold loads never 404. New UI surfaces must
    keep this guarantee.
13. **Every mutation that inserts or deletes unitNights rows MUST call
    `markPropertyDirtyInline(ctx, propertyId)`** (convex/channel/ari.ts)
    after the change — that stamp is what makes the 1-minute channel-manager
    flush push corrected availability to OTAs. Missing it = a stale count on
    Booking.com/Airbnb until the nightly resync = cross-channel overselling.
    Oversell-critical DECREMENTS (new hold, OTA booking ingest) additionally
    schedule an immediate enabled-gated pushAriForProperty; increments
    (expiry, cancellation) may rely on the flush cron. The helper no-ops when
    the property has no enabled channelSync row, so unconnected deployments
    and tests are unaffected. (Adversarial review 2026-07-08 — both Channex
    CRITICALs were violations of this.)

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

## Known limitations (documented, accepted for now)

- **Email aliasing** defeats once-per-guest and the per-email hold cap
  (`sam+x@`, gmail dots). Normalization is trim+lowercase only — industry
  standard; canonicalization is a possible later hardening.
- **Min lead time is day-granular**: `minLeadTimeHours` is enforced as
  `ceil(hours/24)` whole days from the property-local calendar date, not a
  clock-instant comparison. A "24-hour notice" rule admits a late-night
  booking for tomorrow. Instant-based enforcement is an M1 candidate.
- **Gift-certificate fields are dormant until M4**: `computePrice` supports
  `giftBalanceCents` → `giftCertAppliedCents`, but `createHold` must never
  pass it until the atomic gift-cert ledger debit ships in the same mutation
  (M4). Wiring the input without the debit is a money leak.

## Decision log

- 2026-07-08: Project created. Convex chosen for serializable mutations
  (double-booking safety), team familiarity, self-hostable OSS story.
  Stripe + Square day 1 behind `PaymentProvider` interface; Square via Payment
  Links (hosted parity, no card-form code). Name check: npm `openstays` free,
  no active competing project.
- 2026-07-08: M0 scope = schema v1 + hold/expiry/conflict core + simulated
  demo payment path + seed (Pinewood Flats) + minimal public booking flow.
  Staff auth deferred to M1 with the real payment providers.
- 2026-07-08: E-signing direction (Tim): seasonal-contract agreements (M4)
  get a pluggable signing step — built-in default (client-side pdf-lib +
  signature canvas, the proven kokanee-crm flow, works offline on a staff
  device) and an OPTIONAL DocuSeal integration
  (github.com/docusealco/docuseal) for remote email-based signing with
  audit trails. DocuSeal is AGPL but runs as a SEPARATE self-hosted
  service consumed over HTTP API + webhooks — no license contamination of
  this MIT codebase (we integrate, never vendor its code). Same
  provider-interface philosophy as payments. Killer use case: emailing
  ~215 seasonal renewal agreements instead of clipboard signatures.
- 2026-07-08: Multi-currency (Tim): CAD default, USD/EUR curated in
  settings (`shared/currency.ts` SUPPORTED_CURRENCIES). Currency lives on
  the property and flows through query payloads; pricing math stays
  currency-agnostic integer cents; `formatMoney(cents, currency)` is the
  only formatter. `taxLabel` (default 'GST') labels the tax line. Branding
  (Tim): "built by SebaHub" + www.sebahub.com in app footer, /about,
  /admin/settings, README, docs footer.
- 2026-07-08: Adversarial review (M0 close) found 2 criticals, both fixed:
  (1) payment rows now record only the GST contained in THAT payment
  (tax-inclusive extraction), never the invoice's full GST; (2) an APPLIED
  promo redemption stays consumed forever — cancellation of a confirmed
  booking does NOT free once-per-guest slots or reopen usage caps; only
  unconsumed (reserved) holds release. 14 adversarial tests added.
- 2026-07-08 (auth expansion, Tim): OAuth sign-in (GitHub / Google /
  Microsoft Entra ID) via @auth/core, ENV-GATED on the standard AUTH_* vars —
  buttons appear when a provider's id+secret pair is set (read at module
  load, so a new provider appears on next deploy). Secrets never in the
  settings table; the settings page only SHOWS configured methods.
  users-row-grants-nothing applies to OAuth sign-ins identically. Gotcha:
  @convex-dev/auth materializes bare providers by calling provider() with no
  args — @auth/core's MicrosoftEntraID throws on undefined config, so it is
  pushed as MicrosoftEntraID({}) (guarded by test). Plus an append-only
  auditLog (who/what/when) written via staff.writeAudit from every
  staff-facing mutation (property.update, staff.grant/revoke/bootstrap,
  apiKey.create/revoke, channel.connect/map/sync_now — details never include
  secrets/tokens/gstNumber values), surfaced in Settings → Sign-in &
  activity. Admin-vs-user tiers = existing owner/staff roles.
- 2026-07-08 (M6-prep): Channex channel-manager BAKED IN, dormant until
  CHANNEX_API_KEY + a mapped property (Tim: "bake in Channex and get it
  ready"). ChannelManagerProvider mirrors PaymentProvider; built against the
  researched real Channex API (user-api-key auth; separate /availability +
  /restrictions ARI endpoints; availability = COUNT per room type per night;
  bookings via the mandatory pull+ack revisions feed — webhooks are unsigned,
  out-of-order NUDGES only; oversell prevention is the PMS's job; 10 req/min/
  property; 200-with-warnings ≠ applied). Unit→count translation: free =
  active-and-bookable units − occupied (unitNights of any kind). Its
  adversarial review confirmed 2 CRITICALs (iCal imports and everything
  outside createHold never marked dirty → up-to-24h stale counts = oversell)
  → fixed via binding convention #13 (uniform occupancy→dirty→1-min-flush,
  retry-safe on 429/warnings) + unmapped OTA bookings are never acked until
  the room type is mapped (never lose a sale) + the unauthenticated webhook
  nudge fails closed. Go-live still requires: Channex account, staging
  certification (live screenshare), OTA mapping in the Channex dashboard —
  all operator steps; TODO(channex-cert) markers name every unconfirmed API
  detail to verify then.
- 2026-07-08 (M1.5): automation surface shipped — apiKeys ('osk_' tokens,
  SHA-256 at rest, owner-minted, scoped read/write, soft-revoke), /api/v1/*
  HTTP surface (bearer auth, scope enforcement, delegates to the same domain
  functions as the UI), and the cli/ package (openstays CLI + MCP stdio
  server, self-contained — NOT a root workspace). Trust model: an API key is
  a staff-equivalent automation credential (read key sees the whole booking
  book; documented in docs/automation.md). Its adversarial review found no
  money/availability holes but surfaced: demo reset must wipe apiKeys +
  DEMO_MODE mints read-only keys only; maxOccupancy moved server-side into
  createHold (the UI clamp was the only control — violation of server-
  authority). All fixed + test-guarded. Live-tested end-to-end against the
  demo deployment (hold created via API, read via CLI, scopes enforced).
- 2026-07-08 (M1 close): five-lens adversarial review (money-loss,
  double-booking, webhook-forgery, promo/email, auth surface) confirmed 9
  findings incl. 2 CRITICALs — a double-charge swallowed as 'duplicate' with
  funds stranded, and late webhooks resurrecting cancelled+refunded bookings.
  Root cause: confirmFromPayment conflated "redundant event for settled
  money" with "new money on an unexpected booking state". Fixed via binding
  convention #11 (settled rows immutable / record-then-refund), plus: Stripe
  payment_status check + card-only methods, deterministic refund
  Idempotency-Keys both providers, 4xx-never-retry refund policy + staff
  alert email on dead-letter, staff-gated tapeForProperty and forSettings
  (public configList slimmed), webhook amount/currency mismatch → refund,
  invoice-proportional per-payment GST attribution (gstForPayment), checkout
  requires the confirmation code, email paid/refund figures corrected.
  156 tests green. DEMO_MODE grants a synthetic read-mostly staff identity
  (demo tape/settings work without login) — never set DEMO_MODE on a real
  deployment.
- 2026-07-08: Promo codes added to schema v1 pre-commit (no migration).
  BINDING accounting rule: promo code = PRE-tax price reduction (GST on the
  discounted base, allocated proportionally across taxable/non-taxable
  items); gift certificate = POST-tax payment method (GST on the full
  amount). `priceBreakdown.promoDiscountCents` and `.giftCertAppliedCents`
  are separate fields — never conflate them. Redemption lifecycle
  reserved→applied|released keeps usage caps transactionally accurate;
  discounts snapshot onto the booking (editing a code never rewrites
  history, same principle as bookingAddOns.nameSnapshot).

- 2026-07-22 (Consensus Commons): Zaprite webhooks are authenticated nudges,
  never settlement authority. The server-held API key fetches exact
  amount/currency/status; deterministic event IDs make retries harmless.
- 2026-07-22 (Consensus Commons): refund mode is binding. Stripe/Square remain
  automatic. Zaprite/Wavelength remain paid while an idempotent refund case is
  open; only staff completion with an external reference appends the ledger or
  permits a guest success notice.
- 2026-07-22 (Consensus Commons): Wavelength is a signet-only bridge rail.
  Legacy mainnet schema values remain readable, but active configuration,
  claims, bridge processing, scripts, and UI reject them. The browser never
  sends wallet seeds/passwords or receives the bridge token. Settlement
  requires matching request, signet network, invoice, snapshotted sats,
  completed activity, and payment hash.
- 2026-07-22 (Consensus Receipt): the canonical privacy-safe JSON and SHA-256
  commitment are immutable. Only proof and attestation fields advance.
  `OTS_BRIDGE_TOKEN` authenticates a local worker; the worker verifies the
  canonical bytes/hash and official-client proof before reporting submission
  or a Bitcoin block attestation. A submitted proof is not described as
  Bitcoin-anchored.
- 2026-07-22 (Consensus Reward): proof submission creates exactly one eligible
  1,000-sat signet reward. The amount matches Wavelength's current public
  signet minimum and uses its standard receive path. The merchant bridge
  prepares and validates the
  amount-bearing invoice, fee cap, signet daemon, send activity, and payment
  hash before authoritative settlement. Reward invoices may be replaced only
  after expiry or definitive failure; paid rewards are immutable.
- 2026-07-23 (Wavelength recovery): a receive invoice is single-use. The
  authenticated merchant bridge may report only a terminal receive activity as
  failed/expired, bound to the exact request, invoice, signet amount, and
  activity. That report also closes the linked pending payment. A failed or
  pending payment can never become a settled request; an authoritative
  paid/refunded payment self-heals an interrupted request using its recorded
  payment hash. Exact retries are no-ops and the guest creates a fresh invoice
  rather than retrying a consumed one.
- 2026-07-26 (public payment authority): Zaprite webhook payloads and browser
  redirects remain untrusted nudges. Only a server-side order fetch with the
  dedicated API credential may confirm the exact CA$1 contribution.
- 2026-07-26 (public Wavelength authority): a public booking or reward settles
  only after completed merchant activity matches the signet network, request,
  amount-bearing invoice, exact 1,000-sat principal, and recorded payment
  identifier. Prepared or ambiguous sends are never confirmation.
- 2026-07-26 (public receipt states): a validated OpenTimestamps calendar
  submission may unlock reward eligibility, but it is not a Bitcoin anchor.
  `bitcoin_anchored` requires a later proof upgrade with a verified Bitcoin
  block attestation.
- 2026-07-26 (public operations): the live reward daily budget defaults to
  zero. Missing, corrupt, or stale encrypted wallet recovery fails closed.
  Merchant wallet bootstrap is explicit, authenticated, single-use, and must
  commit its first verified archive before returning success.
- 2026-07-26 (public data boundary): 14-day maintenance minimizes old guest,
  message, and rendered-email data but never rewrites real payment, refund,
  reward, receipt, or booking-state authority. Demo reset must never touch
  rows associated with a real provider payment.
- 2026-07-26 (scope): only dedicated OpenStays resources may be configured.
  Unrelated projects, deployments, credentials, and customer data are out of
  scope.
- 2026-07-27 (Synology merchant boundary): the showcase merchant runtime is
  hosted on Synology; SHC is excluded. Verified encrypted generations under
  `/volume2/openstays-wallet-backups` are recovery authority. The public
  browser and eligibility-only Worker never connect to the NAS; the merchant
  initiates authenticated bridge calls to authoritative Convex state.
- 2026-07-27 (Synology host trust discovery): `/volume1/docker` is writable
  and cannot anchor privileged state. The binding application root is the
  root-owned mode-`0700` `/volume1/openstays-merchant` leaf under trusted
  `/volume1`. NAS source publication uses only a bounded, size- and
  SHA-256-pinned local Git archive plus a root-owned source attestation; it
  never depends on Git being installed on the NAS.
- 2026-07-27 (Synology interactive operations): wallet bootstrap, backup, and
  health use an authenticated DSM Container Manager terminal. Recovery words
  stay offline and out of task/log output, and a second bootstrap must reject.
- 2026-07-27 (public rail enablement): Zaprite and Wavelength are accepted and
  enabled independently. The Zaprite API key pasted during development is
  exposed and must be replaced before Zaprite enablement. Wavelength remains
  signet-only. Consensus Commons is fictional: Zaprite is a CA$1 voluntary
  development contribution, while Wavelength booking and reward flows use
  1,000 signet test sats.
- 2026-07-27 (backup timestamping): atomic generation publication, digest
  verification, encryption, and forced restore are the wallet-safety
  authority. OpenTimestamps is an optional audit layer for a sanitized
  manifest commitment only: no archive, secret, recovery, wallet, guest,
  invoice, payment-hash, host, or path data. Bitcoin anchoring is not required
  for restore, startup, reconciliation, or payment availability.
- 2026-07-28 (restored-wallet readiness): restore staging and final publication
  must remain on the wallet destination filesystem so atomic rename cannot
  cross mounts. A restored wallet that is otherwise ready may commit one fresh
  verified generation during the bounded deploy health loop when its only
  failing condition is backup staleness. This does not relax corrupt/missing
  recovery, identity, mount, port, control-readiness, or other health failures.
- 2026-07-22 (OpenStays Mail): Convex is authoritative for rendered email,
  idempotency, leases, retries, and audit state. `mail_bridge` exposes only
  bearer-authenticated bounded claims and acknowledgements; the local worker
  is a replaceable SMTP delivery adapter. Mailpit is loopback capture only,
  Resend remains optional, and `DEMO_MODE=true` always forces log-only mail.
