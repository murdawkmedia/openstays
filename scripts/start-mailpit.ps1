$ErrorActionPreference = 'Stop'
$version = 'v1.30.5'
$binary = Join-Path $env:LOCALAPPDATA "OpenStays\mailpit-$version\mailpit.exe"
if (-not (Test-Path -LiteralPath $binary)) {
  throw 'Mailpit is not installed. Run npm run mailpit:install first.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 1025,8025 -ErrorAction SilentlyContinue) {
  throw 'Mailpit ports 1025 or 8025 are already in use.'
}

$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\mailpit'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$database = Join-Path $runtimeDir 'mailpit.db'
$stdout = Join-Path $runtimeDir 'mailpit.stdout.log'
$stderr = Join-Path $runtimeDir 'mailpit.stderr.log'
$process = Start-Process -FilePath $binary `
  -ArgumentList @('--smtp', '127.0.0.1:1025', '--listen', '127.0.0.1:8025', '--database', $database) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started Mailpit (PID $($process.Id)); inbox=http://127.0.0.1:8025"
