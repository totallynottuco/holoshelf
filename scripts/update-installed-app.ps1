param(
  [switch]$Yes,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot

function Show-Help {
  Write-Host "Holoshelf installed app updater"
  Write-Host ""
  Write-Host "This bumps the patch version, builds the production Windows installer,"
  Write-Host "installs it over the current per-user Holoshelf install, and verifies"
  Write-Host "the installed executable version."
  Write-Host ""
  Write-Host "Double-click Update Installed App.cmd from the project root, or run:"
  Write-Host "  npm run release:update:installed"
}

if ($Help) {
  Show-Help
  exit 0
}

function Read-YesNo {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [bool]$DefaultYes = $true
  )

  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  while ($true) {
    $answer = (Read-Host "$Prompt $suffix").Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($answer)) {
      return $DefaultYes
    }
    if ($answer -eq "y" -or $answer -eq "yes") {
      return $true
    }
    if ($answer -eq "n" -or $answer -eq "no") {
      return $false
    }
    Write-Host "Please answer y or n."
  }
}

function Invoke-Npm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  Write-Host ""
  Write-Host "> npm $($Arguments -join ' ')"
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Read-PackageVersion {
  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  return [string]$packageJson.version
}

Write-Host ""
Write-Host "Holoshelf installed app updater"
Write-Host "This installs the current project code as a new local production build."
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found on PATH. Install Node.js/npm or run this from a shell where npm works."
}

Set-Location $projectRoot

$oldVersion = Read-PackageVersion
Write-Host "Current project version: $oldVersion"
Write-Host "Installed target: $env:LOCALAPPDATA\Programs\Holoshelf\Holoshelf.exe"
Write-Host ""
Write-Host "This will:"
Write-Host "  1. Bump package.json to the next patch version."
Write-Host "  2. Build the real unsigned Windows installer."
Write-Host "  3. Close Holoshelf if it is running."
Write-Host "  4. Install the new build over your current per-user install."
Write-Host "  5. Verify the installed executable version."

if (-not $Yes -and -not (Read-YesNo "Start the local installed-app update now?" $true)) {
  Write-Host "Cancelled."
  exit 0
}

Invoke-Npm @("run", "release:bump:patch")
$newVersion = Read-PackageVersion

Write-Host ""
Write-Host "Version bumped: $oldVersion -> $newVersion"
Invoke-Npm @("run", "release:install:local")

Write-Host ""
Write-Host "Done. Holoshelf $newVersion is installed locally."
Write-Host "Use this updater again whenever you want the installed app to pick up the latest project code."
