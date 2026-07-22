$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install-mailpit.ps1'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Mailpit installer is missing.' }

$source = Get-Content -Raw -LiteralPath $installer
foreach ($required in @(
  'v1.30.5',
  'https://github.com/axllent/mailpit/releases/download/',
  'e9663820476f6ac6bb642ac4d7c4e5c514ff42013137447b5163548d49fd8c88',
  'Get-FileHash',
  'SHA256',
  'refusing installation'
)) {
  if ($source -notmatch [regex]::Escape($required)) { throw "Missing installer guard: $required" }
}

Write-Output 'Mailpit installer contract passed.'
