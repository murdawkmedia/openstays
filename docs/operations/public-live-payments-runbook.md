# Public live-payment operator runbook

This runbook is for the fictional Consensus Commons showcase. Commands that
create resources, use credentials, move test funds, push code, or deploy are
marked **REQUIRES FRESH OPERATOR APPROVAL**. Run them only against dedicated
OpenStays resources. Unrelated deployments, credentials, and customer data are
out of scope.

## 1. Binding deployment boundaries

- The approved merchant host is the Synology NAS. SHC is not used by this
  deployment.
- Live application state is under
  `/volume1/openstays-merchant/state`.
- Encrypted, verified wallet generations under
  `/volume2/openstays-wallet-backups` are the recovery authority.
- The Cloudflare Worker is eligibility-only. It has no Container, Durable
  Object, R2, NAS origin, or NAS credential.
- Neither the public browser nor the Worker can reach the NAS. They interact
  with Convex and the eligibility edge; the Synology merchant initiates its
  authenticated bridge calls to Convex.
- Zaprite and Wavelength have independent backend and frontend enable flags.
  One rail may remain disabled while the other and the simulated tour operate.
- Wavelength is signet-only. Never send mainnet bitcoin to this wallet.

The public property is fictional. A CA$1 Zaprite payment is a voluntary
contribution to OpenStays development, not payment for accommodation, and the
1,000-sat Wavelength flow and reward use signet test sats only.

## 2. Local release gates

From the repository root:

```powershell
npm ci
npm --prefix cli ci
npm --prefix ops/cloudflare ci
npm test
npm run typecheck
npm run build
npm run docs:build
npm run audit:runtime
npm audit --omit=dev --audit-level=high
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
npm --prefix cli audit --omit=dev --audit-level=high
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npm --prefix ops/cloudflare run build
git diff --check
```

For a Pages build with the browser wallet enabled, also verify the packaged
runtime:

```powershell
$env:VITE_PUBLIC_SHOWCASE = 'true'
$env:VITE_PUBLIC_WAVELENGTH = 'true'
npm run build
Test-Path dist/wavewalletdk/wavewalletdk.wasm
(Get-Item dist/wavewalletdk/wavewalletdk.wasm.gz).Length
```

The first command must report `False`; the compressed runtime must be below
Cloudflare Pages' 25 MiB per-file limit. After deployment, the fixed SDK URL
`/wavewalletdk/wavewalletdk.wasm` must return HTTP 200 with
`Content-Type: application/wasm`, `Content-Encoding: gzip`, and
`Cross-Origin-Resource-Policy: same-origin`.

Render the eligibility-only Worker without deploying it:

```powershell
npx --prefix ops/cloudflare wrangler deploy `
  --config ops/cloudflare/wrangler.synology.jsonc --dry-run
```

The dry run must contain no container image build. The checked-in Compose
contract has no published ports. The native Docker build, Compose rendering,
container identity/mount/port checks, restored-wallet health, and forced
recovery gate passed on the Synology for release
`ade31aaadaccb33f2e93978a15522e48180e8fb8` on 2026-07-28. Repeat that host
gate for any release that changes the merchant runtime or recovery path; a
local workstation without a compatible Docker engine cannot satisfy it.

## 3. Create the eligibility edge

**REQUIRES FRESH OPERATOR APPROVAL**

Create a dedicated Turnstile widget for the exact public Pages origin. Do not
reuse an unrelated widget.

Set only the eligibility Worker secrets interactively:

```powershell
Push-Location ops/cloudflare
$secretNames = @(
  'TURNSTILE_SECRET',
  'ELIGIBILITY_HMAC_SECRET',
  'OPERATIONS_ADMIN_TOKEN'
)
foreach ($name in $secretNames) {
  Write-Host "Setting $name"
  npx wrangler secret put $name --config wrangler.synology.jsonc
  if ($LASTEXITCODE -ne 0) { throw "Failed to set $name" }
}
Pop-Location
```

Use separate random values. Update `PUBLIC_ORIGIN` and `RELEASE` in a
deployment-specific configuration. Do not add Synology origins, bridge tokens,
R2 bindings, Container bindings, or account identifiers to the committed
configuration.

Deploy only after the disabled configuration and Turnstile rejection paths
pass:

```powershell
Push-Location ops/cloudflare
npx wrangler deploy --config wrangler.synology.jsonc
Pop-Location
```

`/healthz` reports `eligibility_ready`; it does not claim the Synology merchant
is healthy. Operator wallet routes remain unavailable in this mode.

## 4. Configure Convex with all rails disabled

**REQUIRES FRESH OPERATOR APPROVAL**

Use interactive secret entry or approved local secret pointers. The initial
non-secret state is:

```powershell
npx convex env set PUBLIC_LIVE_PAYMENTS true
npx convex env set PUBLIC_SIMULATED_PAYMENTS true
npx convex env set PUBLIC_ZAPRITE_CONTRIBUTION_CENTS 100
npx convex env set WAVELENGTH_PUBLIC_PAYMENT_SATS 1000
npx convex env set WAVELENGTH_REWARD_SATS 1000
npx convex env set WAVELENGTH_REWARD_MAX_FEE_SATS 210
npx convex env set WAVELENGTH_REWARD_DAILY_BUDGET_SATS 0
npx convex env set WAVELENGTH_NETWORK signet
npx convex env set ZAPRITE_ENABLED false
npx convex env set WAVELENGTH_ENABLED false
npx convex env set WAVELENGTH_REWARDS_ENABLED false
```

Set `ELIGIBILITY_HMAC_SECRET` and each bridge/heartbeat secret only in its
intended counterpart. Do not print values. The Zaprite API key previously
pasted into chat is exposed and must be replaced with a fresh, dedicated key
before Zaprite is enabled. Do not reuse the exposed value.

## 5. Prepare the disabled Synology merchant

**REQUIRES FRESH OPERATOR APPROVAL**

Follow the repository runbook at `ops/synology/README.md`. The fixed layout
is:

```text
/volume1/openstays-merchant/
  config/merchant.env
  source/
  state/
