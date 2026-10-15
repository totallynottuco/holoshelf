param(
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot

function Show-Help {
  Write-Host "Holoshelf release data updater"
  Write-Host ""
  Write-Host "This wizard prompts for API keys, refreshes the release source database,"
  Write-Host "regenerates resources\seed, and can apply data directly to your installed app."
  Write-Host "A full app rebuild/install is also available when updating app code."
  Write-Host ""
  Write-Host "Double-click Update Release Data.cmd from the project root, or run:"
  Write-Host "  npm run release:data:wizard"
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

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)][securestring]$SecureString)

  if ($SecureString.Length -eq 0) {
    return ""
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Read-SecretText {
  param([Parameter(Mandatory = $true)][string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  return (Convert-SecureStringToPlainText -SecureString $secure)
}

function Invoke-Npm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  Write-Host ""
  Write-Host "> npm $($Arguments -join ' ')"
  $timer = [Diagnostics.Stopwatch]::StartNew()
  try {
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Write-Host ("Elapsed: {0:n1}s" -f $timer.Elapsed.TotalSeconds)
  }
}

function Read-PackageVersion {
  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  return [string]$packageJson.version
}

function Read-LocalUpdateMode {
  $installedPath = Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\Holoshelf.exe"
  $manifestPath = Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\resources\seed\official-data.json"
  $canApplyData = $false
  if ((Test-Path -LiteralPath $installedPath) -and (Test-Path -LiteralPath $manifestPath)) {
    try {
      $installedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      $canApplyData = $installedManifest.schema -eq 1 -and $installedManifest.seedDatabase -eq "holoshelf-template.sqlite"
    } catch { $canApplyData = $false }
  }
  $defaultChoice = if ($canApplyData) { "1" } else { "2" }
  Write-Host ""
  Write-Host "After refreshing data:"
  Write-Host "  1. Apply data to the installed app (fast; keeps the app version)."
  Write-Host "  2. Build and install a full app update (bumps the patch version)."
  Write-Host "  3. Refresh bundled data only."
  Write-Host "  4. Update local data and publish a silent songs/stats update to GitHub."
  while ($true) {
    $choice = (Read-Host "Choose 1, 2, 3, or 4 [default $defaultChoice]").Trim()
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = $defaultChoice }
    if ($choice -eq "1" -and -not $canApplyData) {
      Write-Host "Install Holoshelf with option 2 before using a data-only update."
      continue
    }
    if ($choice -eq "1") { return "data-only" }
    if ($choice -eq "2") { return "full-app" }
    if ($choice -eq "3") { return "seed-only" }
    if ($choice -eq "4") { return "silent-publish" }
    Write-Host "Please choose 1, 2, 3, or 4."
  }
}

function Test-VersionInstalled {
  param([Parameter(Mandatory = $true)][string]$Version)

  $installedPath = Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\Holoshelf.exe"
  if (-not (Test-Path -LiteralPath $installedPath)) {
    return $false
  }

  $installedVersion = [string](Get-Item -LiteralPath $installedPath).VersionInfo.ProductVersion
  return $installedVersion.StartsWith($Version)
}

function Read-HolodexKey {
  if ($env:HOLODEX_API_KEY -and (Read-YesNo "Use HOLODEX_API_KEY already set in this shell?" $true)) {
    return $env:HOLODEX_API_KEY
  }

  return (Read-SecretText -Prompt "Holodex API key (optional, press Enter to skip)")
}

function Read-YoutubeKey {
  if ($env:YOUTUBE_API_KEY -and (Read-YesNo "Use YOUTUBE_API_KEY already set in this shell?" $true)) {
    return $env:YOUTUBE_API_KEY
  }

  return (Read-SecretText -Prompt "YouTube Data API key (press Enter to skip stats)")
}

Write-Host ""
Write-Host "Holoshelf release data updater"
Write-Host "This refreshes default bundled Hololive data, not your personal AppData database."
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found on PATH. Install Node.js/npm or run this from a shell where npm works."
}

Set-Location $projectRoot

$holodexKey = Read-HolodexKey
$youtubeKey = Read-YoutubeKey
$skipStats = $false

if ([string]::IsNullOrWhiteSpace($youtubeKey)) {
  $skipStats = Read-YesNo "No YouTube key entered. Continue without refreshing YouTube stats?" $false
  if (-not $skipStats) {
    throw "A YouTube Data API key is required to refresh stats. Re-run the wizard and enter a key."
  }
}

$updateMode = Read-LocalUpdateMode
$installedAppExists = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "Programs\Holoshelf\Holoshelf.exe")
$installLocalUpdate = $updateMode -eq "data-only" -or $updateMode -eq "full-app" -or ($updateMode -eq "silent-publish" -and $installedAppExists)

