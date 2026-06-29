$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$installerPath = Join-Path $projectRoot "release\Holoshelf-Setup-$version.exe"
$installPath = Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\Holoshelf.exe"

if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Installer not found: $installerPath"
}

$running = Get-Process -Name "Holoshelf" -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Seconds 1
}

Start-Process -FilePath $installerPath -ArgumentList "/S", "/currentuser" -Wait

if (-not (Test-Path -LiteralPath $installPath)) {
  throw "Installed executable not found after install: $installPath"
}

$installed = Get-Item -LiteralPath $installPath
$installedVersion = [string]$installed.VersionInfo.ProductVersion
if (-not $installedVersion.StartsWith($version)) {
  throw "Installed Holoshelf version is $installedVersion, expected $version.x"
}

Write-Host "Installed Holoshelf $installedVersion at $installPath"
