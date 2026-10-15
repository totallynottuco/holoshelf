$ErrorActionPreference = "Stop"
$running = Get-Process -Name "Holoshelf" -ErrorAction SilentlyContinue
if ($running) {
  foreach ($process in $running) {
    if ($process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() }
  }
  $deadline = (Get-Date).AddSeconds(5)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = Get-Process -Name "Holoshelf" -ErrorAction SilentlyContinue
  } while ($remaining -and (Get-Date) -lt $deadline)
  if ($remaining) {
    $remaining | Stop-Process -Force
    Start-Sleep -Milliseconds 500
  }
}
