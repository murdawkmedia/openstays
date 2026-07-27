#!/bin/bash
set -euo pipefail

INSTALL_PATH=/usr/local/sbin/openstays-merchant-root
STAGED_ARCHIVE=/volume1/homes/murdawk/openstays-merchant-source.tar
ARCHIVE_TEMP_ROOT=/volume1
APP_ROOT=/volume1/openstays-merchant
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
SHA256SUM=/bin/sha256sum
TAR=/bin/tar
TIMEOUT=/usr/bin/timeout
HEAD=/usr/bin/head
WC=/usr/bin/wc
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
test "$("$STAT" -c '%u:%g:%a' "$INSTALL_PATH")" = "0:0:700" \
  || fail ROOT_LAUNCHER_INSTALL_IDENTITY_INVALID

action="${1:-}"
commit="${2:-}"
archive_size="${3:-}"
archive_sha256="${4:-}"
case "$action" in
  deploy|recovery) ;;
  *) fail ROOT_LAUNCHER_ACTION_INVALID ;;
esac
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
  || fail ROOT_LAUNCHER_COMMIT_INVALID
[[ "$archive_size" =~ ^[1-9][0-9]{0,9}$ ]] \
  && (( archive_size <= 1073741824 )) \
  || fail ROOT_LAUNCHER_ARCHIVE_SIZE_INVALID
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || fail ROOT_LAUNCHER_ARCHIVE_DIGEST_INVALID

if test "${OPENSTAYS_LAUNCHER_SANITIZED:-}" != "1"; then
  exec /usr/bin/env -i \
    PATH="$SAFE_PATH" \
    HOME=/nonexistent \
    OPENSTAYS_LAUNCHER_SANITIZED=1 \
    /bin/bash --noprofile --norc \
      "$INSTALL_PATH" \
      "$action" "$commit" "$archive_size" "$archive_sha256"
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

assert_root_parent /volume1
assert_root_parent /volume2
create_exact_directory "$APP_ROOT" 0 0 700
create_exact_directory "$APP_ROOT/config" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$APP_ROOT/state" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$BACKUP_ROOT" "$EXPECTED_UID" "$EXPECTED_GID" 700
create_exact_directory "$SOURCE_QUARANTINE_ROOT" 0 0 700
create_exact_directory "$RECOVERY_QUARANTINE_ROOT" 0 0 700

archive_temp="$ARCHIVE_TEMP_ROOT/.openstays-source-$nonce.tar"
members="$APP_ROOT/.source-members-$nonce"
stage="$APP_ROOT/.source-stage-$nonce"
source_cleanup() {
  status=$?
  trap - EXIT INT TERM
  "$RM" -f -- "$archive_temp" "$members"
  if test -d "$stage" && test ! -L "$stage"; then
    "$RM" -rf -- "$stage"
  fi
  exit "$status"
}
trap source_cleanup EXIT
trap 'exit 130' INT TERM

test -f "$STAGED_ARCHIVE" && test ! -L "$STAGED_ARCHIVE" \
  || fail ROOT_LAUNCHER_ARCHIVE_REQUIRED
copy_limit=$((archive_size + 1))
"$TIMEOUT" 10 "$HEAD" -c "$copy_limit" -- "$STAGED_ARCHIVE" \
  > "$archive_temp" \
  || fail ROOT_LAUNCHER_ARCHIVE_COPY_FAILED
"$CHOWN" 0:0 -- "$archive_temp"
"$CHMOD" 600 -- "$archive_temp"
copied_size="$("$WC" -c < "$archive_temp")"
test "$copied_size" = "$archive_size" \
  || fail ROOT_LAUNCHER_ARCHIVE_SIZE_MISMATCH
copied_sha256="$("$SHA256SUM" "$archive_temp")"
test "${copied_sha256%% *}" = "$archive_sha256" \
  || fail ROOT_LAUNCHER_ARCHIVE_DIGEST_MISMATCH

"$TAR" -tf "$archive_temp" > "$members"
while IFS= read -r member; do
  test -n "$member" || fail ROOT_LAUNCHER_ARCHIVE_MEMBER_INVALID
  case "$member" in
    /*|..|../*|*/..|*/../*|*\\*)
      fail ROOT_LAUNCHER_ARCHIVE_MEMBER_INVALID
      ;;
  esac
done < "$members"
"$TAR" -tvf "$archive_temp" | while IFS= read -r listing; do
  case "${listing%"${listing#?}"}" in
    -|d) ;;
    *) fail ROOT_LAUNCHER_ARCHIVE_TYPE_INVALID ;;
  esac
done

"$MKDIR" -m 700 -- "$stage"
"$CHOWN" 0:0 -- "$stage"
"$TAR" --no-same-owner --no-same-permissions \
  --delay-directory-restore -xf "$archive_temp" -C "$stage"
test -f "$stage/ops/synology/deploy.sh" \
  && test ! -L "$stage/ops/synology/deploy.sh" \
  && test -f "$stage/ops/synology/recovery-drill.sh" \
  && test ! -L "$stage/ops/synology/recovery-drill.sh" \
  || fail ROOT_LAUNCHER_ARCHIVE_CONTENT_INVALID
"$CHOWN" -R 0:0 -- "$stage"
"$CHMOD" 700 -- "$stage"
assert_exact_directory "$stage" 0 0 700
printf '%s\n%s\n%s\n' "$commit" "$archive_size" "$archive_sha256" \
  > "$stage/.openstays-source-attestation"
"$CHOWN" 0:0 -- "$stage/.openstays-source-attestation"
"$CHMOD" 400 -- "$stage/.openstays-source-attestation"

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
"$RM" -f -- "$archive_temp" "$members"
trap - EXIT INT TERM

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
printf '%s\n%s\n%s\n%s\n%s\n' \
  "$nonce" "$action" "$commit" "$archive_size" "$archive_sha256" \
  > "$handoff"
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
  OPENSTAYS_DSM_SOURCE_ARCHIVE_SIZE="$archive_size" \
  OPENSTAYS_DSM_SOURCE_ARCHIVE_SHA256="$archive_sha256" \
  OPENSTAYS_ROOT_HANDOFF_FILE="$handoff" \
  OPENSTAYS_ROOT_HANDOFF_NONCE="$nonce" \
  /bin/bash --noprofile --norc "$target"

trap - EXIT INT TERM
"$RM" -f -- "$handoff"
printf '%s\n' "OpenStays root launcher completed: $action"
