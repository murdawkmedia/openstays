# Showcase under the studio domain

Use this release branch for the accepted showcase. The main branch has later
application work and is not a substitute for the deployed release.

Run `npm ci --ignore-scripts`, `npm test`, and `npm run typecheck`.
Install the repository-pinned Wavelength v0.1.0 runtime using its verified
installer, then check `node scripts/check-wavelength-runtime.mjs`.
Preserve the accepted public frontend configuration and add
`VITE_BASE=/openstays/` before `npm run build`. Do not add a payment-edge URL,
enable providers, change backend state or deploy private production as part of
this asset move. The original build's incomplete verification wiring remains
an explicit separate operator task.

The separate studio website imports the reviewed output with
`node scripts/import-openstays.mjs <reviewed-dist>`. It keeps the app's source
independent, records SHA-256 hashes and scopes every security/runtime header.
Two identical generated HTML shells support deep links: ordinary showcase
routes and isolated wallet routes have separate header policies. Static asset
exceptions must precede the catchall proxy so JavaScript and runtime files are
served unchanged. Do not proxy the catchall to an index inside its own prefix:
Cloudflare HTML normalization rejects that loop.

Verify real deep-link reloads, unknown routes, local media, JavaScript, wallet
runtime bytes, wallet-only COOP/COEP, property/unit read queries and the static
operations tour. Use synthetic data/local fixtures for booking or payment logic.
Never create a real booking, payment, staff login or wallet merely to validate
hosting. Retain the original address while browser-wallet recovery may be needed.
The public frontend, its Convex backend, the eligibility service and private
staging are independent release surfaces; preserve those boundaries.
