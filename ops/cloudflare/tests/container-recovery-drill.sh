#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?merchant image reference is required}"
run_suffix="${GITHUB_RUN_ID:-local}-$$"
first_container="openstays-recovery-drill-first-${run_suffix}"
second_container="openstays-recovery-drill-second-${run_suffix}"
backup_path="${RUNNER_TEMP:-/tmp}/openstays-recovery-drill-${run_suffix}.enc"

for container_name in "$first_container" "$second_container"; do
  case "$container_name" in
    openstays-recovery-drill-*) ;;
    *) echo "refusing unsafe container name" >&2; exit 1 ;;
  esac
done

cleanup() {
  docker rm --force "$first_container" "$second_container" >/dev/null 2>&1 || true
  rm -f -- "$backup_path"
}
trap cleanup EXIT

backup_key="$(openssl rand -base64 32 | tr -d '\n')"
wallet_password="$(openssl rand -base64 24 | tr -d '\n')"
control_token="$(openssl rand -hex 24)"

run_container() {
  local container_name="$1"
  docker run --detach \
    --name "$container_name" \
    --env "WALLET_BACKUP_KEY_BASE64=$backup_key" \
    --env "WAVELENGTH_WALLET_PASSWORD=$wallet_password" \
    --env "CONTAINER_CONTROL_TOKEN=$control_token" \
    --env "OPENSTAYS_URL=http://127.0.0.1:9" \
    --env "WAVELENGTH_BRIDGE_TOKEN=recovery-drill" \
    --env "OTS_BRIDGE_TOKEN=recovery-drill" \
    --env "MAIL_BRIDGE_TOKEN=recovery-drill" \
    --env "OPENSTAYS_RELEASE=recovery-drill" \
    "$image_ref" >/dev/null
}

wait_for_control() {
  local container_name="$1"
  for _ in $(seq 1 40); do
    if docker exec \
      --env "CONTROL_TOKEN=$control_token" \
      "$container_name" \
      node --input-type=module --eval '
        const response = await fetch("http://127.0.0.1:8080/health", {
          headers: { Authorization: `Bearer ${process.env.CONTROL_TOKEN}` },
        });
        if (!response.ok) process.exit(1);
      ' >/dev/null 2>&1; then
      return
    fi
    sleep 0.25
  done
  echo "control server did not become reachable" >&2
  docker logs --tail 100 "$container_name" >&2 || true
  exit 1
}

run_container "$first_container"
wait_for_control "$first_container"

docker exec \
  --env "CONTROL_TOKEN=$control_token" \
  "$first_container" \
  node --input-type=module --eval '
    const response = await fetch("http://127.0.0.1:8080/bootstrap", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CONTROL_TOKEN}` },
    });
    const body = await response.json();
    if (
      response.status !== 201
      || !Array.isArray(body.mnemonic)
      || body.mnemonic.length !== 24
    ) {
      throw new Error(`bootstrap failed with status ${response.status}`);
    }
    process.stdout.write("bootstrap ok\n");
  '

backup_digest="$(
  docker exec \
    --env "CONTROL_TOKEN=$control_token" \
    "$first_container" \
    node --input-type=module --eval '
      const { writeFile } = await import("node:fs/promises");
      const response = await fetch("http://127.0.0.1:8080/backup", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CONTROL_TOKEN}` },
      });
      if (response.status !== 201) {
        throw new Error(`backup failed with status ${response.status}`);
      }
      const digest = response.headers.get("x-backup-sha256");
      if (!/^[a-f0-9]{64}$/.test(digest ?? "")) {
        throw new Error("backup digest missing");
      }
      await writeFile(
        "/tmp/openstays-recovery-drill.enc",
        Buffer.from(await response.arrayBuffer()),
        { mode: 0o600 },
      );
      process.stdout.write(digest);
    '
)"
docker cp \
  "$first_container:/tmp/openstays-recovery-drill.enc" \
  "$backup_path" >/dev/null

docker rm --force "$first_container" >/dev/null

run_container "$second_container"
wait_for_control "$second_container"
docker cp "$backup_path" \
  "$second_container:/tmp/openstays-recovery-drill.enc" >/dev/null

docker exec \
  --env "CONTROL_TOKEN=$control_token" \
  --env "BACKUP_DIGEST=$backup_digest" \
  "$second_container" \
  node --input-type=module --eval '
    const { readFile } = await import("node:fs/promises");
    const response = await fetch("http://127.0.0.1:8080/restore", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CONTROL_TOKEN}`,
        "X-Backup-Sha256": process.env.BACKUP_DIGEST,
      },
      body: await readFile("/tmp/openstays-recovery-drill.enc"),
    });
    const body = await response.json();
    if (response.status !== 200 || body.status !== "ready") {
      throw new Error(`restore failed with status ${response.status}`);
    }
  '

docker exec \
  --env "CONTROL_TOKEN=$control_token" \
  "$second_container" \
  node --input-type=module --eval '
    const response = await fetch("http://127.0.0.1:8080/health", {
      headers: { Authorization: `Bearer ${process.env.CONTROL_TOKEN}` },
    });
    const body = await response.json();
    if (response.status !== 200 || body.status !== "ready") {
      throw new Error(`restored health check failed: ${body.status}`);
    }
    process.stdout.write("restore ok\n");
  '
