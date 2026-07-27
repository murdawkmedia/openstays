#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
ENV_FILE="$APP_ROOT/config/merchant.env"
COMPOSE_FILE="$APP_ROOT/source/ops/synology/docker-compose.yml"
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
    if IFS= read -r extra; then
      fail ROOT_LAUNCHER_HANDOFF_REQUIRED
    fi
  } < "$handoff"
  test "$stored_nonce" = "$nonce" \
    && test "$stored_action" = "$expected_action" \
    && test "$stored_commit" = "${OPENSTAYS_DSM_SOURCE_COMMIT:-}" \
    || fail ROOT_LAUNCHER_HANDOFF_REQUIRED
}

require_clean_pinned_source() {
  local expected_commit="${OPENSTAYS_DSM_SOURCE_COMMIT:-}"
  local actual_commit
  local dirty
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] \
    || fail DSM_SOURCE_COMMIT_PIN_REQUIRED
  actual_commit="$(
    git -c "safe.directory=$APP_ROOT/source" \
      -c core.hooksPath=/dev/null \
      -c core.fsmonitor=false \
      -C "$APP_ROOT/source" rev-parse HEAD
  )" \
    || fail DSM_SOURCE_COMMIT_UNREADABLE
  test "$actual_commit" = "$expected_commit" \
    || fail DSM_SOURCE_COMMIT_MISMATCH
  dirty="$(
    git -c "safe.directory=$APP_ROOT/source" \
      -c core.hooksPath=/dev/null \
      -c core.fsmonitor=false \
      -C "$APP_ROOT/source" status --porcelain
  )" \
    || fail DSM_SOURCE_STATUS_UNREADABLE
  test -z "$dirty" || fail DSM_SOURCE_MUST_BE_CLEAN
}

root_task=false
case "$(id -un)" in
  murdawk)
    test -z "${OPENSTAYS_DSM_ROOT_TASK:-}" \
      || fail DSM_ROOT_TASK_REQUIRES_ROOT
    test "$(id -un)" = "murdawk" \
      || fail DEPLOY_USER_MUST_BE_MURDAWK
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
    fail DEPLOY_USER_MUST_BE_MURDAWK
    ;;
esac

test "$(id -u murdawk)" = "$EXPECTED_UID" \
  && test "$(id -g murdawk)" = "$EXPECTED_GID" \
  || fail MURDAWK_RUNTIME_IDENTITY_MISMATCH
if test "$root_task" = "true"; then
  verify_root_launcher_handoff deploy
fi

