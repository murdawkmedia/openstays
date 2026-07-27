# Synology merchant operations

This directory packages the signet-only OpenStays merchant runtime for the
approved Synology host. It does not deploy to SHC and publishes no daemon,
gateway, or control port.

## Fixed trust boundary

- Application root: `/volume1/docker/openstays-merchant`
- Encrypted generations: `/volume2/openstays-wallet-backups`
- Runtime identity: `murdawk` (`1026:100`)
- Root launcher: `/usr/local/sbin/openstays-merchant-root`
- Compose project/container: `openstays-merchant`

The application root, published source, source quarantine, recovery
quarantine, and installed launcher are root-owned and not writable by group or
other. Runtime `config`, `state`, and backup leaves are `1026:100` mode `0700`.
The recovery quarantine is outside user-writable wallet state.

Before an existing container is started, stopped, or entered, both operations
scripts attest:

- Compose project `openstays-merchant`;
- service `merchant`;
- container user exactly `1026:100`;
- the two fixed, writable bind mounts; and
- no published ports.

A container that merely reuses the expected name is rejected. The scripts
never prune Docker, recursively delete either volume, or delete a wallet or
source quarantine.

## Prepare disabled configuration

Create `/volume1/docker/openstays-merchant/config/merchant.env` as a regular,
non-symlink file owned by `murdawk` or `root`, mode `0600`. Start from
`.env.example`, set `OPENSTAYS_UID=1026` and `OPENSTAYS_GID=100`, and generate
a distinct value for every secret without placing values in shell history,
documentation, screenshots, or logs.

If the fixed directories do not exist yet, the first pinned launcher run may
create them and then stop at `MERCHANT_ENV_REQUIRED`. Place the environment
file through DSM in the newly created fixed config directory, then rerun the
same digest- and commit-pinned task. Do not loosen directory permissions.

These gates must be present:

```dotenv
ZAPRITE_ENABLED=false
WAVELENGTH_ENABLED=false
WAVELENGTH_REWARDS_ENABLED=false
```

Do not place or execute a checkout supplied by `murdawk` at the live source
path. The root-owned launcher fetches and publishes source itself.

## Install and run the root-owned launcher once

DSM Task Scheduler must never execute `deploy.sh`, `recovery-drill.sh`, or any
other file from a checkout writable by `murdawk`.

1. From a trusted checkout, record the full 40-character commit and compute:

   ```bash
   git rev-parse HEAD
   sha256sum ops/synology/root-launcher.sh
   ```

2. Copy only `root-launcher.sh` to the fixed, `murdawk`-writable staging path:
   `/volume1/homes/murdawk/openstays-merchant-root-launcher.stage`.
3. In DSM **Control Panel → Task Scheduler**, create a manual-only
   **User-defined script** owned by `root`.
4. Confirm the trusted launcher digest is
   `7094a2cc8175f3800f138eb4683e95516f3bafa15efd43ca534ad0a4760f612b`.
   Replace both `<40-character-commit>` values with the same lowercase commit.
   The digest must remain a literal in the task, never read from the staging
   folder.

   ```bash
   /usr/bin/install -o root -g root -m 700 -- \
     /volume1/homes/murdawk/openstays-merchant-root-launcher.stage \
     /usr/local/sbin/openstays-merchant-root
   installed_sha256=$(/bin/sha256sum \
     /usr/local/sbin/openstays-merchant-root)
   case "${installed_sha256%% *}" in
     7094a2cc8175f3800f138eb4683e95516f3bafa15efd43ca534ad0a4760f612b) ;;
     *) exit 72 ;;
   esac
   /usr/bin/env -i \
     PATH=/usr/local/bin:/usr/bin:/bin \
     HOME=/nonexistent \
     /usr/local/sbin/openstays-merchant-root \
     deploy <40-character-commit>
   ```

5. Run it once and inspect the result. Disable or remove the task immediately.

The post-install hash is authoritative: changing the writable staging file
before or during installation changes the installed digest and stops
execution. The installed launcher is root-owned mode `0700` outside the
checkout. It re-executes itself through `env -i`, accepts only `deploy` or
`recovery` plus an exact commit, fetches that commit from the fixed public
repository, verifies a clean tree, and atomically publishes it. A prior source
tree is moved intact into root-owned quarantine and is never deleted.

Absent directory leaves are built under already trusted, non-writable parents
using unique temporary names and atomic rename. Existing leaves must already
be real directories with the exact owner and mode; symlinks and permission
drift are rejected without repair. Only the launcher can mint the root-owned,
mode-`0600` nonce handoff required by the checkout scripts. A direct
`OPENSTAYS_DSM_ROOT_TASK=1` call fails.

Never change the Docker socket, DSM users or groups. Never add `sudo`, an
alternate path, or unrelated container/volume commands to the task.

The deploy script renders Compose, builds and starts only `merchant`, then
re-attests its identity and health. A failure or signal after startup stops
only that Compose service through the same fixed configuration. Public rails
remain disabled.

## Bootstrap exactly once

Bootstrap is the only command that returns the 24 recovery words:

```bash
docker exec -it openstays-merchant \
  node /app/synology/operator.mjs bootstrap
```

Write the words offline. Do not redirect them, copy them into chat, or take a
screenshot. They are returned only after the first encrypted generation is
durably committed and reread. A second bootstrap must fail.

Force and verify another generation without exposing its bytes:

```bash
docker exec openstays-merchant node /app/synology/operator.mjs backup
docker exec openstays-merchant node /app/synology/operator.mjs health
```

## Required recovery drill

Keep all public rails disabled. Create a separate manual-only root task that
reinstalls the staged launcher and verifies the same literal digest exactly as
above. Change only the final action:

```bash
/usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME=/nonexistent \
  /usr/local/sbin/openstays-merchant-root \
  recovery <40-character-commit>
```

Run once only after bootstrap and a verified backup exist, then disable or
remove the task. The drill:

1. commits a SHA-256 snapshot of signet wallet identity, balance, and stable
   activity fields without printing them;
2. stops only the attested merchant;
3. atomically moves the live wallet under
   `/volume1/docker/openstays-merchant/quarantine`;
4. starts only `merchant` and waits for verified `/volume2` restore;
5. requires the identical redacted snapshot; and
6. commits a fresh verified encrypted generation.

The quarantine is always preserved. On failure, leave quarantine and backup
generations untouched, keep public flags disabled, and investigate. Never
copy quarantine over a restored wallet or delete generations to make a test
pass.

## Recovery authority and optional timestamping

Atomic archive/manifest pairs on `/volume2` are the recovery authority.
OpenTimestamps may later timestamp a sanitized manifest to prove a commitment
existed by a particular time. It does not replace digest validation, atomic
publication, encrypted backups, or the restore drill.

## Enablement boundary

Zaprite and Wavelength are enabled independently only after their separate
credential-dependent acceptance tests pass. Wavelength remains signet-only.
The browser and Cloudflare Worker do not connect to the NAS; they interact
only with authoritative Convex state and the eligibility edge.
