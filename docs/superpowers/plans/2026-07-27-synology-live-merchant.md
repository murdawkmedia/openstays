# Synology Live Merchant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the signet-only OpenStays merchant bridge on Synology with verified encrypted recovery on a separate volume, then enable public Zaprite and Wavelength only after independent live acceptance.

**Architecture:** Keep the existing pinned merchant image and Convex payment authority. Add a small Synology supervisor that restores only from verified encrypted generations, binds control and wallet services to container loopback, and writes atomic backup generations to `/volume2`. Deploy the Cloudflare Worker in eligibility-only mode, with no Cloudflare Container or R2 dependency.

**Tech Stack:** Node.js 24 ESM, Vitest, Docker Compose, Synology Container Manager, Wavelength v0.1.0 signet, OpenTimestamps Python client 0.7.2, Cloudflare Workers/Turnstile, Convex.

---

## File map

- Create `ops/synology/generationStore.mjs`: validate, atomically publish, select,
  and retain encrypted wallet generations.
- Create `ops/synology/supervisor.mjs`: restore-before-start lifecycle,
  bootstrap-and-backup transaction, periodic backup, and local health.
- Create `ops/synology/operator.mjs`: loopback control client used through
  `docker exec`.
- Create `ops/synology/docker-compose.yml`: isolated Synology runtime with no
  published ports and explicit `/volume1` and `/volume2` mounts.
- Create `ops/synology/.env.example`: names and inert defaults only.
- Create `ops/synology/deploy.sh`: guarded install/update/health commands.
- Create `ops/synology/README.md`: host operations and recovery runbook.
- Modify `ops/cloudflare/container/Dockerfile`: include Synology scripts without
  changing the Cloudflare entrypoint.
- Create `ops/cloudflare/wrangler.synology.jsonc`: eligibility-only Worker
  deployment with no Container, Durable Object, or R2 bindings.
- Create `ops/cloudflare/tests/synologyGenerationStore.test.ts`.
- Create `ops/cloudflare/tests/synologySupervisor.test.ts`.
- Modify `docs/operations/public-live-payments-runbook.md`.
- Modify `docs/public-live-payments.md`.
- Modify `STATUS.md` and `CLAUDE.md` after acceptance.

### Task 1: Verified generation store

**Files:**
- Create: `ops/synology/generationStore.mjs`
- Test: `ops/cloudflare/tests/synologyGenerationStore.test.ts`

- [ ] **Step 1: Write failing validation and selection tests**

Create tests that use a temporary directory and import:

```ts
import {
  GenerationStore,
} from '../../synology/generationStore.mjs';
```

Cover:

```ts
it('publishes and reloads a verified generation', async () => {
  const store = new GenerationStore(root, { retain: 3 });
  const bytes = Buffer.from('encrypted-wallet');
  const manifest = await store.commit(bytes, 'release-1', 1_000);
  expect(await store.loadLatest()).toEqual({ bytes, manifest });
});

it('rejects a manifest whose archive digest does not match', async () => {
  // Commit a valid generation, replace only the archive bytes, then assert
  // loadLatest() rejects with BACKUP_DIGEST_MISMATCH.
});

it('falls back to the newest older valid generation', async () => {
  // Commit generations 1 and 2, corrupt generation 2, and assert generation 1
  // is selected without deleting either generation.
});

it('retains the last known-good generation when pruning', async () => {
  // Commit four generations with retain=3 and assert exactly three valid
  // archive/manifest pairs remain.
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologyGenerationStore.test.ts
```

Expected: FAIL because `ops/synology/generationStore.mjs` does not exist.

- [ ] **Step 3: Implement the minimal generation store**

Implement:

```js
export class GenerationStore {
  constructor(root, { retain = 12 } = {}) {
    this.root = resolve(root);
    this.retain = retain;
  }

  async commit(bytes, release, now = Date.now()) {
    // Determine next monotonic generation.
    // Write archive and manifest to unique `.tmp` files with mode 0600.
    // fsync each file, rename archive first and manifest last, then reread and
    // verify both before pruning.
  }

  async loadLatest() {
    // Scan manifests newest-first. Validate schema version, generation,
    // byteLength, SHA-256, release, and ISO creation time. Return the first
    // valid pair. Throw BACKUP_REQUIRED when no valid pair exists.
  }
}
```