assert_safe_target() {
  local target="$1"
  local probe="$target"
  local parent
  local actual
  case "$target" in
    /*) ;;
    *) fail PATH_MUST_BE_ABSOLUTE ;;
  esac
  while test ! -e "$probe" && test ! -L "$probe"; do
    parent="$(dirname "$probe")"
    test "$parent" != "$probe" || fail REQUIRED_PARENT_DIRECTORY_MISSING
    probe="$parent"
  done
  test -d "$probe" || fail REQUIRED_PARENT_DIRECTORY_MISSING
  test ! -L "$probe" || fail SYMLINK_PATH_REJECTED
  actual="$(readlink -f -- "$probe")"
  test "$actual" = "$probe" || fail PATH_CONTAINMENT_FAILED
  case "$target" in
    "$probe"|"$probe/"*) ;;
    *) fail PATH_CONTAINMENT_FAILED ;;
  esac
}

assert_managed_directory() {
  local path="$1"
  local expected="$2"
  local actual
  test -d "$path" || fail MANAGED_DIRECTORY_MISSING
  test ! -L "$path" || fail SYMLINK_PATH_REJECTED
  actual="$(readlink -f -- "$path")"
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

require_secret() {
  local name="$1"
  local value
  value="$(env_value "$name")"
  test -n "$value" || fail REQUIRED_SECRET_MISSING
  case "$value" in
    *$'\r'*|*$'\n'*) fail REQUIRED_SECRET_INVALID ;;
  esac
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
    '/volume1/docker/openstays-merchant/state>/var/lib/openstays>bind>true' \
    '/volume2/openstays-wallet-backups>/var/backups/openstays>bind>true' \
    '0')"
  test "$observed" = "$expected"
}

verify_container_identity() {
  container_identity_matches || fail CONTAINER_IDENTITY_INVALID
}

stop_failed_deploy() {
  exit_status=$?
  trap - EXIT INT TERM
  docker compose --project-name openstays-merchant \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    stop merchant >/dev/null 2>&1 || true
  exit "$exit_status"
}

assert_safe_target "$APP_ROOT"
assert_safe_target "$BACKUP_ROOT"

if test "$root_task" = "true"; then
  assert_safe_target "$APP_ROOT/source"
  require_clean_pinned_source
else
  install -d -m 700 \
    "$APP_ROOT" \
    "$APP_ROOT/config" \
    "$APP_ROOT/state" \
    "$BACKUP_ROOT"
fi

assert_managed_directory "$APP_ROOT" "$APP_ROOT"
assert_managed_directory "$BACKUP_ROOT" "$BACKUP_ROOT"
if test "$root_task" = "true"; then
  test "$(stat -c '%u:%g:%a' "$APP_ROOT")" = "0:0:700" \
    || fail MANAGED_DIRECTORY_IDENTITY_INVALID
  test "$(stat -c '%u:%g:%a' "$APP_ROOT/source")" = "0:0:700" \
    || fail MANAGED_DIRECTORY_IDENTITY_INVALID
  for runtime_path in \
    "$APP_ROOT/config" "$APP_ROOT/state" "$BACKUP_ROOT"
  do
    assert_managed_directory "$runtime_path" "$runtime_path"
    test "$(stat -c '%u:%g:%a' "$runtime_path")" \
      = "$EXPECTED_UID:$EXPECTED_GID:700" \
      || fail MANAGED_DIRECTORY_IDENTITY_INVALID
  done
fi
test -f "$ENV_FILE" && test ! -L "$ENV_FILE" \
  || fail MERCHANT_ENV_REQUIRED
test -f "$COMPOSE_FILE" && test ! -L "$COMPOSE_FILE" \
  || fail COMPOSE_FILE_REQUIRED

env_mode="$(stat -c '%a' "$ENV_FILE")"
env_owner="$(stat -c '%U' "$ENV_FILE")"
case "$env_mode" in
  400|600) ;;
  *) fail MERCHANT_ENV_PERMISSIONS_MUST_BE_0600 ;;
esac
case "$env_owner" in
  murdawk|root) ;;
  *) fail MERCHANT_ENV_OWNER_INVALID ;;
esac

expected_uid="$EXPECTED_UID"
expected_gid="$EXPECTED_GID"
test "$(env_value OPENSTAYS_UID)" = "$expected_uid" \
  || fail OPENSTAYS_UID_MISMATCH
test "$(env_value OPENSTAYS_GID)" = "$expected_gid" \
  || fail OPENSTAYS_GID_MISMATCH

for secret_name in \
  OPENSTAYS_API_KEY \
  CONTAINER_CONTROL_TOKEN \
  WALLET_BACKUP_KEY_BASE64 \
  WAVELENGTH_WALLET_PASSWORD \
  WAVELENGTH_BRIDGE_TOKEN \
  WAVELENGTH_HEARTBEAT_TOKEN \
  OTS_BRIDGE_TOKEN \
  OTS_HEARTBEAT_TOKEN \
  MAIL_BRIDGE_TOKEN \
  MAIL_HEARTBEAT_TOKEN \
  SMTP_PASSWORD
do
  require_secret "$secret_name"
done

require_disabled_flag ZAPRITE_ENABLED
require_disabled_flag WAVELENGTH_ENABLED
require_disabled_flag WAVELENGTH_REWARDS_ENABLED

docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  config --quiet

if docker container inspect openstays-merchant >/dev/null 2>&1; then
  verify_container_identity
fi

trap stop_failed_deploy EXIT
trap 'exit 130' INT TERM
docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --build merchant

verify_container_identity
docker exec openstays-merchant \
  node /app/synology/operator.mjs health >/dev/null

trap - EXIT INT TERM
printf '%s\n' 'OpenStays merchant deployed with public rails disabled.'