/volume2/openstays-wallet-backups/
```

The environment file must be mode `0600`, use distinct secrets, contain the
real `murdawk` UID/GID, and start with:

```dotenv
ZAPRITE_ENABLED=false
WAVELENGTH_ENABLED=false
WAVELENGTH_REWARDS_ENABLED=false
```

Run the digest-, size-, archive-, and commit-pinned manual DSM root task
documented in `ops/synology/README.md` with action `deploy`; never invoke the
published checkout directly. The guarded launcher and deploy script validate
the fixed roots, Compose identity, mounts, environment permissions, disabled
flags, empty published-port bindings, and post-start health. They never prune
Docker or target an unrelated container. Disable or remove the one-shot task
after its successful result is recorded.

Earlier live attempts exposed three fail-closed host/runtime edges now covered
by regressions: an absent `/usr/local/sbin`, root extraction permissions that
hid `/app` from runtime user `1026:100`, and backup staleness during a restored
wallet's bounded readiness window. The current task validates or safely
creates only the exact launcher directory, makes image source readable but
not writable, stages restore publication on the wallet filesystem, and
commits one fresh verified generation after an otherwise-ready restore.
Symlinks, owner/mode drift, corrupt or missing recovery, unexpected identity,
mounts, ports, or any other health failure remain hard failures.

For a later release, replace the complete DSM task body with the current
`ops/synology/README.md` block and use newly recorded literal commit, archive
size, and SHA-256 inputs. Do not manually create trusted paths or loosen
permissions. Any launcher, attestation, identity, or recovery error requires
inspection and a new operator decision rather than a blind retry.

## 6. Bootstrap and prove recovery

**REQUIRES FRESH OPERATOR APPROVAL**

Bootstrap exactly once through an authenticated **DSM Container Manager**
terminal opened inside the attested `openstays-merchant` container. Run
`node /app/synology/operator.mjs bootstrap` there.

Write the 24 words offline immediately. Do not redirect them, copy them into
task output, command logs, chat, screenshots, or status notes. The supervisor
returns them only after the initial encrypted generation is durably published
and reread. A second bootstrap must fail.

Create and inspect a redacted backup health result through the same
authenticated DSM Container Manager terminal by running
`node /app/synology/operator.mjs backup` and then
`node /app/synology/operator.mjs health`.

With all public rails still disabled, perform the forced recovery required
before Wavelength enablement by rerunning the documented one-shot DSM root
task with action `recovery` and the same literal commit, source-archive size,
source-archive SHA-256, launcher size, and launcher SHA-256 values.

The drill quarantines the live wallet, restores the newest verified
`/volume2` generation, compares a redacted wallet identity/activity
commitment, commits a fresh generation, and preserves the quarantine. Never
delete a generation or quarantine to make the drill pass.

The 2026-07-28 acceptance preserved
`wavelength-20260728T234223Z`, restored the signet wallet, and returned
redacted operator health `ready` at release
`ade31aaadaccb33f2e93978a15522e48180e8fb8`. This records recovery capability;
it does not authorize either public payment rail.

## 7. Fund a capped signet budget

**REQUIRES FRESH OPERATOR APPROVAL**

Fund only the approved signet amount. For twelve maximum demonstrations, the
recommended upper bound is:

```text
12 x (1,000-sat booking + 1,000-sat reward + 210-sat reward fee ceiling)
= 26,520 signet sats
```

Use the merchant daemon's amount-bearing deposit request, verify `signet`,
wait for funds to become spendable, and check the redacted Wavelength
heartbeat. Pending funds are not a usable budget.

## 8. Health and authoritative reconciliation

Public Wavelength closes after 60 seconds without a healthy heartbeat.
Operator diagnostics contain only service state, release, backup age, and
spendable signet balance.

Reconcile in this order:

1. **Zaprite:** fetch the pending order through the server-held API credential;
   confirm only exact amount, currency, and authoritative paid state.
2. **Wavelength booking:** match request, signet network, invoice, exact
   1,000-sat amount, merchant receive activity, and payment identifier.
3. **Reward:** verify the prepared send, fee ceiling, single-use intent, exact
   principal, and completed outgoing activity.
4. **OpenTimestamps receipt:** preserve the last valid proof; distinguish
   calendar submission from a verified Bitcoin block attestation.
5. **Mail:** retry the durable queue without changing its idempotency key.
6. **Refunds:** complete the external transfer first, then record its external
   reference in Staff Operations.

Never repair state by editing authoritative payment, reward, receipt, refund,
or backup records directly.

## 9. Optional OpenTimestamps backup-manifest audit

The atomic generation store and its SHA-256 verification are the wallet-safety
authority. As an optional audit layer, an operator may timestamp a sanitized
manifest commitment to prove that it existed by a particular time.

The stamped document must contain no archive bytes, secret values, recovery
words, wallet identifiers, balances, activity, guest data, invoices, payment
hashes, host addresses, or filesystem paths. Timestamping must never upload the
encrypted backup itself. A submitted calendar proof is not yet Bitcoin
anchoring, and anchoring is never a prerequisite for restore, startup,
reconciliation, or payment availability.

## 10. Independent stop switches

**REQUIRES FRESH OPERATOR APPROVAL**

```powershell
# Zaprite only
npx convex env set ZAPRITE_ENABLED false

