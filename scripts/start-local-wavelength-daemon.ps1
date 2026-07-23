$ErrorActionPreference = 'Stop'

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'OpenStays'
$runtimeDir = Join-Path $runtimeRoot 'wavelength-signet'
$daemon = Join-Path $runtimeRoot 'wavelength-wallet-rpc-v0.1.0\waved.exe'
$passwordFile = Join-Path $runtimeDir 'merchant-wallet.password'
$logDir = Join-Path $runtimeDir 'logs'

foreach ($requiredPath in @($daemon, $passwordFile)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Missing Wavelength runtime prerequisite: $requiredPath"
  }
}

$existing = Get-NetTCPConnection -State Listen -LocalPort 10031 -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Wavelength merchant daemon already listening on 127.0.0.1:10031 (PID $($existing.OwningProcess))."
  exit 0
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $runtimeDir 'waved-judge.stdout.log'
$stderr = Join-Path $runtimeDir 'waved-judge.stderr.log'
$arguments = @(
  '--network=signet'
  "--datadir=$runtimeDir"
  "--logdir=$logDir"
  "--wallet.password_file=$passwordFile"
  '--wallet.esploraurl=https://mempool.space/signet/api'
  '--rpc.listenaddr=127.0.0.1:10029'
  '--rpc.gateway.listenaddr=127.0.0.1:10031'
  '--rpc.notls'
  '--rpc.gateway.allowedorigins=http://127.0.0.1:4173'
)

$process = Start-Process `
  -FilePath $daemon `
  -ArgumentList $arguments `
  -WorkingDirectory $runtimeDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started Wavelength merchant daemon (PID $($process.Id)) on signet."
