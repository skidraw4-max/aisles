#Requires -Version 5.1
<#
.SYNOPSIS
  Build a signed Play Store release AAB for AIsle (com.aisleshub.app).

.DESCRIPTION
  Sets JAVA_HOME to Android Studio JBR, verifies local signing files, runs
  gradlew bundleRelease, and prints the output AAB path.

  Prerequisites (local only, never commit):
    mobile/android/upload-keystore.jks
    mobile/android/keystore.properties  (copy from keystore.properties.example)

.EXAMPLE
  powershell -File mobile/scripts/build-release-aab.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\\..')
$AndroidDir = Join-Path $RepoRoot 'mobile\\android'
$KeystoreProps = Join-Path $AndroidDir 'keystore.properties'
$ExampleProps = Join-Path $AndroidDir 'keystore.properties.example'
$AabPath = Join-Path $AndroidDir 'app\\build\\outputs\\bundle\\release\\app-release.aab'

function Find-AndroidStudioJbr {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} 'Android\\Android Studio\\jbr'),
    (Join-Path ${env:LOCALAPPDATA} 'Programs\\Android\\Android Studio\\jbr'),
    (Join-Path ${env:ProgramFiles} 'Android\\Android Studio\\jre')
  )
  foreach ($p in $candidates) {
    if (Test-Path (Join-Path $p 'bin\\java.exe')) { return $p }
  }
  return $null
}

if (-not (Test-Path $KeystoreProps)) {
  Write-Host 'ERROR: mobile/android/keystore.properties not found.' -ForegroundColor Red
  Write-Host ''
  Write-Host '1) Generate upload key (interactive — you choose passwords):'
  Write-Host '   cd mobile\\android'
  Write-Host '   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload'
  Write-Host ''
  Write-Host "2) Copy example and fill secrets:"
  Write-Host "   copy keystore.properties.example keystore.properties"
  Write-Host ''
  Write-Host "See docs/mobile-play-release.md for Play Console upload steps."
  exit 1
}

$jbr = Find-AndroidStudioJbr
if (-not $jbr) {
  Write-Host 'ERROR: Android Studio JBR not found. Install Android Studio or set JAVA_HOME manually.' -ForegroundColor Red
  exit 1
}
$env:JAVA_HOME = $jbr
Write-Host "JAVA_HOME=$env:JAVA_HOME"

Push-Location $AndroidDir
try {
  & .\\gradlew.bat bundleRelease
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

if (-not (Test-Path $AabPath)) {
  Write-Host "ERROR: Expected AAB not found at $AabPath" -ForegroundColor Red
  exit 1
}

$full = (Resolve-Path $AabPath).Path
$sizeMb = [math]::Round((Get-Item $full).Length / 1MB, 2)
Write-Host ''
Write-Host 'Release AAB built successfully:' -ForegroundColor Green
Write-Host $full
Write-Host "Size: ${sizeMb} MB"