# Wavelength booking only
npx convex env set WAVELENGTH_ENABLED false

# Rewards only; zero the budget as well
npx convex env set WAVELENGTH_REWARDS_ENABLED false
npx convex env set WAVELENGTH_REWARD_DAILY_BUDGET_SATS 0
```

Rebuild Pages with the corresponding `VITE_PUBLIC_*` flag set to `false`.
Stopping Wavelength must not stop Zaprite or the simulated tour.

## 11. Secret rotation

**REQUIRES FRESH OPERATOR APPROVAL**

Rotate one scoped secret at a time:

1. disable the affected rail;
2. drain or release in-flight leases;
3. update the provider or edge side;
4. update the matching Convex or Synology side;
5. restart the merchant from a verified generation;
6. require fresh heartbeats and one non-money smoke test;
7. re-enable only that rail.

Rotate `WALLET_BACKUP_KEY_BASE64` only through a planned decrypt/re-encrypt
migration that verifies a new generation before changing the pointer. Never
discard the prior key or generation until a forced restore passes.

## 12. Rollback and enablement

**REQUIRES FRESH OPERATOR APPROVAL**

Rollback:

1. set all three enable flags to `false` and reward budget to `0`;
2. hide both live buttons in the Pages build;
3. preserve Convex payment, refund, receipt, reward, message, and audit rows;
4. preserve every verified `/volume2` generation and wallet quarantine;
5. deploy the last verified eligibility Worker and Synology source release;
6. restore from a verified generation and reconcile in-flight provider state.

Only after separate Zaprite and Wavelength acceptance passes may each rail be
enabled. Zaprite acceptance requires a fresh API key and one exact CA$1
authoritative reconciliation; it does not depend on the signet-wallet recovery
drill. Wavelength acceptance requires the forced restore, spendable signet
balance, one exact booking payment, one exact reward, and replay-safe completed
activity. Enable the Wavelength booking rail before rewards, and keep the daily
reward budget capped.

Record only release identifiers, public URLs, enabled/disabled states, redacted
health, backup age, and test results. Never record secrets, recovery material,
invoices, payment identifiers, guest data, raw host addresses, or backup bytes.
