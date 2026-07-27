# Public live-payment operator runbook

This runbook is for the fictional Consensus Commons showcase. Commands that
create resources, use credentials, move test funds, push code, or deploy are
marked **REQUIRES FRESH OPERATOR APPROVAL**. Run them only against the
dedicated OpenStays resources. Unrelated deployments and credentials are out
of scope.

## 1. Local release gates

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

The Cloudflare build is a dry run and does not roll out a container.

Build the pinned Linux image from the repository root:

```powershell
docker build --pull --no-cache `
  --file ops/cloudflare/container/Dockerfile `
  --tag openstays-merchant-operations:release-candidate .
docker scout cves --exit-code --only-severity critical,high `
  openstays-merchant-operations:release-candidate
```

Do not deploy if the image was not built or the scanner reports a
critical/high runtime finding.

## 2. Create dedicated Cloudflare resources

**REQUIRES FRESH OPERATOR APPROVAL**

```powershell
Push-Location ops/cloudflare
npx wrangler login
npx wrangler r2 bucket create openstays-wallet-backups
npx wrangler r2 bucket info openstays-wallet-backups
Pop-Location
```

Create a dedicated Turnstile widget for the exact public origin in the
Cloudflare dashboard. Do not reuse an unrelated widget or R2 bucket.

Set every required Worker secret interactively so no value appears in shell
history:

```powershell
Push-Location ops/cloudflare
$secretNames = @(
  'TURNSTILE_SECRET',
  'ELIGIBILITY_HMAC_SECRET',
  'OPERATIONS_ADMIN_TOKEN',
  'CONTAINER_CONTROL_TOKEN',
  'WALLET_BACKUP_KEY_BASE64',
  'WAVELENGTH_WALLET_PASSWORD',
  'WAVELENGTH_BRIDGE_TOKEN',
  'WAVELENGTH_HEARTBEAT_TOKEN',
  'OTS_BRIDGE_TOKEN',
  'OTS_HEARTBEAT_TOKEN',
  'MAIL_BRIDGE_TOKEN',
  'MAIL_HEARTBEAT_TOKEN',
  'BACKUP_HEARTBEAT_TOKEN'
)
foreach ($name in $secretNames) {
  Write-Host "Setting $name"
  npx wrangler secret put $name
  if ($LASTEXITCODE -ne 0) { throw "Failed to set $name" }
}
Pop-Location
```

Use separate random values for every scoped token. Configure optional SMTP
settings the same way. Update `PUBLIC_ORIGIN`, `RELEASE`, `OPENSTAYS_URL`, and
the R2 bucket name in a deployment-specific Wrangler configuration; do not
commit account identifiers.

## 3. Configure Convex with all rails disabled

**REQUIRES FRESH OPERATOR APPROVAL**

Use interactive provider secret entry or approved local secret pointers. The
initial non-secret state is:

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

Set `ELIGIBILITY_HMAC_SECRET` and each bridge/heartbeat secret in Convex to its
matching Worker value without printing either value. Configure the dedicated
Zaprite checkout only; do not reuse another project's checkout.

## 4. Deploy disabled infrastructure

**REQUIRES FRESH OPERATOR APPROVAL**

```powershell
npx convex deploy
Push-Location ops/cloudflare
npx wrangler deploy --containers-rollout=immediate
Pop-Location
```

Build Pages with the live buttons still hidden:

```powershell
$env:VITE_PUBLIC_SHOWCASE='true'
$env:VITE_PUBLIC_ZAPRITE='false'
$env:VITE_PUBLIC_WAVELENGTH='false'
$env:VITE_PUBLIC_SIMULATED='true'
npm run build
npx wrangler@4.114.0 pages deploy dist --project-name openstays-consensus
```

Confirm the fictional/no-service disclosure, simulated flow, and
`/healthz` before bootstrapping the wallet.

## 5. Bootstrap the signet merchant wallet once

**REQUIRES FRESH OPERATOR APPROVAL**

The Worker accepts this command only with the operator bearer credential. The
daemon creates a fresh 24-word recovery phrase, the container immediately
encrypts and commits the first wallet archive to private R2, and the phrase is
returned once over the authenticated response.

```powershell
$edgeOrigin = 'https://openstays-merchant-operations.example.workers.dev'
$operatorCredential = Read-Host 'Operations credential' -AsSecureString
$operatorPointer = [System.Net.NetworkCredential]::new('', $operatorCredential)
$headers = @{ Authorization = "Bearer $($operatorPointer.Password)" }
$created = Invoke-RestMethod `
  -Method Post `
  -Uri "$edgeOrigin/v1/operator/bootstrap-wallet" `
  -Headers $headers
$created.mnemonic -join ' '
```

