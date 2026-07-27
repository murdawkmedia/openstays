#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
ENV_FILE="$APP_ROOT/config/merchant.env"
COMPOSE_FILE="$APP_ROOT/source/ops/synology/docker-compose.yml"
LIVE_WALLET="$APP_ROOT/state/wavelength"
QUARANTINE_ROOT="$APP_ROOT/state/quarantine"
PROJECT_NAME=openstays-merchant
SERVICE_NAME=merchant
CONTAINER_NAME=openstays-merchant

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$(id -un)" = "murdawk" \
  || fail RECOVERY_USER_MUST_BE_MURDAWK

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

assert_exact_directory "$APP_ROOT" "$APP_ROOT"
assert_exact_directory "$BACKUP_ROOT" "$BACKUP_ROOT"
test -f "$ENV_FILE" && test ! -L "$ENV_FILE" \
  || fail MERCHANT_ENV_REQUIRED
test -f "$COMPOSE_FILE" && test ! -L "$COMPOSE_FILE" \
  || fail COMPOSE_FILE_REQUIRED
test -d "$LIVE_WALLET" && test ! -L "$LIVE_WALLET" \
  || fail LIVE_WALLET_REQUIRED

install -d -m 700 "$QUARANTINE_ROOT"
assert_exact_directory "$QUARANTINE_ROOT" "$QUARANTINE_ROOT"
case "$QUARANTINE_ROOT/" in
  "$LIVE_WALLET/"|"$LIVE_WALLET/"*) fail QUARANTINE_CONTAINMENT_INVALID ;;
esac
case "$LIVE_WALLET/" in
  "$QUARANTINE_ROOT/"|"$QUARANTINE_ROOT/"*) fail QUARANTINE_CONTAINMENT_INVALID ;;
esac

wallet_snapshot() {
  docker exec openstays-merchant node --input-type=module --eval '
    const { createHash } = await import("node:crypto");
    async function post(path, body = {}) {
      const response = await fetch(`http://127.0.0.1:10031${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

docker compose --project-name openstays-merchant \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d merchant
wait_for_verified_restore

after_snapshot="$(wallet_snapshot)"
test "$after_snapshot" != "" || fail POST_RECOVERY_SNAPSHOT_FAILED
test "$after_snapshot" = "$before_snapshot" \
  || fail RESTORE_IDENTITY_ACTIVITY_MISMATCH

docker exec openstays-merchant \
  node /app/synology/operator.mjs backup >/dev/null
docker exec openstays-merchant \
  node /app/synology/operator.mjs health >/dev/null

printf 'Verified recovery drill complete; quarantine preserved at %s\n' \
  "$QUARANTINE_PATH"
