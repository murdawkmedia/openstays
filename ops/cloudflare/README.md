# OpenStays Cloudflare operations

This package contains the public eligibility edge and the single merchant
operations supervisor. Configuration files contain binding names and inert
placeholders only.

Configure these Worker secrets at deployment time:

- `TURNSTILE_SECRET`
- `ELIGIBILITY_HMAC_SECRET`
- `OPERATIONS_ADMIN_TOKEN`

Never commit secret values, wallet recovery material, or production resource
identifiers.

The `build` script validates the Worker and declared bindings with
`--containers-rollout=none` because the Task 7 edge package is intentionally
usable without Docker. A real, checksum-pinned container build is a mandatory
Task 9 deployment gate.
