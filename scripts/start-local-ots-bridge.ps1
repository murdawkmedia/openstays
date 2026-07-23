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
$bridgeToken = (& npx convex env get OTS_BRIDGE_TOKEN 2>$null | Out-String).Trim()
if (-not $bridgeToken) {
  throw 'OTS_BRIDGE_TOKEN is not configured on this Convex deployment.'
}

$env:OPENSTAYS_URL = $settings.VITE_CONVEX_SITE_URL
$env:OTS_BRIDGE_TOKEN = $bridgeToken
$env:OTS_WSL = 'true'
$env:OTS_WSL_PYTHONPATH = '/root/.local/share/openstays/ots-bridge-python'

$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\ots-bridge'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$stdout = Join-Path $runtimeDir 'ots-bridge.stdout.log'
$stderr = Join-Path $runtimeDir 'ots-bridge.stderr.log'
$npm = (Get-Command npm.cmd).Source
$process = Start-Process -FilePath $npm `
  -ArgumentList @('run', 'start', '--', 'ots-bridge') `
  -WorkingDirectory (Join-Path $repoRoot 'cli') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started OpenStays OpenTimestamps bridge (PID $($process.Id)); token remained in process environment."
