param([switch]$Once)

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.local is required.' }
$siteLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^VITE_CONVEX_SITE_URL=' } | Select-Object -First 1
if (-not $siteLine) { throw 'VITE_CONVEX_SITE_URL is missing from .env.local.' }
$openStaysUrl = ($siteLine -replace '^VITE_CONVEX_SITE_URL=', '').Trim()

Push-Location (Join-Path $PSScriptRoot '..')
try {
  $bridgeToken = (& npx convex env get MAIL_BRIDGE_TOKEN 2>$null | Out-String).Trim()
} finally {
  Pop-Location
}
if (-not $bridgeToken) { throw 'MAIL_BRIDGE_TOKEN is not configured on the selected Convex deployment.' }

$env:OPENSTAYS_URL = $openStaysUrl
$env:MAIL_BRIDGE_TOKEN = $bridgeToken
$env:SMTP_HOST = '127.0.0.1'
$env:SMTP_PORT = '1025'
$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\mail-bridge'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$arguments = @('--prefix', 'cli', 'start', '--', 'mail-bridge')
if ($Once) { $arguments += '--once' }
$process = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList $arguments `
  -WorkingDirectory (Join-Path $PSScriptRoot '..') `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runtimeDir 'mail-bridge.stdout.log') `
  -RedirectStandardError (Join-Path $runtimeDir 'mail-bridge.stderr.log') `
  -PassThru
Write-Output "Started OpenStays Mail bridge (PID $($process.Id))."
