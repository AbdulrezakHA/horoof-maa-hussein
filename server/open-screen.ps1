# Opens the big game screen once the server answers.
#
# Called by the game server itself (node server\index.js --open-screen) with the port it
# really got, so it never opens a wrong program that happens to use the same port.
#
# The screen opens in a normal Chrome window (Edge only if Chrome is not installed), with
# its own small profile and a flag that lets it play sound without anyone clicking the page.
# Full screen: the referee taps the full-screen button on the phone (or press F11 on the PC).
#
# Usage: powershell -ExecutionPolicy Bypass -File open-screen.ps1 -Port 3000

param([int]$Port = 3000)

# Short log for troubleshooting: %TEMP%\horoof-open-screen.log
$log = Join-Path $env:TEMP 'horoof-open-screen.log'
function Log($m) { try { Add-Content -LiteralPath $log -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $m) } catch {} }
Log "start port=$Port"

# 127.0.0.1 (not "localhost"): some programs (e.g. Adobe extensions) sit on localhost ports.
$url = "http://127.0.0.1:$Port/screen"

# 1) Wait until OUR game answers (max ~25 s), so the page never opens on an error.
for ($i = 0; $i -lt 50; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200 -and $r.Content -match 'horoof-maa-hussein') { Log "server ready"; break }
  } catch { if ($i -eq 0) { Log ("health error: " + $_.Exception.Message) } }
  Start-Sleep -Milliseconds 500
}

# 2) Chrome first, then Edge.
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

Log "browser=$browser"
if (-not $browser) {
  # No Chrome/Edge: open the default browser (sound may need one click on the page).
  Start-Process $url
  exit 0
}

# A separate profile makes the sound flag apply even if Chrome is already open.
# One folder per browser: Chrome and Edge cannot share a profile folder.
$profileName = if ($browser -match 'chrome\.exe$') { 'screen-chrome' } else { 'screen-edge' }
$profileDir = Join-Path (Join-Path $env:LOCALAPPDATA 'HoroofMaaHussein') $profileName
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

$browserArgs = @(
  "--user-data-dir=`"$profileDir`"",
  '--new-window',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  '--disable-session-crashed-bubble',
  $url
)
try {
  Start-Process -FilePath $browser -ArgumentList $browserArgs -ErrorAction Stop
  Log "opened $url"
} catch {
  Log ("open failed: " + $_.Exception.Message)
  Start-Process $url
}
