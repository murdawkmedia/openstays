#!/bin/bash
set -euo pipefail

INSTALL_PATH=/usr/local/sbin/openstays-merchant-root
REPOSITORY_URL=https://github.com/murdawkmedia/openstays.git
APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
SOURCE_ROOT="$APP_ROOT/source"
SOURCE_QUARANTINE_ROOT="$APP_ROOT/source-quarantine"
RECOVERY_QUARANTINE_ROOT="$APP_ROOT/quarantine"
EXPECTED_UID=1026
EXPECTED_GID=100
SAFE_PATH=/usr/local/bin:/usr/bin:/bin

ENV=/usr/bin/env
READLINK=/usr/bin/readlink
STAT=/usr/bin/stat
GIT=/usr/local/bin/git
MKDIR=/bin/mkdir
CHOWN=/bin/chown
CHMOD=/bin/chmod
MV=/bin/mv
SYNC=/bin/sync
DATE=/bin/date
OD=/usr/bin/od
TR=/bin/tr
RM=/bin/rm

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$EUID" = "0" || fail ROOT_LAUNCHER_REQUIRES_ROOT
test "$("$READLINK" -f -- "$0")" = "$INSTALL_PATH" \
  || fail ROOT_LAUNCHER_INSTALL_PATH_INVALID

action="${1:-}"
commit="${2:-}"
case "$action" in
  deploy|recovery) ;;
  *) fail ROOT_LAUNCHER_ACTION_INVALID ;;
esac
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
  || fail ROOT_LAUNCHER_COMMIT_INVALID

if test "${OPENSTAYS_LAUNCHER_SANITIZED:-}" != "1"; then
  exec /usr/bin/env -i \
    PATH="$SAFE_PATH" \
    HOME=/nonexistent \
    OPENSTAYS_LAUNCHER_SANITIZED=1 \
    /bin/bash --noprofile --norc "$INSTALL_PATH" "$action" "$commit"
fi

while IFS='=' read -r environment_name _; do
  case "$environment_name" in
    BASH_FUNC_*|GIT_DIR|GIT_*|DOCKER_*|COMPOSE_*|CDPATH|ENV|BASH_ENV)
      fail ROOT_LAUNCHER_ENVIRONMENT_INVALID
      ;;
  esac
done < <("$ENV")

assert_exact_directory() {
  local path="$1"
  local expected_uid="$2"
  local expected_gid="$3"
  local expected_mode="$4"
  test -d "$path" && test ! -L "$path" \
    || fail ROOT_LAUNCHER_DIRECTORY_INVALID
  test "$("$READLINK" -f -- "$path")" = "$path" \
    || fail ROOT_LAUNCHER_DIRECTORY_INVALID
  test "$("$STAT" -c '%u:%g:%a' "$path")" \
    = "$expected_uid:$expected_gid:$expected_mode" \
    || fail ROOT_LAUNCHER_DIRECTORY_INVALID
}

