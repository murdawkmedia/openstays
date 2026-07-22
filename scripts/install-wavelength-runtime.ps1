$ErrorActionPreference = 'Stop'

$version = 'v0.1.0'
$expectedSha256 = '1fc57d2fdbeae25de2b60e5ad1fe9322b9da8f7270fc2b450dc621dc8428c398'
$archiveUrl = "https://github.com/lightninglabs/wavelength/releases/download/$version/Wavewalletdk.wasm.tar.gz"
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot 'public\wavewalletdk'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "openstays-wavewalletdk-$version.tar.gz"

New-Item -ItemType Directory -Force -Path $target | Out-Null
Invoke-WebRequest -Uri $archiveUrl -OutFile $archive
$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "Wavelength runtime hash mismatch: expected $expectedSha256, got $actualSha256"
}

tar -xzf $archive -C $target --exclude='._*'
Remove-Item -LiteralPath $archive
Write-Output "Installed Wavelength $version runtime assets in $target"
