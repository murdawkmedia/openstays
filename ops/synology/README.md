# Synology merchant operations

This directory packages the signet-only OpenStays merchant runtime for the
approved Synology host. It does not deploy to SHC and publishes no daemon,
gateway, or control port.

## Fixed trust boundary

- Application root: `/volume1/openstays-merchant`
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

Create `/volume1/openstays-merchant/config/merchant.env` as a regular,
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
path. The root-owned launcher verifies and publishes a locally generated,
digest-pinned source archive itself. Git is not required on the NAS.

## Install and run the root-owned launcher once

DSM Task Scheduler must never execute `deploy.sh`, `recovery-drill.sh`, or any
other file from a checkout writable by `murdawk`.

1. From a trusted, clean local checkout, record the full 40-character commit,
   create a Git archive of that exact commit, and compute both digests:

   ```bash
   commit="$(git rev-parse HEAD)"
   test -z "$(git status --porcelain)"
   git archive --format=tar \
     --output=openstays-merchant-source.tar "$commit"
   sha256sum openstays-merchant-source.tar
   wc -c < openstays-merchant-source.tar
   sha256sum ops/synology/root-launcher.sh
   wc -c < ops/synology/root-launcher.sh
   ```

2. Upload only those two generated inputs to their fixed, `murdawk`-writable
   staging paths:
   `/volume1/homes/murdawk/openstays-merchant-root-launcher.stage` and
   `/volume1/homes/murdawk/openstays-merchant-source.tar`.

The archive byte size and SHA-256 are the execution-integrity authority on the
NAS. The commit is a provenance label tied to those bytes by the trusted local
`git archive <exact-commit>` creation and recording step; without Git, the NAS
does not independently derive a commit from the archive.

3. In DSM **Control Panel → Task Scheduler**, create a manual-only
   **User-defined script** owned by `root`.
4. Confirm the trusted launcher digest is
   `8d5fdd6c887624aec4af6f4e61e4676e786e1a432f27fd001b1201ef2b369217`
   and its exact size is `7966` bytes. Replace `<40-character-commit>`,
   `<source-archive-byte-size>`, and
   `<64-character-source-archive-sha256>` with the locally recorded literal
   values. All sizes and digests must remain literals in the task, never read
   from the staging folder.

   ```bash
   set -euo pipefail
   launcher_parent=/usr/local
   launcher_directory=/usr/local/sbin
   test -d "$launcher_parent" && test ! -L "$launcher_parent" \
     || { printf '%s\n' 'invalid launcher parent' >&2; exit 70; }
   test "$(/usr/bin/readlink -f -- "$launcher_parent")" = "$launcher_parent" \
     && test "$(/usr/bin/stat -c '%u:%g:%a' "$launcher_parent")" = "0:0:755" \
     || { printf '%s\n' 'invalid launcher parent' >&2; exit 70; }
   if test ! -e "$launcher_directory" && test ! -L "$launcher_directory"; then
     /bin/mkdir -m 755 -- "$launcher_directory"
   fi
   test -d "$launcher_directory" && test ! -L "$launcher_directory" \
     && test "$(/usr/bin/readlink -f -- "$launcher_directory")" = "$launcher_directory" \
     && test "$(/usr/bin/stat -c '%u:%g:%a' "$launcher_directory")" = "0:0:755" \
     || { printf '%s\n' 'invalid launcher directory' >&2; exit 71; }
   launcher_stage=/volume1/homes/murdawk/openstays-merchant-root-launcher.stage
   launcher_size=7966
   launcher_temp=$(/usr/bin/mktemp "$launcher_directory/.openstays-merchant-root.new-XXXXXX")
   launcher_final="$launcher_directory/openstays-merchant-root"
   trap '/bin/rm -f -- "$launcher_temp"' EXIT
   copy_limit=$((launcher_size + 1))
   /usr/bin/timeout 5 /usr/bin/head -c "$copy_limit" -- "$launcher_stage" > "$launcher_temp"
   candidate_size=$(/usr/bin/wc -c < "$launcher_temp")
   test "$candidate_size" = "$launcher_size"
   candidate_sha256=$(/bin/sha256sum "$launcher_temp")
   case "${candidate_sha256%% *}" in
     8d5fdd6c887624aec4af6f4e61e4676e786e1a432f27fd001b1201ef2b369217) ;;
     *) exit 72 ;;
   esac
   /bin/chown root:root -- "$launcher_temp"
   /bin/chmod 700 -- "$launcher_temp"
   /bin/mv -f -- "$launcher_temp" "$launcher_final"
   trap - EXIT
   /usr/bin/env -i \
     PATH=/usr/local/bin:/usr/bin:/bin \
     HOME=/nonexistent \
     "$launcher_final" \
     deploy <40-character-commit> <source-archive-byte-size> \
       <64-character-source-archive-sha256>
   ```

5. Run it once and inspect the result. Disable or remove the task immediately.

