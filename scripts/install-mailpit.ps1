param([string]$DownloadPath)

$ErrorActionPreference = 'Stop'
$version = 'v1.30.5'
$expectedSha256 = 'e9663820476f6ac6bb642ac4d7c4e5c514ff42013137447b5163548d49fd8c88'
$releaseUrl = "https://github.com/axllent/mailpit/releases/download/$version/mailpit-windows-amd64.zip"
$installDir = Join-Path $env:LOCALAPPDATA "OpenStays\mailpit-$version"
$binary = Join-Path $installDir 'mailpit.exe'

if (Test-Path -LiteralPath $binary) {
  Write-Output "Mailpit $version is already installed at $binary"
  exit 0
}

$temporaryDir = Join-Path ([System.IO.Path]::GetTempPath()) ("openstays-mailpit-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDir | Out-Null
try {
  $archive = Join-Path $temporaryDir 'mailpit-windows-amd64.zip'
  if ($DownloadPath) {
    Copy-Item -LiteralPath $DownloadPath -Destination $archive
  } else {
    Invoke-WebRequest -Uri $releaseUrl -OutFile $archive
  }
  $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Mailpit archive SHA-256 mismatch; refusing installation."
  }
  $extractDir = Join-Path $temporaryDir 'extracted'
  Expand-Archive -LiteralPath $archive -DestinationPath $extractDir
  $extractedBinary = Join-Path $extractDir 'mailpit.exe'
  if (-not (Test-Path -LiteralPath $extractedBinary)) {
    throw 'Verified Mailpit archive did not contain mailpit.exe.'
  }
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Copy-Item -LiteralPath $extractedBinary -Destination $binary
  Write-Output "Installed verified Mailpit $version at $binary"
} finally {
  if (Test-Path -LiteralPath $temporaryDir) {
    Remove-Item -LiteralPath $temporaryDir -Recurse -Force
  }
}
