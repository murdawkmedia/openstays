param([switch]$AcknowledgeRealSats)

$ErrorActionPreference = 'Stop'
if (-not $AcknowledgeRealSats) {
  throw 'Explicit acknowledgement required for real sats.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Missing .env.local. Run npx convex dev --once first.'
}

$settings = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $settings[$matches[1]] = ($matches[2] -replace '\s+#.*$', '').Trim().Trim('"').Trim("'")
  }
}

$env:CONVEX_DEPLOYMENT = $settings.CONVEX_DEPLOYMENT
$ack = (& npx convex env get WAVELENGTH_MAINNET_ACK 2>$null | Out-String).Trim()
if ($ack -ne 'I_UNDERSTAND_REAL_SATS') {
  throw 'Convex mainnet acknowledgement is not configured.'
}
$bridgeToken = (& npx convex env get WAVELENGTH_MAINNET_BRIDGE_TOKEN 2>$null | Out-String).Trim()
if (-not $bridgeToken) {
  throw 'WAVELENGTH_MAINNET_BRIDGE_TOKEN is not configured.'
}

$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\wavelength-mainnet'
$macaroonPath = Join-Path $runtimeDir 'data\mainnet\admin.macaroon'
if (-not (Test-Path -LiteralPath $macaroonPath)) {
  throw 'Mainnet daemon macaroon does not exist; start and verify the daemon first.'
}

$env:OPENSTAYS_URL = $settings.VITE_CONVEX_SITE_URL
$env:WAVELENGTH_BRIDGE_TOKEN = $bridgeToken
$env:WAVELENGTH_DAEMON_URL = 'http://127.0.0.1:11031'
$env:WAVELENGTH_DAEMON_MACAROON_PATH = $macaroonPath
$env:WAVELENGTH_EXPECTED_NETWORK = 'mainnet'
$env:WAVELENGTH_BRIDGE_POLL_MS = '2000'

$stdout = Join-Path $runtimeDir 'openstays-mainnet-bridge.stdout.log'
$stderr = Join-Path $runtimeDir 'openstays-mainnet-bridge.stderr.log'
$npm = (Get-Command npm.cmd).Source
$process = Start-Process -FilePath $npm `
  -ArgumentList @('run', 'start', '--', 'wave-bridge') `
  -WorkingDirectory (Join-Path $repoRoot 'cli') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started guarded OpenStays mainnet bridge (PID $($process.Id)); secrets were not printed."