The candidate size and hash are authoritative. The task reads at most one byte
beyond the literal expected size, under a timeout, into a unique root-owned
temporary sibling. It requires the exact byte count and digest before setting
the final mode and atomically renaming it over the trusted launcher. A symlink
to an infinite source, an unwritten FIFO, an oversized or short file, or a hash
mismatch removes only the exact temporary file, leaves any previous trusted
launcher unchanged, and never executes either candidate.

Host compatibility note (2026-07-27): the first live manual-task attempt
stopped safely because `/usr/local/sbin` did not exist. It did not install a
launcher or create an application root, backup root, or container. The current
task validates `/usr/local` as a canonical, non-symlink, root-owned mode-`0755`
directory before it does any staging work. It creates `/usr/local/sbin` with
mode `0755` only when that exact child is absent, then validates the child with
the same canonical-path, ownership, and mode checks. An existing symlink or a
directory with different ownership or permissions is rejected without repair.

For a later release, replace the DSM task body with the complete current block
above and use newly recorded literal commit, source-archive size/digest, and
launcher size/digest values. Do not manually create `/usr/local/sbin`, loosen
permissions, or run a checkout script directly. If the task reports
`invalid launcher parent` or `invalid launcher directory`, stop and inspect
that exact path before any further attempt.

The installed launcher is root-owned mode `0700` outside the checkout. It
re-executes itself through `env -i`, accepts only `deploy` or `recovery`, an
exact commit, and an exact archive digest. It copies the staged archive to a
unique root-owned temporary file, rehashes the copied bytes, rejects unsafe
member paths and non-file/directory member types, extracts under a root-owned
temporary directory, and records a root-owned commit-plus-digest attestation
before atomic publication. A prior source tree is moved intact into root-owned
quarantine and is never deleted.

Absent directory leaves are built under already trusted, non-writable parents
using unique temporary names and atomic rename. Existing leaves must already
be real directories with the exact owner and mode; symlinks and permission
drift are rejected without repair. Only the launcher can mint the root-owned,
mode-`0600` nonce handoff required by the checkout scripts. A direct
`OPENSTAYS_DSM_ROOT_TASK=1` call fails.

Never change the Docker socket, DSM users or groups. Never add `sudo`, an
alternate path, or unrelated container/volume commands to the task.

The deploy script renders Compose, builds and starts only `merchant`, then
re-attests its identity and polls authenticated loopback health for at most
30 seconds so Docker's started state cannot race the control listener. A
restored wallet whose only failing condition is backup staleness commits one
fresh verified generation inside that window; failed attempts continue until
control is ready, while a successful refresh happens at most once. A
terminal failure or signal after startup stops only that Compose service
through the same fixed configuration. Root-launched deployment also requires
`OPENSTAYS_RELEASE` to match the pinned source commit. Public rails remain
disabled.

The source archive is extracted by the root-owned launcher under a restrictive
umask. The container image must therefore normalize copied application source
to readable/traversable, but not writable, for the attested Synology runtime
identity `1026:100`. Image ownership alone is not sufficient because the
upstream image user has a different numeric UID.

## Bootstrap exactly once

Bootstrap is the only command that returns the 24 recovery words. Sign in to
DSM with the approved administrator account, open **Container Manager**, select
the attested `openstays-merchant` container, and open its authenticated terminal.
Run `node /app/synology/operator.mjs bootstrap` inside that terminal.

Write the words offline. Do not redirect them, copy them into task output,
logs, chat, or screenshots. They are returned only after the first encrypted
generation is durably committed and reread. A second bootstrap must fail; its
rejection is a required acceptance check.

For an explicit backup or redacted health check, use the same authenticated
DSM Container Manager terminal and run
`node /app/synology/operator.mjs backup` or
`node /app/synology/operator.mjs health`. Close the terminal afterwards.

## Required recovery drill

Keep all public rails disabled. Create a separate manual-only root task that
reinstalls the staged launcher and verifies the same literal digest exactly as
above. Change only the final action:

```bash
/usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME=/nonexistent \
  /usr/local/sbin/openstays-merchant-root \
  recovery <40-character-commit> <source-archive-byte-size> \
    <64-character-source-archive-sha256>
```

Run once only after bootstrap and a verified backup exist, then disable or
remove the task. The drill:

1. commits a SHA-256 snapshot of signet wallet identity, balance, and stable
   activity fields without printing them;
2. stops only the attested merchant;
3. atomically moves the live wallet under
   `/volume1/openstays-merchant/quarantine`;
4. starts only `merchant` and waits for verified `/volume2` restore;
5. requires the identical redacted snapshot; and
6. commits a fresh verified encrypted generation.

The quarantine is always preserved. On failure, leave quarantine and backup
generations untouched, keep public flags disabled, and investigate. Never
copy quarantine over a restored wallet or delete generations to make a test
pass.

The native 2026-07-28 acceptance passed at release
`ade31aaadaccb33f2e93978a15522e48180e8fb8`. It preserved quarantine
`wavelength-20260728T234223Z`, restored the signet wallet, returned redacted
health `ready`, and left all public rails disabled.

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
