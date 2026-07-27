#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
ENV_FILE="$APP_ROOT/config/merchant.env"
COMPOSE_FILE="$APP_ROOT/source/ops/synology/docker-compose.yml"
PROJECT_NAME=openstays-merchant
SERVICE_NAME=merchant
CONTAINER_NAME=openstays-merchant

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$(id -un)" = "murdawk" \
  || fail DEPLOY_USER_MUST_BE_MURDAWK

assert_existing_physical_directory() {
  local path="$1"
  local expected
  local actual
  test -d "$path" || fail REQUIRED_PARENT_DIRECTORY_MISSING
  test ! -L "$path" || fail SYMLINK_PATH_REJECTED
  expected="$(cd "$path" && pwd -P)"
  actual="$(readlink -f -- "$path")"
  test "$actual" = "$expected" || fail PATH_CONTAINMENT_FAILED
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

assert_existing_physical_directory "$(dirname "$APP_ROOT")"
assert_existing_physical_directory "$(dirname "$BACKUP_ROOT")"

if test -e "$APP_ROOT"; then
  test ! -L "$APP_ROOT" || fail SYMLINK_PATH_REJECTED
fi
if test -e "$BACKUP_ROOT"; then
  test ! -L "$BACKUP_ROOT" || fail SYMLINK_PATH_REJECTED
fi

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

docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --build merchant

docker exec openstays-merchant \
  node /app/synology/operator.mjs health >/dev/null

printf '%s\n' 'OpenStays merchant deployed with public rails disabled.'
