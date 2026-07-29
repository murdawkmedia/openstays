#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/volume1/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
ENV_FILE="$APP_ROOT/config/merchant.env"
COMPOSE_FILE="$APP_ROOT/source/ops/synology/docker-compose.yml"
LIVE_WALLET="$APP_ROOT/state/wavelength"
QUARANTINE_ROOT="$APP_ROOT/quarantine"
EXPECTED_UID=1026
EXPECTED_GID=100
ROOT_TASK_PATH=/usr/local/bin:/usr/bin:/bin

PATH="$ROOT_TASK_PATH"
export PATH

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

verify_root_launcher_handoff() {
  local expected_action="$1"
  local handoff="${OPENSTAYS_ROOT_HANDOFF_FILE:-}"
  local nonce="${OPENSTAYS_ROOT_HANDOFF_NONCE:-}"
  local stored_nonce
  local stored_action
  local stored_commit
  local stored_archive_size
  local stored_archive_sha256
  local extra
  [[ "$nonce" =~ ^[0-9a-f]{32}$ ]] \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  [[ "$handoff" =~ ^${APP_ROOT}/\.root-handoff-[0-9a-f]{32}$ ]] \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  test "$handoff" = "$APP_ROOT/.root-handoff-$nonce" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  test -f "$handoff" && test ! -L "$handoff" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  test "$(readlink -f -- "$handoff")" = "$handoff" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  test "$(stat -c '%u:%g:%a' "$handoff")" = "0:0:600" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
  {
    IFS= read -r stored_nonce
    IFS= read -r stored_action
    IFS= read -r stored_commit
    IFS= read -r stored_archive_size
    IFS= read -r stored_archive_sha256
    if IFS= read -r extra; then
      fail ROOT_LAUNCHER_HANDOFF_REQUIRED
    fi
  } < "$handoff"
  test "$stored_nonce" = "$nonce" \
    && test "$stored_action" = "$expected_action" \
    && test "$stored_commit" = "${OPENSTAYS_DSM_SOURCE_COMMIT:-}" \
    && test "$stored_archive_size" \
      = "${OPENSTAYS_DSM_SOURCE_ARCHIVE_SIZE:-}" \
    && test "$stored_archive_sha256" \
      = "${OPENSTAYS_DSM_SOURCE_ARCHIVE_SHA256:-}" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
}

require_pinned_source_attestation() {
  local expected_commit="${OPENSTAYS_DSM_SOURCE_COMMIT:-}"
  local expected_archive_size="${OPENSTAYS_DSM_SOURCE_ARCHIVE_SIZE:-}"
  local expected_archive_sha256="${OPENSTAYS_DSM_SOURCE_ARCHIVE_SHA256:-}"
  local attestation="$APP_ROOT/source/.openstays-source-attestation"
  local actual_commit
  local actual_archive_size
  local actual_archive_sha256
  local extra
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] \
    || fail DSM_SOURCE_COMMIT_PIN_REQUIRED
  [[ "$expected_archive_size" =~ ^[1-9][0-9]{0,9}$ ]] \
    || fail DSM_SOURCE_ARCHIVE_SIZE_PIN_REQUIRED
  [[ "$expected_archive_sha256" =~ ^[0-9a-f]{64}$ ]] \
    || fail DSM_SOURCE_ARCHIVE_DIGEST_PIN_REQUIRED
  test -f "$attestation" && test ! -L "$attestation" \
    && test "$(readlink -f -- "$attestation")" = "$attestation" \
    && test "$(stat -c '%u:%g:%a' "$attestation")" = "0:0:400" \
    || fail DSM_SOURCE_ATTESTATION_INVALID
  {
    IFS= read -r actual_commit
    IFS= read -r actual_archive_size
    IFS= read -r actual_archive_sha256
    if IFS= read -r extra; then
      fail DSM_SOURCE_ATTESTATION_INVALID
    fi
  } < "$attestation"
  test "$actual_commit" = "$expected_commit" \
    && test "$actual_archive_size" = "$expected_archive_size" \
    && test "$actual_archive_sha256" = "$expected_archive_sha256" \
    || fail DSM_SOURCE_ATTESTATION_MISMATCH
}

root_task=false
case "$(id -un)" in
  murdawk)
    test -z "${OPENSTAYS_DSM_ROOT_TASK:-}" \
      || fail DSM_ROOT_TASK_REQUIRES_ROOT
    test "$(id -un)" = "murdawk" \
      || fail RECOVERY_USER_MUST_BE_MURDAWK
    ;;
  root)
    test "${OPENSTAYS_DSM_ROOT_TASK:-}" = "1" \
      || fail DSM_ROOT_TASK_FLAG_REQUIRED
    for rejected_name in \
      BASH_ENV ENV CDPATH DOCKER_HOST DOCKER_CONTEXT \
      COMPOSE_FILE COMPOSE_PROJECT_NAME
    do
      if rejected_value="$(printenv "$rejected_name" 2>/dev/null)"; then
        test -z "$rejected_value" \
          || fail DSM_ROOT_TASK_ENVIRONMENT_INVALID
      fi
    done
    umask 077
    root_task=true
    ;;
  *)
    fail RECOVERY_USER_MUST_BE_MURDAWK
    ;;
