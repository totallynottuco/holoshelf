$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$installPath = Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\Holoshelf.exe"
if (-not (Test-Path -LiteralPath $installPath)) {
  throw "Holoshelf is not installed. Choose the full app update in the wizard first."
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "dist-electron\electron\services\installedSeedUpdate.js"))) {
  throw "Compiled updater is missing. Run npm run build:electron first."
}
& node (Join-Path $PSScriptRoot "audit-release-safety.mjs")
if ($LASTEXITCODE -ne 0) { throw "Release seed audit failed." }
& (Join-Path $PSScriptRoot "stop-installed-app.ps1")
Write-Host "Applying the refreshed seed and verifying the AppData merge..."
& node (Join-Path $PSScriptRoot "apply-installed-seed.mjs") "--installed-exe=$installPath"
if ($LASTEXITCODE -ne 0) { throw "Installed data update failed with exit code $LASTEXITCODE." }