Write the phrase down offline immediately, clear the terminal, remove the
PowerShell variables, and never place the phrase in a file, screenshot,
status report, issue, or chat. A second bootstrap must return a conflict.

```powershell
Remove-Variable created
Clear-Host
```

## 6. Verify backup and forced restore

**REQUIRES FRESH OPERATOR APPROVAL**

Use redacted diagnostics:

```powershell
$diagnostics = Invoke-RestMethod `
  -Method Get `
  -Uri "$edgeOrigin/v1/operator/diagnostics" `
  -Headers $headers
$diagnostics | ConvertTo-Json -Depth 5
```

Require `merchant.status = ready` and a backup age below two minutes. Then
force the container to stop and restore from the newest verified R2 archive:

```powershell
$restored = Invoke-RestMethod `
  -Method Post `
  -Uri "$edgeOrigin/v1/operator/restart-from-backup" `
  -Headers $headers
$restored | ConvertTo-Json
```

Require `status = ready`, the same wallet balance/activity, and no duplicate
booking or reward settlement. Copy and corrupt an archive only in an isolated
test bucket; prove that digest verification leaves health unavailable. Never
alter the current production archive or manifest.

```powershell
Remove-Variable operatorPointer,operatorCredential,headers
```

## 7. Fund a capped signet budget

**REQUIRES FRESH OPERATOR APPROVAL**

Fund only the approved signet amount. For twelve maximum demonstrations, the
recommended upper bound is:

```text
12 × (1,000-sat booking + 1,000-sat reward + 210-sat reward fee ceiling)
= 26,520 signet sats
```

Use the merchant daemon's amount-bearing deposit request, verify `signet`,
wait for funds to become spendable, and check the redacted Wavelength
heartbeat. Pending funds are not a usable budget. Never fund this wallet with
mainnet bitcoin.

## 8. Health and reconciliation

Public Wavelength closes after 60 seconds without a healthy heartbeat.
Operator diagnostics contain only service state, release, backup age, and
spendable signet balance.

Reconcile in this order:

1. **Zaprite:** fetch the pending order through the server-held API credential;
   confirm only exact amount/currency and authoritative paid state.
2. **Wavelength booking:** match request, signet network, invoice, exact
   1,000-sat amount, merchant receive activity, and payment identifier.
3. **Reward:** verify the prepared send, fee ceiling, single-use intent, exact
   principal, and completed outgoing activity.
4. **OpenTimestamps:** preserve the last valid proof; distinguish calendar
   submission from a verified Bitcoin block attestation.
5. **Mail:** retry the durable queue without changing its idempotency key.
6. **Refunds:** complete the external transfer first, then record its external
   reference in Staff Operations.

Never repair state by editing authoritative payment, reward, receipt, or refund
rows directly.

## 9. Independent stop switches

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

## 10. Secret rotation

**REQUIRES FRESH OPERATOR APPROVAL**

Rotate one scoped secret at a time:

1. disable the affected rail;
2. drain or release in-flight leases;
3. update the provider/Worker side;
4. update the matching Convex side;
5. restart the container from its verified backup;
6. require fresh heartbeats and one non-money smoke test;
7. re-enable only that rail.

Rotate `WALLET_BACKUP_KEY_BASE64` only through a planned decrypt/re-encrypt
migration that verifies a new archive before changing the pointer. Never
discard the prior key or archive until a forced restore passes.

## 11. Rollback

**REQUIRES FRESH OPERATOR APPROVAL**

1. Set all three enable flags to `false` and reward budget to `0`.
2. Hide both live buttons in the Pages build.
3. Preserve Convex payment, refund, receipt, reward, message, and audit rows.
4. Preserve all verified R2 generations and the current manifest.
5. Deploy the last verified Worker/container release with an immediate
   rollout.
6. Restart from the verified archive and reconcile any in-flight provider
   state.

Rollback never runs demo reset against real-payment rows and never deletes a
provider order, wallet, archive, or authoritative ledger.

## 12. Enable after live acceptance

**REQUIRES FRESH OPERATOR APPROVAL**

Only after Zaprite, Wavelength booking, receipt submission, reward payment,
manual refund, mail, desktop/mobile, and forced-restore acceptance pass:

```powershell
npx convex env set ZAPRITE_ENABLED true
npx convex env set WAVELENGTH_ENABLED true
npx convex env set WAVELENGTH_REWARDS_ENABLED true
npx convex env set WAVELENGTH_REWARD_DAILY_BUDGET_SATS 12000
```

Rebuild Pages with `VITE_PUBLIC_ZAPRITE=true` and
`VITE_PUBLIC_WAVELENGTH=true`. Record only release identifiers and redacted
health—not secrets, recovery material, invoices, payment identifiers, guest
data, or raw network addresses.
