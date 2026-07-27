# OpenStays Cloudflare operations

This package contains the public eligibility edge and the single merchant
operations supervisor. Configuration files contain binding names and inert
placeholders only.

Configure these Worker secrets at deployment time:

- `TURNSTILE_SECRET`
- `ELIGIBILITY_HMAC_SECRET`
- `OPERATIONS_ADMIN_TOKEN`
- `CONTAINER_CONTROL_TOKEN`
- `WALLET_BACKUP_KEY_BASE64`
- `WAVELENGTH_WALLET_PASSWORD`
- `WAVELENGTH_BRIDGE_TOKEN`
- `WAVELENGTH_HEARTBEAT_TOKEN`
- `OTS_BRIDGE_TOKEN`
- `OTS_HEARTBEAT_TOKEN`
- `MAIL_BRIDGE_TOKEN`
- `MAIL_HEARTBEAT_TOKEN`
- `BACKUP_HEARTBEAT_TOKEN`

Never commit secret values, wallet recovery material, or production resource
identifiers.

`POST /v1/operator/bootstrap-wallet` creates the merchant signet wallet once
and commits its first verified encrypted archive before returning the recovery
phrase. `POST /v1/operator/restart-from-backup` forces a restore rehearsal.
Both require `OPERATIONS_ADMIN_TOKEN`; neither endpoint is a public UI.

The `build` script validates the Worker and declared bindings with
`--containers-rollout=none` because the Task 7 edge package is intentionally
usable without Docker. A real, checksum-pinned container build is a mandatory
Task 9 deployment gate.
