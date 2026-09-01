# Production profile

The production profile is the supported downstream boundary for a real lodging
operator. It preserves OpenStays' booking, payment, refund, channel, staff,
folio, housekeeping, and audit foundations while omitting the Bitcoin++
showcase from shipped artifacts.

## Build contract

Use a dedicated Convex deployment and set:

```text
VITE_OPENSTAYS_PROFILE=production
VITE_CONVEX_URL=https://<dedicated-deployment>.convex.cloud
```

Then generate and verify the reduced backend before building the frontend:

```bash
npm run production:verify
npm run typecheck
npm run build
```

`production:verify` creates an ignored `convex-production/` directory from an
allow-list of shared production modules. The production Vite entry point and
post-build verifier fail closed if release assets contain showcase-only terms
or routes.

## Excluded surface

The production artifact excludes:

- Consensus Commons and the public operations tour;
- Wavelength browser and merchant runtimes;
- signet payments, rewards, and treasury automation;
- OpenTimestamps receipts and workers;
- demo seeds, public maintenance, and showcase health workers.

Historical code remains readable in the public upstream so the hackathon work
is preserved, but it is not part of this release profile.

## Downstream repository

A private operator repository should preserve this repository as `upstream`,
keep deployment configuration and catalog data private, and integrate upstream
tags through reviewed pull requests. Never merge a downstream data or secret
commit back into the public repository.

Use a separate Convex project, Cloudflare Pages project, R2 bucket, Zaprite
sandbox, email capture service, and staff identity for staging. Do not point a
production-profile build at the public Consensus deployment.
