param([switch]$AcknowledgeRealSats)

$ErrorActionPreference = 'Stop'
if (-not $AcknowledgeRealSats) {
  throw 'Explicit acknowledgement required for real sats.'
}

$operatorHost = $env:WAVELENGTH_MAINNET_OPERATOR_HOST
$swapHost = $env:WAVELENGTH_MAINNET_SWAP_HOST
if (-not $operatorHost -or -not $swapHost) {
  throw 'Lightning Labs endpoint review is required: set WAVELENGTH_MAINNET_OPERATOR_HOST and WAVELENGTH_MAINNET_SWAP_HOST.'
}

$binary = Join-Path $env:LOCALAPPDATA 'OpenStays\wavelength-wallet-rpc-v0.1.0\waved.exe'
if (-not (Test-Path -LiteralPath $binary)) {
  throw "Wallet-RPC Wavelength binary not found at $binary"
}

$runtimeDir = Join-Path $env:LOCALAPPDATA 'OpenStays\wavelength-mainnet'
$passwordFile = Join-Path $runtimeDir 'merchant-wallet.password'
if (-not (Test-Path -LiteralPath $passwordFile)) {
  throw "Create a new ACL-protected mainnet wallet password file at $passwordFile before startup."
}

$acl = Get-Acl -LiteralPath $passwordFile
if (-not $acl.AreAccessRulesProtected) {
  throw 'Mainnet wallet password ACL must have inheritance disabled.'
}

$dataDir = Join-Path $runtimeDir 'data\mainnet'
$stdout = Join-Path $runtimeDir 'waved.stdout.log'
$stderr = Join-Path $runtimeDir 'waved.stderr.log'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$daemonArgs = @(
  '--network=mainnet',
  '--allow-mainnet',
  "--datadir=$runtimeDir",
  "--wallet.password_file=$passwordFile",
  "--server.host=$operatorHost",
  "--swap.serveraddress=$swapHost",
  '--rpc.listenaddr=127.0.0.1:11029',
  '--rpc.gateway.enabled=true',
  '--rpc.gateway.listenaddr=127.0.0.1:11031',
  '--debuglevel=info'
)

if (Get-NetTCPConnection -State Listen -LocalPort 11029,11031 -ErrorAction SilentlyContinue) {
  throw 'Mainnet Wavelength ports 11029/11031 are already in use.'
}

$process = Start-Process -FilePath $binary `
  -ArgumentList $daemonArgs `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Write-Output "Started guarded Wavelength mainnet daemon (PID $($process.Id)); data=$dataDir"
Write-Output 'No wallet, invoice, or payment was created by this startup script.'
