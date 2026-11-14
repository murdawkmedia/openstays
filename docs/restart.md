# Restarting OpenStays

The public OpenStays site is now a static project showcase. There is no shared
hosted reservation service to join. The complete application code remains
available under the MIT license for a fresh operator deployment.

The maintained source is the Nostr repository linked in
[SOURCE-WORKFLOW.md](../SOURCE-WORKFLOW.md). The public GitHub repository is a
passive mirror; its maintained default branch is `nostr-main`. Historical
branches and deployment records do not establish a currently running service.

## Publish only the project site

No database, credentials, package install or JavaScript build is needed:

```bash
git clone --branch nostr-main https://github.com/murdawkmedia/openstays.git
cd openstays
python3 scripts/check-static-site.py
```

Upload `static-site/` to a static host. The intended primary URL is
`https://www.murdawkmedia.com/openstays/`, and `hosting/` is the restart guide.
When using another hostname or path, update canonical, structured-data and
social-image URLs, and validate with the corresponding `--base-url` argument.
Add the two page URLs to your host's sitemap. Local assets use relative paths.
The checked-in social image is 1200 × 630 PNG; its editable source is SVG.

This artifact contains fictional examples, not live availability or guest data.
Do not point it at a Convex deployment or add secrets to its public files.

## Explore the booking app with fictional data

Install a supported Node.js version meeting Vite's lockfile engine requirement.
Start from the lockfile, then create a new dedicated development backend:

```bash
npm ci
npx convex dev
```

Verify the selected project before pushing schema or functions. Leave Convex
running. In another terminal targeting that same disposable deployment:

```bash
npx convex env set DEMO_MODE true
npx convex env set EMAIL_PROVIDER log_only
npm run seed
```

Set these public frontend flags in the generated local environment file:

```text
VITE_PUBLIC_SHOWCASE=true
VITE_PUBLIC_STAFF=false
VITE_PUBLIC_WAVELENGTH=false
VITE_PUBLIC_ZAPRITE=false
VITE_PUBLIC_SIMULATED=true
```

Start the frontend:

```bash
npm run dev
```

The new CLI setup provides the public `VITE_CONVEX_URL`. This path uses fictional
Pinewood Flats seed inventory and simulated behavior. Never enable `DEMO_MODE`
on a backend with real guest or payment records: demo reset tasks are destructive.
The local development option is `CONVEX_AGENT_MODE=anonymous npx convex dev`;
see [quickstart](quickstart.md). Test the real guest/staff flows before making
claims about a new deployment. This documentation is not a live acceptance
receipt for a new instance.

## Build for an operator

Use the reduced [production profile](production-profile.md), not the full
experimental showcase. Set up separate development/staging and production
backends under the operator's control. Start with fresh credentials and origins.

1. Run `npm run production:verify` to generate `convex-production/`.
2. In the deployment checkout, create `convex.json` with the following content
   so code generation and deployment use the reduced directory:

   ```json
   { "functions": "convex-production/" }
   ```

3. Set `VITE_OPENSTAYS_PROFILE=production` and the new public `VITE_CONVEX_URL`.
   Keep demo and public-simulation flags disabled. Run deployment-specific
   code generation against the generated functions directory.
4. Configure the new backend's staff-auth keys, `SITE_URL`, provider callback
   URLs and first authorized owner. An account alone never grants staff rights.
5. Load reviewed inventory and enable property-scoped workspaces one at a time,
   following [configuration](configuration.md) and the
   [command-center acceptance sequence](command-center.md).

Run source checks and build the frontend:

```bash
npm test
npm run typecheck
VITE_OPENSTAYS_PROFILE=production npm run build
```

With the generated function directory selected in `convex.json` and a private
`CONVEX_DEPLOY_KEY` configured in the host, the paired deploy/build pattern is:

```bash
VITE_OPENSTAYS_PROFILE=production npx convex deploy --cmd 'npm run build'
```

Serve `dist/` from Cloudflare Pages, Workers static assets or another static
host. Configure application deep-link navigation fallbacks and deploy the
frontend against the same backend revision. The static project site uses a
different output directory and does not require application SPA routing.

## Provider and secret boundary

Payment, email and optional channel integrations are configured separately.
Names and procedures are in [self-hosting](self-hosting.md),
[payments](concepts/payments.md), [staff auth](concepts/staff-auth.md) and
[automation](automation.md). Configure only the providers you intend to accept.
Backend credentials and deployment keys belong in secret stores. Anything
prefixed `VITE_` is public frontend configuration, never a secret store.

Do not restore old credentials or use a retired deployment URL as a service.
Backend exports can contain guests, staff identities, auth state, messages,
payment references and storage objects; keep them in reviewed private recovery.
Only demonstrably fictional fixtures belong in public Git. This repository's
existing source-controlled seed is sufficient for a new test installation.

## Fully self-hosted backend

To avoid Convex Cloud, operate the
[open-source Convex backend](https://github.com/convex/convex-backend) using
its [current official self-hosting instructions](https://docs.convex.dev/self-hosting).
The app still requires Convex's transaction/query behavior; this is not an
arbitrary database adapter. The backend has separate license terms from the
MIT-licensed OpenStays app; review them for your intended use.
Use your backend URL and admin/deploy credentials,
the same generated production function directory, and the same acceptance
checks as a hosted backend.

You own infrastructure, TLS, storage, backups, restore tests, scheduled work,
auth, upgrades and monitoring. The repository does not include a complete
turnkey production self-hosted package. Verify compatibility with your chosen
backend release before committing real inventory.

## Acceptance before real bookings

- Test competing holds, cancellations, stay rules, property-local dates, rates,
  deposits, taxes and turnover buffers.
- Verify staff roles, property scope, recovery and guest-data access.
- Test provider sandbox checkout, exact webhook confirmation, retries and
  refunds. Browser success redirects are never payment authority.
- Confirm guest notices, iCal feeds and manual calendar conflict handling.
- Complete a security/privacy review, monitor operational failures and verify
  an isolated backup restore. Payment/email/hosting plans have their own costs.
- Obtain channel-provider access, certification and mappings before direct OTA
  connectivity. iCal polling is not an instant cross-platform inventory lock.
- Verify that the production release omits the wallet, rewards, treasury,
  OpenTimestamps and public-tour/demo artifacts.

Historical browser-wallet recovery must remain origin-specific and private.
Never clear browser storage or collect wallet words as part of restarting the
booking application. The static project site neither reads nor migrates wallets.
