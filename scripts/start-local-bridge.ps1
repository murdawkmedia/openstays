$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Missing .env.local. Run npx convex dev --once first.'
}

$settings = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $value = ($matches[2] -replace '\s+#.*$', '').Trim().Trim('"').Trim("'")
    $settings[$matches[1]] = $value
  }
}

$env:CONVEX_DEPLOYMENT = $settings.CONVEX_DEPLOYMENT
$bridgeToken = (& npx convex env get WAVELENGTH_BRIDGE_TOKEN 2>$null | Out-String).Trim()
if (-not $bridgeToken) {
  throw 'WAVELENGTH_BRIDGE_TOKEN is not configured on this Convex deployment.'
}

$env:OPENSTAYS_URL = $settings.VITE_CONVEX_SITE_URL
$env:WAVELENGTH_BRIDGE_TOKEN = $bridgeToken
$env:WAVELENGTH_DAEMON_URL = 'http://127.0.0.1:10031'
$env:WAVELENGTH_BRIDGE_POLL_MS = '2000'

$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\wavelength-signet'
$daemonMacaroon = Join-Path $runtimeDir 'data\signet\admin.macaroon'
if (-not (Test-Path -LiteralPath $daemonMacaroon)) {
  throw 'Missing Wavelength admin macaroon. Start the local signet daemon first.'
}
$env:WAVELENGTH_DAEMON_MACAROON_PATH = $daemonMacaroon
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$stdout = Join-Path $runtimeDir 'openstays-bridge.stdout.log'
$stderr = Join-Path $runtimeDir 'openstays-bridge.stderr.log'
$npm = (Get-Command npm.cmd).Source
$process = Start-Process -FilePath $npm `
  -ArgumentList @('run', 'start', '--', 'wave-bridge') `
  -WorkingDirectory (Join-Path $repoRoot 'cli') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started OpenStays Wavelength bridge (PID $($process.Id)); token remained in process environment."