esac

test "$(id -u murdawk)" = "$EXPECTED_UID" \
  && test "$(id -g murdawk)" = "$EXPECTED_GID" \
  || fail MURDAWK_RUNTIME_IDENTITY_MISMATCH
if test "$root_task" = "true"; then
  verify_root_launcher_handoff recovery
fi

physical_path() {
  readlink -f -- "$1"
}

assert_exact_directory() {
  local path="$1"
  local expected="$2"
  local actual
  test -d "$path" || fail REQUIRED_DIRECTORY_MISSING
  test ! -L "$path" || fail SYMLINK_PATH_REJECTED
  actual="$(physical_path "$path")"
  test "$actual" = "$expected" || fail PATH_CONTAINMENT_FAILED
}

env_value() {
  local name="$1"
  local count
  local line
  count="$(grep -Ec "^${name}=" "$ENV_FILE" || true)"
  test "$count" = "1" || fail ENV_KEY_MISSING_OR_DUPLICATE
  line="$(grep -E "^${name}=" "$ENV_FILE")"
  printf '%s' "${line#*=}"
}

require_disabled_flag() {
  local name="$1"
  test "$(env_value "$name")" = "false" \
    || fail PUBLIC_RAIL_MUST_BEGIN_DISABLED
}

container_identity() {
  docker inspect --format \
    '{{ index .Config.Labels "com.docker.compose.project" }}
{{ index .Config.Labels "com.docker.compose.service" }}
{{ .Config.User }}
{{ len .Mounts }}
{{ range .Mounts }}{{ .Source }}>{{ .Destination }}>{{ .Type }}>{{ .RW }}
{{ end }}{{ len .HostConfig.PortBindings }}' \
    openstays-merchant
}

container_identity_matches() {
  local observed
  local expected
  observed="$(container_identity 2>/dev/null)" || return 1
  expected="$(printf '%s\n' \
    'openstays-merchant' \
    'merchant' \
    '1026:100' \
    '2' \
    '/volume1/openstays-merchant/state>/var/lib/openstays>bind>true' \
    '/volume2/openstays-wallet-backups>/var/backups/openstays>bind>true' \
    '0')"
  test "$observed" = "$expected"
}

verify_container_identity() {
  container_identity_matches || fail CONTAINER_IDENTITY_INVALID
}

assert_exact_directory "$APP_ROOT" "$APP_ROOT"
assert_exact_directory "$BACKUP_ROOT" "$BACKUP_ROOT"
if test "$root_task" = "true"; then
  assert_exact_directory "$APP_ROOT/source" "$APP_ROOT/source"
  test "$(stat -c '%u:%g:%a' "$APP_ROOT")" = "0:0:700" \
    && test "$(stat -c '%u:%g:%a' "$APP_ROOT/source")" = "0:0:700" \
    || fail MANAGED_DIRECTORY_IDENTITY_INVALID
  for runtime_path in \
    "$APP_ROOT/config" "$APP_ROOT/state" "$BACKUP_ROOT"
  do
    assert_exact_directory "$runtime_path" "$runtime_path"
    test "$(stat -c '%u:%g:%a' "$runtime_path")" \
      = "$EXPECTED_UID:$EXPECTED_GID:700" \
      || fail MANAGED_DIRECTORY_IDENTITY_INVALID
  done
  require_pinned_source_attestation
fi
test -f "$ENV_FILE" && test ! -L "$ENV_FILE" \
  || fail MERCHANT_ENV_REQUIRED
test -f "$COMPOSE_FILE" && test ! -L "$COMPOSE_FILE" \
  || fail COMPOSE_FILE_REQUIRED
test -d "$LIVE_WALLET" && test ! -L "$LIVE_WALLET" \
  || fail LIVE_WALLET_REQUIRED

require_disabled_flag ZAPRITE_ENABLED
require_disabled_flag WAVELENGTH_ENABLED
require_disabled_flag WAVELENGTH_REWARDS_ENABLED
verify_container_identity

if test "$root_task" = "true"; then
  assert_exact_directory "$QUARANTINE_ROOT" "$QUARANTINE_ROOT"
  test "$(stat -c '%u:%g:%a' "$QUARANTINE_ROOT")" = "0:0:700" \
    || fail QUARANTINE_IDENTITY_INVALID
else
  install -d -m 700 "$QUARANTINE_ROOT"
