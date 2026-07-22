$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'start-wavelength-mainnet.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw 'start-wavelength-mainnet.ps1 does not exist.'
}

$ErrorActionPreference = 'Continue'
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1 | Out-String
$childExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($childExitCode -eq 0 -or $output -notmatch 'Explicit acknowledgement required') {
  throw 'Startup did not fail closed without acknowledgement.'
}

$source = Get-Content -Raw -LiteralPath $scriptPath
foreach ($required in @('--allow-mainnet', '127.0.0.1', 'wavelength-mainnet', 'rpc.gateway.listenaddr')) {
  if ($source -notmatch [regex]::Escape($required)) { throw "Missing required guard: $required" }
}
if ($source -match [regex]::Escape('--allow-insecure-mainnet')) {
  throw 'Insecure mainnet override must never be present.'
}

Write-Output 'Wavelength mainnet startup contract passed.'
