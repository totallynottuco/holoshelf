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
  Write-Host "regenerates resources\seed, and can optionally bump/install a local patch update."
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
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
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

$installLocalUpdate = Read-YesNo "After refreshing data, bump the patch version and install a local app update?" $true

Write-Host ""
Write-Host "Ready:"
Write-Host "  Release DB: data\holoshelf.sqlite"
Write-Host "  Seed output: resources\seed"
Write-Host "  Holodex key: $(if ([string]::IsNullOrWhiteSpace($holodexKey)) { 'not provided' } else { 'provided for this run' })"
Write-Host "  YouTube stats: $(if ($skipStats) { 'skipped' } else { 'enabled' })"
Write-Host "  Local install update: $(if ($installLocalUpdate) { 'yes' } else { 'no' })"

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

  if ($installLocalUpdate) {
    Invoke-Npm @("run", "release:bump:patch")
    Invoke-Npm @("run", "release:install:local")
  }

  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  Write-Host ""
  Write-Host "Done."
  Write-Host "Current package version: $($packageJson.version)"
  Write-Host "Fresh installs now use the regenerated seed. Existing installs merge it after updating."
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
