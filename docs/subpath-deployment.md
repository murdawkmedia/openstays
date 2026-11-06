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
The existing studio Worker serves matching static assets first. A small ASSETS
handler serves the app directory shell for missing OpenStays navigation paths,
with COOP/COEP added only on wallet paths. Missing JavaScript, demo media and
runtime assets remain real 404s. The studio's other navigation uses its own shell.
Do not add a catchall static proxy: it can turn live asset responses into HTML.

Verify real deep-link reloads, unknown routes, local media, JavaScript, wallet
runtime bytes, wallet-only COOP/COEP, property/unit read queries and the static
operations tour. Use synthetic data/local fixtures for booking or payment logic.
Never create a real booking, payment, staff login or wallet merely to validate
hosting. Retain the original address while browser-wallet recovery may be needed.
The public frontend, its Convex backend, the eligibility service and private
staging are independent release surfaces; preserve those boundaries.
