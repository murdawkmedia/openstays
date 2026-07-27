# Self-hosting & deployment

OpenStays has two independently-deployable pieces: the **Convex backend**
(schema, mutations, queries, crons, HTTP endpoints) and the **static
frontend** (React + Vite build output). This split is what makes "your own
deployment, your own data" possible — you're never renting space in someone
else's multi-tenant database.

There are two paths for the backend, and several options for the frontend.

## Backend path 1: Convex Cloud (default, recommended)

This is what `npx convex dev` gives you, and what the [Quickstart](/quickstart)
walks through. Convex hosts your deployment; you get serializable
transactions, realtime queries, scheduled functions (crons), file storage,
and HTTP endpoints without running any infrastructure yourself. The free
tier is generous enough that a single-property deployment costs ~$0/month.

Your data lives in Convex's cloud, scoped entirely to your own project — it
is not shared with, or visible to, other OpenStays deployments. You can
export it at any time from the dashboard.

## Backend path 2: self-hosted convex-backend

If you want the backend running on infrastructure you control end to end,
Convex publishes an open-source backend you can self-host:
[github.com/get-convex/convex-backend](https://github.com/get-convex/convex-backend).
This gets you the same transactional/query semantics OpenStays depends on,
with no dependency on Convex's hosted service. This path is more involved to
operate (you're responsible for the database, backups, and uptime) and isn't
covered turn-key by this repo's scripts — treat it as the option for
operators who need full self-hosting as a hard requirement.

## Frontend hosting

The frontend is a static Vite build (`npm run build` → `dist/`), so it can be
hosted anywhere that serves static files: GitHub Pages, Cloudflare Pages,
Netlify, S3 + CloudFront, etc.

### Production build pattern

Pair your static host's build step with a Convex deploy so your functions
ship in lockstep with your frontend:

```bash
npx convex deploy --cmd 'npm run build'
```

This deploys your Convex functions to your production deployment *and* runs
your frontend build with the right production `VITE_CONVEX_URL`
automatically injected. It needs a deploy key, which you generate from the
Convex dashboard (Settings → Deploy Keys) and set as the `CONVEX_DEPLOY_KEY`
environment variable in your host's build settings (GitHub Actions secret,
Cloudflare Pages environment variable, etc.) — never commit it.

Example for a Cloudflare Pages project:

- **Build command:** `npx convex deploy --cmd 'npm run build'`
- **Build output directory:** `dist`
- **Environment variable:** `CONVEX_DEPLOY_KEY` (set as a secret, production
  scope)

The same pattern applies to any static host that lets you set a custom
build command and a secret environment variable.

### GitHub Pages demo build

This repo's own `.github/workflows/pages.yml` publishes two things to GitHub
Pages on every push to `main`: the docs site (this site, at the root) and a
public read/write **demo** deployment of the app itself, under `/demo/`. See
that workflow for the exact `VITE_BASE` / `VITE_CONVEX_URL` wiring if you
want to replicate a similar split-publish setup for your own fork.

## Demo mode

Setting the Convex environment variable `DEMO_MODE=true` on a deployment
(`npx convex env set DEMO_MODE true`) turns on two things, and **only**
these two things:

- **Simulated payments** — the guest checkout flow can confirm a booking
  through `bookings.confirmSimulated` instead of a real payment provider.
  This mutation explicitly checks `DEMO_MODE` and refuses to run otherwise,
  so it can't accidentally activate on a real operator's deployment.
- **Nightly reset** — a cron (`convex/crons.ts` → `convex/demo.ts`) wipes all
  domain tables and re-seeds the fictional Pinewood Flats Campground every
  night. This mutation also checks `DEMO_MODE` and no-ops if it's unset.

Never set `DEMO_MODE=true` on a deployment holding real guest data — it
exists solely for the public demo instance and for kicking the tires
locally without a payment provider configured.

## Payment providers (M1 — in progress)

Configure Stripe, Square, or both — whichever a deployment has env vars for
is what the guest checkout UI offers. Neither is required; a deployment with
neither configured falls back to manual (front-desk) payment recording, or
`DEMO_MODE`'s simulated path for kicking the tires. See
[Environment variables](/configuration#environment-variables) for the full
variable reference and graceful-degradation behavior.

**Sandbox-first**: get both providers working in test/sandbox mode against a
dev or staging Convex deployment before pointing live keys at a deployment
that takes real guest payments.

### Stripe

1. In the [Stripe dashboard](https://dashboard.stripe.com), create a
   **restricted key** scoped to Checkout Sessions and (if you want refunds
   executed from the app) Refunds — avoid using a full secret key. Set it:
   ```bash
   npx convex env set STRIPE_SECRET_KEY sk_test_...
   ```
2. Add a webhook endpoint pointing at your deployment's HTTP actions URL:
   ```
   https://<your-deployment>.convex.site/webhooks/stripe
   ```
   Subscribe it to the `checkout.session.*` events (completed, expired, and
   async payment failed/succeeded, as applicable to your integration).
3. Copy the endpoint's signing secret and set it:
   ```bash
   npx convex env set STRIPE_WEBHOOK_SECRET whsec_...
   ```
4. Start in Stripe **test mode** (`sk_test_...` keys, test webhook endpoint)
   and confirm a full hold → checkout → webhook → confirmed cycle before
   switching to live keys.

### Square

1. Create a Square application in the
   [Square Developer Dashboard](https://developer.squareup.com/apps) and
   generate an **access token** for the environment you're targeting
   (sandbox first):
   ```bash
   npx convex env set SQUARE_ACCESS_TOKEN ...
   npx convex env set SQUARE_ENV sandbox
   ```
2. Find your **location id** (Square dashboard → Locations, or the Locations
   API) and set it:
   ```bash
   npx convex env set SQUARE_LOCATION_ID ...
   ```
3. Create a webhook subscription pointing at:
   ```
   https://<your-deployment>.convex.site/webhooks/square
   ```
   Subscribe it to `payment.updated` (Square Payment Links drive confirmation
   through payment status changes rather than a dedicated checkout-session
   event).
4. Copy the subscription's signature key and set it:
   ```bash
   npx convex env set SQUARE_WEBHOOK_SIGNATURE_KEY ...
   ```
5. Verify a full cycle in `SQUARE_ENV=sandbox` before switching
   `SQUARE_ENV=production` with production credentials.

## Staff/admin authentication (M1 — in progress)

Staff sign-in uses [Convex Auth](https://labs.convex.dev/auth) with an
email+password provider. A signed-up user grants nothing by itself — every
staff-only query/mutation requires an active `staffProfiles` row (see
`convex/staff.ts`), which only an owner or the one-time bootstrap command
below can create.

1. Generate an RS256 keypair and JWKS document for Convex Auth to sign and
   verify staff session tokens. The standard Convex Auth snippet does this
   for you — run it once per deployment and capture the two outputs:
   ```bash
   npx @convex-dev/auth
   ```
   (If you're wiring this up by hand instead: generate an RS256 keypair,
   export the private key as PKCS8 PEM, and derive the matching public JWKS
   document from it.)
2. Set the generated values and your frontend origin as deployment env vars:
   ```bash
   npx convex env set JWT_PRIVATE_KEY -- "<pkcs8 pem>"
   npx convex env set JWKS '<jwks json>'
   npx convex env set SITE_URL https://<frontend-host>
   ```
3. With the app running against that deployment, sign up the first staff
   account at `/admin/login` (email + password) — this creates the
   `users` row but grants no staff rights yet.
4. Bootstrap that user to `owner` (refuses if an owner already exists):
   ```bash
   npx convex run staff:bootstrap '{"email":"you@example.com","name":"Your Name"}'
   ```
5. From then on, the owner grants additional staff accounts from the admin
   UI (`staff.grantStaff`) — the bootstrap command is a one-time, orchestrator-run
   step, not a recurring admin action.

### Optional: OAuth sign-in

Password sign-in (above) always works and needs nothing further. On top of
it, you can enable "Sign in with GitHub / Google / Microsoft" — each provider
is **env-gated**: set its client id + secret and the login page shows a
button for it; leave either unset and that provider's button is simply
absent. This is the same dormancy pattern as Stripe/Square/Channex elsewhere
in this doc.

**The rule that doesn't change:** an OAuth sign-in creates a `users` row
exactly like a password sign-up does, and that row still grants **nothing**.
`requireStaff` is the single chokepoint for every staff query/mutation
regardless of how someone signed in — an owner still has to add the new user
as staff (`staff.grantStaff`) before they can do anything.

For each provider you want to offer:

#### GitHub

1. Create an OAuth app in
   [GitHub Developer settings](https://github.com/settings/developers) →
   OAuth Apps → New OAuth App.
2. Set its **Authorization callback URL** to:
   ```
   https://<your-deployment>.convex.site/api/auth/callback/github
   ```
3. Copy the generated client id and client secret and set them:
   ```bash
   npx convex env set AUTH_GITHUB_ID ...
   npx convex env set AUTH_GITHUB_SECRET ...
   ```

#### Google

1. In the [Google Cloud Console](https://console.cloud.google.com), configure
   the OAuth consent screen (if you haven't already) and create an **OAuth
   client ID** credential (Application type: Web application).
2. Add this as an **authorized redirect URI**:
   ```
   https://<your-deployment>.convex.site/api/auth/callback/google
   ```
3. Copy the client id and client secret and set them:
   ```bash
   npx convex env set AUTH_GOOGLE_ID ...
   npx convex env set AUTH_GOOGLE_SECRET ...
   ```

#### Microsoft Entra ID

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), create
   an **App registration**.
2. Add this as a **Redirect URI** (platform: Web):
   ```
   https://<your-deployment>.convex.site/api/auth/callback/microsoft-entra-id
   ```
3. Copy the application (client) id, create a client secret, and set them:
   ```bash
   npx convex env set AUTH_MICROSOFT_ENTRA_ID_ID ...
   npx convex env set AUTH_MICROSOFT_ENTRA_ID_SECRET ...
   ```
   If you want to restrict sign-in to a single Microsoft tenant (rather than
   any Microsoft account), also set the tenant-specific issuer:
   ```bash
   npx convex env set AUTH_MICROSOFT_ENTRA_ID_ISSUER https://login.microsoftonline.com/<tenant-id>/v2.0
   ```

None of the three are required — a deployment with none configured just
shows the password form, exactly as it does today.

## Email (M1 — in progress)

Transactional email (booking confirmations, cancellations, payment-conflict
apologies) sends via [Resend](https://resend.com).

1. Add and verify your sending domain in the Resend dashboard.
2. Create an API key and set it:
   ```bash
   npx convex env set RESEND_API_KEY re_...
   ```
3. Set the sender identity emails go out as:
   ```bash
   npx convex env set EMAIL_FROM "Pinewood Flats <stays@pinewood.example>"
   ```

Until `RESEND_API_KEY` is set (or whenever `DEMO_MODE=true`), sends degrade
to an `emailLog` row with `status: 'logged'` instead of a real delivery —
nothing in the booking flow blocks or errors because email isn't configured.

## Public Cloudflare Pages showcase

The gallery deployment is a deliberately constrained product tour, not a
publicly funded wallet service. Build it with `VITE_PUBLIC_SHOWCASE=true` to
replace staff and wallet routes with explanatory boundary pages, hide live
Wavelength checkout actions, and keep fictional Consensus Commons content
available for browsing.

Use a dedicated Convex deployment. Set only the demo-safe server environment:

```powershell
npx convex env set DEMO_MODE true
npx convex env set EMAIL_PROVIDER log_only
npx convex run seed:run
```

Do not configure Zaprite, Wavelength, OpenTimestamps bridge, Channex, SMTP,
OAuth, Stripe, or Square credentials on this deployment. In particular, never
select or inspect any unrelated Convex project.

Build and upload the static site:

```powershell
$env:VITE_PUBLIC_SHOWCASE='true'
$env:VITE_BASE='/'
$env:VITE_CONVEX_URL=$publicConvexUrl
npm run build
npx wrangler pages deploy dist --project-name openstays-consensus --branch main
```

The repository's `public/_redirects` preserves client-side deep links and
`public/_headers` preserves the COOP/COEP isolation required by the bundled
wallet runtime in local builds. Public-showcase builds omit the 123 MiB
Wavelength WASM directory because wallet actions are disabled and Cloudflare
Pages caps individual assets at 25 MiB.

After deploying, verify the root tour, a property page, a unit page, and a deep
link. Confirm the public-showcase banner is visible, staff and wallet routes
fail closed, no horizontal overflow appears at 390 px, and no real payment or
email provider is contacted. The demo reset must remove prior fictional
bookings, messages, refunds, receipts, rewards, bridge requests, and audit
events before restoring both fictional seed properties.

## iCal import (M1 — in progress)

Two-way iCal keeps an externally-listed calendar (a direct Airbnb listing, a
legacy PMS bridge) from double-booking against this deployment. Export
(`/ical/u/<token>.ics`) already ships; **import** pulls external feeds in on
a 15-minute cron.

1. From the admin unit editor (or directly in the Convex dashboard against a
   unit's `icalImports` array), add an entry per external feed:
   `{ url, label }` — e.g. `label: 'Airbnb'` pointing at that listing's
   exported `.ics` URL.
2. The 15-minute sync cron picks up every active unit's `icalImports`
   entries, fetches each feed, and reconciles events against this unit's
   bookings. `lastSyncedAt` / `lastStatus` on the entry reflect the most
   recent attempt; one failing feed doesn't block sync for any other
   unit or feed.
3. **Conflicts are never auto-resolved.** External events never displace an
   internal booking — if an imported event's nights overlap an existing
   internal booking, the internal booking stays authoritative, the external
   event is recorded flagged (`syncConflict`), and staff resolve it manually
   on the booking tape. See
   [iCal import conflict semantics](/concepts/payments#ical-import-conflict-semantics-m1-—-in-progress)
   for the full conflict semantics.
