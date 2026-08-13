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
  foreach ($process in $running) {
    if ($process.MainWindowHandle -ne 0) {
      [void]$process.CloseMainWindow()
    }
  }

  $closeDeadline = (Get-Date).AddSeconds(5)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = Get-Process -Name "Holoshelf" -ErrorAction SilentlyContinue
  } while ($remaining -and (Get-Date) -lt $closeDeadline)

  if ($remaining) {
    $remaining | Stop-Process -Force
    Start-Sleep -Milliseconds 500
  }
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

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node was not found on PATH, so the installed data merge could not be verified."
}

Write-Host "Launching Holoshelf and verifying the installed release data merge..."
& node (Join-Path $projectRoot "scripts\verify-installed-data-merge.mjs") "--installed-exe=$installPath"
if ($LASTEXITCODE -ne 0) {
  throw "Installed release-data verification failed with exit code $LASTEXITCODE."
}
