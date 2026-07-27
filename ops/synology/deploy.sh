#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
ENV_FILE="$APP_ROOT/config/merchant.env"
COMPOSE_FILE="$APP_ROOT/source/ops/synology/docker-compose.yml"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$(id -un)" = "murdawk" \
  || fail DEPLOY_USER_MUST_BE_MURDAWK

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
    '2' \
    '/volume1/docker/openstays-merchant/state>/var/lib/openstays>bind>true' \
    '/volume2/openstays-wallet-backups>/var/backups/openstays>bind>true' \
    '0')"
  test "$observed" = "$expected"
}

verify_container_identity() {
  container_identity_matches || fail CONTAINER_IDENTITY_INVALID
}

assert_safe_target "$APP_ROOT"
assert_safe_target "$BACKUP_ROOT"

install -d -m 700 \
  "$APP_ROOT" \
  "$APP_ROOT/config" \
  "$APP_ROOT/state" \
  "$BACKUP_ROOT"

assert_managed_directory "$APP_ROOT" "$APP_ROOT"
assert_managed_directory "$BACKUP_ROOT" "$BACKUP_ROOT"
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

expected_uid="$(id -u murdawk)"
expected_gid="$(id -g murdawk)"
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

docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --build merchant

verify_container_identity
docker exec openstays-merchant \
  node /app/synology/operator.mjs health >/dev/null

printf '%s\n' 'OpenStays merchant deployed with public rails disabled.'