if ($updateMode -eq "silent-publish") {
  if ($skipStats) { throw "Silent publishing requires a complete YouTube stats refresh." }
  Invoke-Npm @("run", "build:electron")
  & node (Join-Path $PSScriptRoot "publish-catalog-update.mjs") --check
  if ($LASTEXITCODE -ne 0) { throw "GitHub silent-update preflight failed. Publish the compatible app release first." }
}

Write-Host ""
Write-Host "Ready:"
Write-Host "  Release DB: data\holoshelf.sqlite"
Write-Host "  Seed output: resources\seed"
Write-Host "  Holodex key: $(if ([string]::IsNullOrWhiteSpace($holodexKey)) { 'not provided' } else { 'provided for this run' })"
Write-Host "  YouTube stats: $(if ($skipStats) { 'skipped' } else { 'enabled' })"
Write-Host "  Local update: $updateMode"

if (-not (Read-YesNo "Start now?" $true)) {
  Write-Host "Cancelled."
  exit 0
}

$refreshArguments = @("run", "release:data:refresh")
if ($skipStats) {
  $refreshArguments += "--"
  $refreshArguments += "--skip-stats"
}

$previousHolodexKey = $env:HOLODEX_API_KEY
$previousYoutubeKey = $env:YOUTUBE_API_KEY

try {
  if (-not [string]::IsNullOrWhiteSpace($holodexKey)) {
    $env:HOLODEX_API_KEY = $holodexKey
  } else {
    Remove-Item Env:\HOLODEX_API_KEY -ErrorAction SilentlyContinue
  }

  if (-not [string]::IsNullOrWhiteSpace($youtubeKey)) {
    $env:YOUTUBE_API_KEY = $youtubeKey
  } else {
    Remove-Item Env:\YOUTUBE_API_KEY -ErrorAction SilentlyContinue
  }

  Invoke-Npm $refreshArguments

  if ($updateMode -eq "data-only" -or ($updateMode -eq "silent-publish" -and $installedAppExists)) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
      & (Join-Path $PSScriptRoot "install-local-data.ps1")
    } finally {
      Write-Host ("Data update elapsed: {0:n1}s" -f $timer.Elapsed.TotalSeconds)
    }
  }

  if ($updateMode -eq "silent-publish") {
    & node (Join-Path $PSScriptRoot "publish-catalog-update.mjs") --yes
    if ($LASTEXITCODE -ne 0) { throw "Silent catalog publishing failed; refreshed local data was retained." }
  }

  if ($updateMode -eq "full-app") {
    $packageJsonPath = Join-Path $projectRoot "package.json"
    $packageLockPath = Join-Path $projectRoot "package-lock.json"
    $packageJsonBefore = [IO.File]::ReadAllBytes($packageJsonPath)
    $packageLockBefore = if (Test-Path -LiteralPath $packageLockPath) { [IO.File]::ReadAllBytes($packageLockPath) } else { $null }
    $oldVersion = Read-PackageVersion
    $newVersion = ""

    try {
      Invoke-Npm @("run", "release:bump:patch")
      $newVersion = Read-PackageVersion
      Invoke-Npm @("run", "release:install:local:refreshed")
    } catch {
      if (-not [string]::IsNullOrWhiteSpace($newVersion) -and -not (Test-VersionInstalled -Version $newVersion)) {
        [IO.File]::WriteAllBytes($packageJsonPath, $packageJsonBefore)
        if ($null -ne $packageLockBefore) {
          [IO.File]::WriteAllBytes($packageLockPath, $packageLockBefore)
        }
        Write-Warning "Installation did not reach $newVersion; restored package files to $oldVersion."
      }
      throw
    }
  }

  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  Write-Host ""
  Write-Host "Done."
  Write-Host "Current package version: $($packageJson.version)"
  if ($installLocalUpdate) {
    Write-Host "Fresh installs use the regenerated seed, and the installed AppData merge was verified."
  } elseif ($updateMode -eq "silent-publish") {
    Write-Host "Silent catalog published. Compatible installed clients fetch it in the background."
  } else {
    Write-Host "Fresh installs will use the regenerated seed after the next packaged update."
  }
} finally {
  if ($null -eq $previousHolodexKey) {
    Remove-Item Env:\HOLODEX_API_KEY -ErrorAction SilentlyContinue
  } else {
    $env:HOLODEX_API_KEY = $previousHolodexKey
  }

  if ($null -eq $previousYoutubeKey) {
    Remove-Item Env:\YOUTUBE_API_KEY -ErrorAction SilentlyContinue
  } else {
    $env:YOUTUBE_API_KEY = $previousYoutubeKey
  }
}