fi
assert_exact_directory "$QUARANTINE_ROOT" "$QUARANTINE_ROOT"
case "$QUARANTINE_ROOT/" in
  "$LIVE_WALLET/"|"$LIVE_WALLET/"*) fail QUARANTINE_CONTAINMENT_INVALID ;;
esac
case "$LIVE_WALLET/" in
  "$QUARANTINE_ROOT/"|"$QUARANTINE_ROOT/"*) fail QUARANTINE_CONTAINMENT_INVALID ;;
esac

wallet_snapshot() {
  # The single-quoted program is intentionally expanded by Node, not Bash.
  # shellcheck disable=SC2016
  docker exec openstays-merchant node --input-type=module --eval '
    const { createHash } = await import("node:crypto");
    async function post(path, body = {}) {
      const response = await fetch(`http://127.0.0.1:10031${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`snapshot request failed: ${path}`);
      return response.json();
    }
    const info = await post("/v1/daemon/get-info");
    const status = await post("/v1/wallet/status");
    const identity = info.identity_pubkey;
    const network = info.network ?? status.network;
    if (
      typeof identity !== "string"
      || !/^[a-f0-9]{66}$/i.test(identity)
      || network !== "signet"
      || status.unlocked !== true
    ) {
      throw new Error("wallet identity unavailable");
    }
    const activity = [];
    let cursor = "";
    for (let page = 0; page < 100; page += 1) {
      const result = await post("/v1/wallet/list", {
        view: "LIST_VIEW_ACTIVITY",
        limit: 100,
        cursor,
      });
      const batch = result.activity;
      if (!batch || !Array.isArray(batch.entries)) {
        throw new Error("wallet activity unavailable");
      }
      for (const entry of batch.entries) {
        activity.push({
          id: entry.id,
          kind: entry.kind,
          status: entry.status,
          amount_sat: entry.amount_sat,
          fee_sat: entry.fee_sat,
          created_at_unix: entry.created_at_unix,
        });
      }
      if (batch.has_more !== true) break;
      if (typeof batch.next_cursor !== "string" || batch.next_cursor === "") {
        throw new Error("wallet activity cursor invalid");
      }
      cursor = batch.next_cursor;
      if (page === 99) throw new Error("wallet activity exceeds drill limit");
    }
    activity.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const redacted = {
      identity,
      network,
      balance: status.balance,
      pending_count: status.pending_count,
      activity,
    };
    process.stdout.write(
      createHash("sha256")
        .update(JSON.stringify(redacted))
        .digest("hex"),
    );
  '
}

wait_for_verified_restore() {
  local output
  for _ in $(seq 1 60); do
    if output="$(
      docker exec openstays-merchant \
        node /app/synology/operator.mjs health 2>/dev/null
    )"; then
      case "$output" in
        *'"status":"ready"'*) return ;;
      esac
    fi
    sleep 2
  done
  fail VERIFIED_RESTORE_DID_NOT_BECOME_READY
}

recovery_container_started=false
stop_failed_recovery() {
  exit_status=$?
  trap - EXIT
  if test "$exit_status" -ne 0 \
    && test "$recovery_container_started" = "true" \
    && container_identity_matches
  then
    docker stop openstays-merchant >/dev/null || true
  fi
  exit "$exit_status"
}

before_snapshot="$(wallet_snapshot)"
test "$before_snapshot" != "" || fail PRE_RECOVERY_SNAPSHOT_FAILED

docker stop openstays-merchant >/dev/null

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
QUARANTINE_PATH="$QUARANTINE_ROOT/wavelength-$timestamp"
test ! -e "$QUARANTINE_PATH" || fail QUARANTINE_PATH_ALREADY_EXISTS
case "$QUARANTINE_PATH" in
  "$QUARANTINE_ROOT/"*) ;;
  *) fail QUARANTINE_CONTAINMENT_INVALID ;;
esac

sync
mv -- "$LIVE_WALLET" "$QUARANTINE_PATH"
sync
test -d "$QUARANTINE_PATH" && test ! -e "$LIVE_WALLET" \
  || fail WALLET_QUARANTINE_FAILED

recovery_container_started=true
trap stop_failed_recovery EXIT
docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --force-recreate --no-build merchant
verify_container_identity
wait_for_verified_restore

after_snapshot="$(wallet_snapshot)"
test "$after_snapshot" != "" || fail POST_RECOVERY_SNAPSHOT_FAILED
test "$after_snapshot" = "$before_snapshot" \
  || fail RESTORE_IDENTITY_ACTIVITY_MISMATCH

docker exec openstays-merchant \
  node /app/synology/operator.mjs backup >/dev/null
docker exec openstays-merchant \
  node /app/synology/operator.mjs health >/dev/null

trap - EXIT
printf 'Verified recovery drill complete; quarantine preserved at %s\n' \
  "$QUARANTINE_PATH"