Use manifest schema:

```js
{
  schema: 'openstays.synology-wallet-backup.v1',
  generation,
  createdAt: new Date(now).toISOString(),
  release,
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}
```

- [ ] **Step 4: Run focused and operations tests**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologyGenerationStore.test.ts
npm --prefix ops/cloudflare run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- ops/synology/generationStore.mjs ops/cloudflare/tests/synologyGenerationStore.test.ts
git commit -m "feat: add verified Synology wallet generations"
```

### Task 2: Restore-first Synology supervisor

**Files:**
- Create: `ops/synology/supervisor.mjs`
- Test: `ops/cloudflare/tests/synologySupervisor.test.ts`
- Modify: `ops/cloudflare/container/control.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Use dependency injection for filesystem, `MerchantControl`, generation store,
and timers. Cover:

```ts
it('restores a verified generation before starting workers', async () => {
  const events: string[] = [];
  const supervisor = createSupervisor({
    store: fakeStore({ bytes, manifest }),
    control: fakeControl(events),
  });
  await supervisor.start();
  expect(events).toEqual(['load-backup', 'restore', 'start']);
});

it('stays unavailable when no backup exists', async () => {
  const supervisor = createSupervisor({
    store: fakeMissingStore(),
    control: fakeControl([]),
  });
  await supervisor.start();
  expect(supervisor.health()).toMatchObject({
    status: 'awaiting_bootstrap',
  });
});

it('commits a verified backup before returning the bootstrap mnemonic', async () => {
  const events: string[] = [];
  const result = await supervisor.bootstrap();
  expect(events).toEqual(['bootstrap', 'backup', 'commit']);
  expect(result.mnemonic).toHaveLength(24);
});

it('does not return recovery words when the first backup fails', async () => {
  await expect(supervisor.bootstrap()).rejects.toThrow('INITIAL_BACKUP_FAILED');
});

it('serializes periodic backups and reports stale backup health', async () => {
  // Two overlapping ticks produce at most one backup at a time; health fails
  // when lastVerifiedBackupAt is older than 120 seconds.
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologySupervisor.test.ts
```

Expected: FAIL because `createSupervisor` is missing.

- [ ] **Step 3: Implement supervisor composition**

Export:

```js
export function createSupervisor({
  control,
  store,
  backupIntervalMs = 60_000,
  staleAfterMs = 120_000,
  now = Date.now,
  schedule = setInterval,
}) {
  // start(): load the newest valid generation, move any existing live wallet
  // to a timestamped quarantine directory, restore into an empty directory,
  // then call control.start(). Never start workers from the live directory
  // merely because it survived a container restart.
  // If and only if BACKUP_REQUIRED occurs, enter awaiting_bootstrap.
  // bootstrap(): call control.bootstrap(), control.backup(), store.commit(),
  // verify store.loadLatest(), then return the mnemonic.
  // backupNow(): serialize in-flight work and advance health only after verify.
  // health(): combine control health with backup age.
  // stop(): clear timer and stop control.
}
```

Refactor `createControlServer` in `control.mjs` to accept the same narrow
interface used by both `MerchantControl` and the supervisor:

```js
{
  bootstrap(): Promise<{ mnemonic: string[] }>;
  backup(outputPath: string): { sha256: string; byteLength: number };
  health(): { status: string; failureCategory?: string; release: string };
  stop(): void;
}
```

Do not change Cloudflare container behavior.