assert_root_parent() {
  local path="$1"
  local mode
  test -d "$path" && test ! -L "$path" \
    || fail ROOT_LAUNCHER_PARENT_INVALID
  test "$("$READLINK" -f -- "$path")" = "$path" \
    || fail ROOT_LAUNCHER_PARENT_INVALID
  test "$("$STAT" -c '%u:%g' "$path")" = "0:0" \
    || fail ROOT_LAUNCHER_PARENT_INVALID
  mode="$("$STAT" -c '%a' "$path")"
  (( (8#$mode & 0022) == 0 )) || fail ROOT_LAUNCHER_PARENT_WRITABLE
}

create_exact_directory() {
  local path="$1"
  local expected_uid="$2"
  local expected_gid="$3"
  local expected_mode="$4"
  local parent="${path%/*}"
  local name="${path##*/}"
  local temporary="$parent/.${name}.new-$nonce"
  assert_root_parent "$parent"
  if test -e "$path" || test -L "$path"; then
    assert_exact_directory \
      "$path" "$expected_uid" "$expected_gid" "$expected_mode"
    return
  fi
  "$MKDIR" -m 700 -- "$temporary"
  "$CHOWN" "$expected_uid:$expected_gid" -- "$temporary"
  "$CHMOD" "$expected_mode" -- "$temporary"
  "$MV" -- "$temporary" "$path"
  "$SYNC" "$parent"
  assert_exact_directory \
    "$path" "$expected_uid" "$expected_gid" "$expected_mode"
}

nonce="$("$OD" -An -N16 -tx1 /dev/urandom | "$TR" -d ' \n')"
[[ "$nonce" =~ ^[0-9a-f]{32}$ ]] || fail ROOT_LAUNCHER_NONCE_FAILED

assert_root_parent /volume1/docker
assert_root_parent /volume2
create_exact_directory "$APP_ROOT" 0 0 700
create_exact_directory "$APP_ROOT/config" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$APP_ROOT/state" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$BACKUP_ROOT" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$SOURCE_QUARANTINE_ROOT" 0 0 700
create_exact_directory "$RECOVERY_QUARANTINE_ROOT" 0 0 700

stage="$APP_ROOT/.source-stage-$nonce"
"$MKDIR" -m 700 -- "$stage"
"$CHOWN" 0:0 -- "$stage"

"$GIT" \
  -c core.hooksPath=/dev/null \
  -c core.fsmonitor=false \
  -c protocol.file.allow=never \
  -c submodule.recurse=false \
  -C "$stage" init --quiet
"$GIT" \
  -c core.hooksPath=/dev/null \
  -c core.fsmonitor=false \
  -c protocol.file.allow=never \
  -c submodule.recurse=false \
  -C "$stage" remote add origin "$REPOSITORY_URL"
"$GIT" \
  -c core.hooksPath=/dev/null \
  -c core.fsmonitor=false \
  -c protocol.file.allow=never \
  -c submodule.recurse=false \
  -C "$stage" fetch --quiet --depth=1 origin "$commit"
"$GIT" \
  -c core.hooksPath=/dev/null \
  -c core.fsmonitor=false \
  -c protocol.file.allow=never \
  -c submodule.recurse=false \
  -C "$stage" checkout --quiet --detach "$commit"

test "$("$GIT" -c core.hooksPath=/dev/null -c core.fsmonitor=false \
  -C "$stage" rev-parse HEAD)" = "$commit" \
  || fail ROOT_LAUNCHER_SOURCE_COMMIT_MISMATCH
test -z "$("$GIT" -c core.hooksPath=/dev/null -c core.fsmonitor=false \
  -C "$stage" status --porcelain)" \
  || fail ROOT_LAUNCHER_SOURCE_DIRTY

if test -e "$SOURCE_ROOT" || test -L "$SOURCE_ROOT"; then
  assert_exact_directory "$SOURCE_ROOT" 0 0 700
  timestamp="$("$DATE" -u +%Y%m%dT%H%M%SZ)"
  previous="$SOURCE_QUARANTINE_ROOT/source-$timestamp-$nonce"
  test ! -e "$previous" && test ! -L "$previous" \
    || fail ROOT_LAUNCHER_SOURCE_QUARANTINE_COLLISION
  "$MV" -- "$SOURCE_ROOT" "$previous"
  "$SYNC" "$SOURCE_QUARANTINE_ROOT"
fi
"$MV" -- "$stage" "$SOURCE_ROOT"
"$SYNC" "$APP_ROOT"
assert_exact_directory "$SOURCE_ROOT" 0 0 700

handoff="$APP_ROOT/.root-handoff-$nonce"
handoff_cleanup() {
  status=$?
  trap - EXIT INT TERM
  if test -f "$handoff" && test ! -L "$handoff"; then
    "$RM" -f -- "$handoff"
  fi
  exit "$status"
}
trap handoff_cleanup EXIT
trap 'exit 130' INT TERM
umask 077
printf '%s\n%s\n%s\n' "$nonce" "$action" "$commit" > "$handoff"
"$CHOWN" 0:0 -- "$handoff"
"$CHMOD" 600 -- "$handoff"

case "$action" in
  deploy)
    target="$SOURCE_ROOT/ops/synology/deploy.sh"
    ;;
  recovery)
    target="$SOURCE_ROOT/ops/synology/recovery-drill.sh"
    ;;
esac

"$ENV" -i \
  PATH="$SAFE_PATH" \
  HOME=/nonexistent \
  OPENSTAYS_DSM_ROOT_TASK=1 \
  OPENSTAYS_DSM_SOURCE_COMMIT="$commit" \
  OPENSTAYS_ROOT_HANDOFF_FILE="$handoff" \
  OPENSTAYS_ROOT_HANDOFF_NONCE="$nonce" \
  /bin/bash --noprofile --norc "$target"

trap - EXIT INT TERM
"$RM" -f -- "$handoff"
printf '%s\n' "OpenStays root launcher completed: $action"
