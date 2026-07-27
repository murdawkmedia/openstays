# Synology merchant operations

This directory packages the signet-only OpenStays merchant runtime for the
approved Synology host. It does not deploy to SHC and it publishes no daemon,
gateway, or control port.

## Fixed host layout

- Application and live state:
  `/volume1/docker/openstays-merchant`
- Verified encrypted generations:
  `/volume2/openstays-wallet-backups`
- Deployment account: `murdawk`
- Container and Compose project: `openstays-merchant`

The scripts deliberately reject alternate roots, symbolic links, the wrong
account, permissive environment-file modes, or a UID/GID that does not match
the `murdawk` account. They never prune Docker, recursively delete either
volume, or remove a wallet quarantine.

Before any existing container is started, stopped, or entered, the scripts
attest its exact Compose project and service labels, both approved mounts, and
the absence of published ports. A container that merely reuses the expected
name is rejected.

## Prepare the disabled deployment

1. Put an exact source checkout at
   `/volume1/docker/openstays-merchant/source`.
2. Copy `.env.example` to
   `/volume1/docker/openstays-merchant/config/merchant.env`.
3. Set `OPENSTAYS_UID` and `OPENSTAYS_GID` from `id -u murdawk` and
   `id -g murdawk`.
4. Generate a distinct value for every secret. Do not paste values into shell
   history, documentation, screenshots, or logs.
5. Add these explicit initial gates:

   ```dotenv
   ZAPRITE_ENABLED=false
   WAVELENGTH_ENABLED=false
   WAVELENGTH_REWARDS_ENABLED=false
   ```

6. Make the environment file owner-readable only (`chmod 600`) and owned by
   `murdawk` or `root`.
7. Confirm the Docker image remains checksum-pinned and that the host supports
   the native Compose fields in `docker-compose.yml`.
8. Run:

   ```bash
   cd /volume1/docker/openstays-merchant/source
   bash ops/synology/deploy.sh
   ```

The deploy script first renders the Compose configuration, then builds and
starts only the `merchant` service in the `openstays-merchant` project. A
successful first start may report `awaiting_bootstrap`; all public payment
flags remain disabled.

Immediately before Compose starts or updates the service, deployment arms a
failure and signal trap. A partial startup, failed post-start identity check,
or failed health command stops only the `merchant` service through the same
validated Compose project, environment file, and configuration file. The trap
is disarmed only after container attestation and health both pass; unrelated
containers are never targeted.

## Bootstrap exactly once

Bootstrap is the only command that returns the 24 recovery words:

```bash
docker exec -it openstays-merchant \
  node /app/synology/operator.mjs bootstrap
```

Write the words offline. Do not redirect them to a file, copy them into chat,
or take a screenshot. The supervisor returns them only after the first
encrypted backup generation has been durably committed and reread. A second
bootstrap must fail.

Force and verify another generation without exposing its bytes:

```bash
docker exec openstays-merchant node /app/synology/operator.mjs backup
docker exec openstays-merchant node /app/synology/operator.mjs health
```

## Required recovery drill

Keep all public rails disabled. Then run:

```bash
cd /volume1/docker/openstays-merchant/source
bash ops/synology/recovery-drill.sh
```

The drill:

1. captures a SHA-256 commitment over the signet wallet identity, balance, and
   stable activity fields without printing any of those fields;
2. stops only `openstays-merchant`;
3. atomically moves the live wallet to a timestamped quarantine and syncs the
   directory metadata;
4. starts only the `merchant` service;
5. waits for the supervisor to restore the newest verified `/volume2`
   generation;
6. requires the same redacted wallet commitment;
7. commits a fresh verified backup.

The quarantine is always preserved. If any comparison or health check fails,
the failure trap stops only a container that still passes the full identity
attestation. Leave both the quarantine and backup generations untouched, keep
public flags disabled, and investigate before retrying. Never copy the
quarantine over a restored wallet and never delete generations to make a test
pass.

## Recovery authority and optional timestamping

The atomic archive/manifest pairs on `/volume2` are the recovery authority.
OpenTimestamps may later timestamp a sanitized generation manifest to prove
that a commitment existed by a particular time. It does not replace digest
validation, atomic publication, encrypted backups, or the restore drill.

## Enablement boundary

Zaprite and Wavelength are enabled independently only after their separate
credential-dependent acceptance tests pass. Wavelength remains signet-only.
The browser and Cloudflare Worker do not connect to the NAS; they interact
only with authoritative Convex state and the eligibility edge.