- [ ] **Step 4: Verify focused and existing control tests**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologySupervisor.test.ts control.test.ts merchantContainer.test.ts
npm --prefix ops/cloudflare run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- ops/synology/supervisor.mjs ops/cloudflare/container/control.mjs ops/cloudflare/tests/synologySupervisor.test.ts
git commit -m "feat: add restore-first Synology merchant supervisor"
```

### Task 3: Operator client and container wiring

**Files:**
- Create: `ops/synology/operator.mjs`
- Modify: `ops/cloudflare/container/Dockerfile`
- Create: `ops/synology/docker-compose.yml`
- Create: `ops/synology/.env.example`
- Test: `ops/cloudflare/tests/synologySupervisor.test.ts`

- [ ] **Step 1: Add failing operator and binding tests**

Test that:

- operator commands accept only `health`, `bootstrap`, and `backup`;
- requests use `Authorization: Bearer <CONTAINER_CONTROL_TOKEN>`;
- mnemonic output is produced only for successful bootstrap;
- Compose contains no `ports:` entry;
- Compose mounts `/volume1/docker/openstays-merchant/state` and
  `/volume2/openstays-wallet-backups`;
- Compose sets `network_mode: bridge`, `restart: unless-stopped`, a memory
  ceiling, and a health check.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologySupervisor.test.ts
```

Expected: FAIL because the operator and Compose files are absent.

- [ ] **Step 3: Implement operator and image wiring**

`operator.mjs` calls only loopback:

```js
const routes = {
  health: ['GET', '/health'],
  bootstrap: ['POST', '/bootstrap'],
  backup: ['POST', '/backup'],
};
```

Compose shape:

```yaml
services:
  merchant:
    container_name: openstays-merchant
    build:
      context: ../..
      dockerfile: ops/cloudflare/container/Dockerfile
    entrypoint: ["node", "/app/synology/supervisor.mjs"]
    env_file: ["/volume1/docker/openstays-merchant/config/merchant.env"]
    volumes:
      - /volume1/docker/openstays-merchant/state:/var/lib/openstays
      - /volume2/openstays-wallet-backups:/var/backups/openstays
    restart: unless-stopped
    mem_limit: 2g
    healthcheck:
      test: ["CMD", "node", "/app/synology/operator.mjs", "health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

The Dockerfile copies `ops/synology/*.mjs` to `/app/synology/` as user `node`.
It does not expose or publish the daemon, gateway, or control port.

- [ ] **Step 4: Verify tests and Compose rendering**

Run locally:

```powershell
npm --prefix ops/cloudflare test -- synologySupervisor.test.ts
docker compose --env-file ops/synology/.env.example -f ops/synology/docker-compose.yml config
```

Expected: tests PASS and rendered Compose has no host ports.

- [ ] **Step 5: Commit**

```powershell
git add -- ops/synology/operator.mjs ops/synology/docker-compose.yml ops/synology/.env.example ops/cloudflare/container/Dockerfile ops/cloudflare/tests/synologySupervisor.test.ts
git commit -m "feat: package Synology merchant container"
```

### Task 4: Guarded Synology deployment and recovery drill

**Files:**
- Create: `ops/synology/deploy.sh`
- Create: `ops/synology/README.md`
- Create: `ops/synology/recovery-drill.sh`

- [ ] **Step 1: Write shell contract checks**

Add a Vitest file-content test asserting:

- the scripts require exact app and backup roots;
- neither script calls `docker system prune`, removes unrelated containers, or
  recursively deletes either volume root;
- deployment starts with public flags disabled;
- recovery moves the live wallet to a timestamped quarantine path;
- recovery verifies wallet identity before removing nothing.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologyScripts.test.ts
```

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement guarded scripts**

`deploy.sh` must:

```bash
set -euo pipefail
APP_ROOT=/volume1/docker/openstays-merchant
BACKUP_ROOT=/volume2/openstays-wallet-backups
test "$(id -un)" = "murdawk"
install -d -m 700 "$APP_ROOT/config" "$APP_ROOT/state" "$BACKUP_ROOT"
docker compose --project-name openstays-merchant \
  --env-file "$APP_ROOT/config/merchant.env" \
  -f "$APP_ROOT/source/ops/synology/docker-compose.yml" config --quiet
docker compose --project-name openstays-merchant \
  --env-file "$APP_ROOT/config/merchant.env" \
  -f "$APP_ROOT/source/ops/synology/docker-compose.yml" up -d --build
```

`recovery-drill.sh` must stop only `openstays-merchant`, quarantine the live
wallet directory, start the container, require a verified restore, compare the
redacted wallet identity/activity snapshot, and leave quarantine intact.

- [ ] **Step 4: Verify scripts**

Run:

```powershell
npm --prefix ops/cloudflare test -- synologyScripts.test.ts
bash -n ops/synology/deploy.sh
bash -n ops/synology/recovery-drill.sh
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- ops/synology/deploy.sh ops/synology/recovery-drill.sh ops/synology/README.md ops/cloudflare/tests/synologyScripts.test.ts
git commit -m "ops: add guarded Synology merchant deployment"
```

### Task 5: Eligibility-only Cloudflare deployment

**Files:**
- Create: `ops/cloudflare/wrangler.synology.jsonc`
- Modify: `ops/cloudflare/src/index.ts`
- Modify: `ops/cloudflare/tests/http.test.ts`

- [ ] **Step 1: Write failing eligibility-only tests**

Add tests proving:

- `/v1/eligibility` works without `MERCHANT_OPERATIONS`;
- `/healthz` returns `eligibility_ready` without claiming merchant health;
- operator wallet routes return `503 OPERATIONS_UNAVAILABLE`;
- forged origin, missing Turnstile, reused action, and invalid booking scope
  remain rejected.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npm --prefix ops/cloudflare test -- http.test.ts
```

Expected: FAIL because health currently reports `starting`.

- [ ] **Step 3: Implement eligibility-only mode**

Add an optional environment literal:

```ts
OPERATIONS_MODE?: 'cloudflare_container' | 'synology_external';
```

For `synology_external`, `/healthz` returns:

```json
{"release":"<release>","status":"eligibility_ready"}
```

The Worker must never proxy to Synology and must not accept a Synology origin
or token.

The new Wrangler configuration declares only:

- `PUBLIC_ORIGIN`;
- `RELEASE`;
- `OPERATIONS_MODE=synology_external`;
- `TURNSTILE_SECRET`;
- `ELIGIBILITY_HMAC_SECRET`;
- `OPERATIONS_ADMIN_TOKEN`.

It declares no R2, Durable Object, Container, or cron binding.

- [ ] **Step 4: Verify Worker**

Run:

```powershell
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npx --prefix ops/cloudflare wrangler deploy --config wrangler.synology.jsonc --dry-run
```

Expected: PASS and dry-run contains no container image build.

- [ ] **Step 5: Commit**

```powershell
git add -- ops/cloudflare/wrangler.synology.jsonc ops/cloudflare/src/index.ts ops/cloudflare/tests/http.test.ts
git commit -m "feat: add eligibility-only Cloudflare edge"
```

### Task 6: Full local verification and documentation

**Files:**
- Modify: `docs/operations/public-live-payments-runbook.md`
- Modify: `docs/public-live-payments.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document binding decisions**

Record:

- Synology is the merchant host for this showcase;
- SHC is not part of this deployment;
- `/volume2` verified generations are recovery authority;
- no browser or Worker can reach the NAS;
- Zaprite and Wavelength enable independently;
- the pasted Zaprite key must be replaced before enablement.

- [ ] **Step 2: Run every local gate**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run docs:build
npm run audit:runtime
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npm --prefix ops/cloudflare run build
git diff --check
```

Expected: all PASS.

- [ ] **Step 3: Push the implementation branch**

```powershell
git push -u origin codex/synology-live-merchant
```

Expected: branch created on `murdawkmedia/openstays`.

### Task 7: Deploy disabled Synology infrastructure

**Files on Synology:**
- `/volume1/docker/openstays-merchant/source`
- `/volume1/docker/openstays-merchant/config/merchant.env`
- `/volume1/docker/openstays-merchant/state`
- `/volume2/openstays-wallet-backups`

- [ ] **Step 1: Generate scoped secrets without displaying them**

Generate each value on the Synology or pass it through stdin into the
root-readable environment file. Never echo the file or values. Use distinct
values for every secret named in the design.

- [ ] **Step 2: Deploy with all rails disabled**

From the approved G14 hop:

```bash
cd /volume1/docker/openstays-merchant/source
bash ops/synology/deploy.sh
docker inspect openstays-merchant --format '{{json .NetworkSettings.Ports}}'
```

Expected: healthy or `awaiting_bootstrap`; ports output is `{}`.

- [ ] **Step 3: Bootstrap once**

Run:

```bash
docker exec -it openstays-merchant \
  node /app/synology/operator.mjs bootstrap
```

Write the 24 recovery words offline. Do not capture them in command output
files, chat, screenshots, or status notes. A second bootstrap must fail.

- [ ] **Step 4: Run forced recovery**

Run:

```bash
bash ops/synology/recovery-drill.sh
```

Expected: verified restore, same redacted wallet identity/activity, fresh
backup generation, quarantine preserved.

- [ ] **Step 5: Deploy eligibility-only Worker and Turnstile**

Use the dedicated Murdawk Media Cloudflare account. Create a dedicated
Turnstile widget for `https://openstays-consensus.pages.dev`, set only the
eligibility Worker secrets, deploy `wrangler.synology.jsonc`, and verify forged
origins and empty Turnstile tokens fail closed.

### Task 8: Configure and accept Zaprite

- [ ] **Step 1: Replace the exposed API key**

Create a fresh dedicated Zaprite API credential. Keep the Consensus Commons
custom checkout and CA$1 amount. Set the credential only in the dedicated
Convex deployment.

- [ ] **Step 2: Keep Zaprite hidden while testing**

Set `ZAPRITE_ENABLED=false` and build Pages with
`VITE_PUBLIC_ZAPRITE=false`.

- [ ] **Step 3: Run live acceptance**

Create one fictional booking, complete one CA$1 Zaprite payment, and verify:

- redirect/webhook content alone does not confirm;
- authoritative order fetch matches exact amount and currency;
- booking confirms once;
- receipt submission starts;
- manual refund case behavior remains correct.

- [ ] **Step 4: Enable Zaprite independently**

Set `ZAPRITE_ENABLED=true`, rebuild Pages with
`VITE_PUBLIC_ZAPRITE=true`, and smoke test desktop/mobile.

### Task 9: Configure and accept Wavelength

- [ ] **Step 1: Configure matching bridge tokens**

Set the Synology bridge/heartbeat values in the dedicated Convex deployment
without displaying them. Keep `WAVELENGTH_ENABLED=false`,
`WAVELENGTH_REWARDS_ENABLED=false`, and reward budget `0`.

- [ ] **Step 2: Fund the capped signet wallet**

Create a merchant receive request and fund only the approved capped test
budget. Require spendable balance rather than pending balance.

- [ ] **Step 3: Run booking and reward acceptance**

Verify:

- exact 1,000-sat signet booking payment;
- authoritative merchant receive reconciliation;
- confirmation and Consensus Receipt submission;
- exact 1,000-sat reward invoice;
- fee ceiling and merchant send preparation;
- completed outgoing activity before reward settlement;
- duplicate settlement no-op;
- stale heartbeat hides only Wavelength.

- [ ] **Step 4: Enable Wavelength and rewards**

Enable the booking rail first. Enable rewards last with the approved daily
budget. Rebuild Pages with `VITE_PUBLIC_WAVELENGTH=true`.

### Task 10: Final browser acceptance and status

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Run desktop and 390px browser acceptance**

Verify fictional disclosure, CA$1 Zaprite, 1,000-sat Wavelength, receipt and
proof downloads, reward claim, chat, refund request, staff operation, keyboard
focus, semantic statuses, and no horizontal overflow.

- [ ] **Step 2: Verify independent stop switches**

Disable and re-enable each rail separately. Confirm the simulated tour remains
available throughout.

- [ ] **Step 3: Update sanitized status**

Record only release IDs, URLs, enabled/disabled states, redacted health,
backup generation age, and test results. Do not record secrets, wallet words,
invoices, hashes, guest data, or payment identifiers.

- [ ] **Step 4: Commit and push final status**

```powershell
git add -- STATUS.md CLAUDE.md docs ops
git commit -m "docs: record Synology live merchant acceptance"
git push
```
