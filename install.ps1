# Haroof maa Hussein - one-time installer
# NOTE: kept ASCII-only on purpose so it can never be mis-decoded on any Windows.
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root
$port = 3000
$rule = 'HoroofMaaHussein-Ports'
$ports = '3000-3010'  # the game moves to 3001, 3002... if another program already uses 3000
$nodeExe = Join-Path $root 'runtime\node.exe'

function Say($m) { Write-Host $m }

Say ''
Say '  ============================================'
Say '     Haroof maa Hussein - one-time setup'
Say '  ============================================'
Say ('  Folder: ' + $root)
Say ''

if (-not (Test-Path -LiteralPath (Join-Path $root 'server\index.js'))) {
  Say '  [X] This does not look like the game folder: server\index.js is missing.'
  Say '      Unzip the whole folder first, then run install.bat from inside it.'
  exit 1
}

# ---------- 1) Node runtime ----------
if (Test-Path -LiteralPath $nodeExe) {
  Say '  [ok] Bundled Node runtime found (no install needed).'
} else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    Say ('  [ok] Node.js found on this computer: ' + $cmd.Source)
  } else {
    Say '  Node.js is not installed - downloading the portable runtime (~30 MB)...'
    $ok = $false
    try {
      $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
      $rel = $idx | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
      if (-not $rel) { throw 'the Node download index did not list an LTS Windows build' }
      $ver = $rel.version
      $url = 'https://nodejs.org/dist/' + $ver + '/node-' + $ver + '-win-x64.zip'
      Say ('  Downloading ' + $url)
      $zip = Join-Path $env:TEMP 'horoof-node.zip'
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 900
      $tmp = Join-Path $env:TEMP ('horoof-node-' + [guid]::NewGuid().ToString('N'))
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
      $exe = Get-ChildItem -LiteralPath $tmp -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $exe) { throw 'node.exe was not found inside the downloaded archive' }
      New-Item -ItemType Directory -Path (Join-Path $root 'runtime') -Force | Out-Null
      Copy-Item -LiteralPath $exe.FullName -Destination $nodeExe -Force
      Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
      $ok = $true
      Say '  [ok] Portable Node is ready.'
    } catch {
      Say ''
      Say ('  [X] Could not download Node automatically: ' + $_.Exception.Message)
      Say '      Install Node.js LTS from https://nodejs.org , then run install.bat again.'
    }
    if (-not $ok -and -not (Test-Path -LiteralPath $nodeExe)) { exit 1 }
  }
}

# ---------- 2) Firewall rule (so phones on the same Wi-Fi can connect) ----------
$fw = Join-Path $root 'server\firewall.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $fw -Check -NodeExe $nodeExe
if ($LASTEXITCODE -eq 0) {
  Say ('  [ok] Firewall rule already in place (TCP ' + $ports + ', all networks).')
} else {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $fw -NodeExe $nodeExe
  if ($LASTEXITCODE -ne 0) { Say '      Right-click install.bat and choose "Run as administrator".' }
}

# ---------- 3) Desktop + Start Menu shortcuts ----------
# Arabic names are built from character codes so this file stays pure ASCII.
$launcherName = (-join ([char[]](0x0627, 0x0628, 0x062F, 0x0623, 0x002D, 0x0627, 0x0644, 0x0644, 0x0639, 0x0628, 0x0629))) + '.bat'
$launcher = Join-Path $root $launcherName
$appName = -join ([char[]](0x062D, 0x0631, 0x0648, 0x0641, 0x0020, 0x0645, 0x0639, 0x0020, 0x062D, 0x0633, 0x064A, 0x0646))

if (-not (Test-Path -LiteralPath $launcher)) {
  Say ('  [!] Launcher not found: ' + $launcher)
} else {
  $target = $launcher
  $icon = 'shell32.dll'
  if (Test-Path -LiteralPath $nodeExe) { $icon = $nodeExe }
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Haroof maa Hussein'
  try {
    New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
    $ws = New-Object -ComObject WScript.Shell
    foreach ($dir in @($desktop, $startMenu)) {
      $lnkPath = Join-Path $dir ($appName + '.lnk')
      $lnk = $ws.CreateShortcut($lnkPath)
      $lnk.TargetPath = $target
      $lnk.WorkingDirectory = $root
      $lnk.Description = 'Haroof maa Hussein - Arabic letters team game'
      $lnk.IconLocation = ($icon + ',0')
      $lnk.Save()
      Say ('  [ok] Shortcut: ' + $lnkPath)
    }
  } catch {
    Say ('  [!] Could not create shortcuts: ' + $_.Exception.Message)
  }
}

# ---------- 4) Tell the user the addresses ----------
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch { }

Say ''
Say '  --------------------------------------------'
Say '   Done. From now on: double-click the desktop'
Say '   shortcut to start the game.'
Say ''
Say ('   On this PC :  http://localhost:' + $port + '/screen')
Say ('   Referee    :  http://localhost:' + $port + '/referee')
foreach ($ip in $ips) {
  Say ('   From phone :  http://' + $ip + ':' + $port)
}
Say ''
Say '   Keep the black server window open while playing.'
Say '  --------------------------------------------'
Say ''