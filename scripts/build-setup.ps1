# Builds the portable setup zip: the game + a bundled Node runtime + install.bat.
# ASCII-only on purpose. Output: D:\_dist\Horoof-Maa-Hussein-Setup-v<ver>.zip
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$version = '1.0.0'
$distDir = 'D:\_dist'
$zip = Join-Path $distDir ('Horoof-Maa-Hussein-Setup-v' + $version + '.zip')
$stage = Join-Path $env:TEMP 'horoof-setup-stage'
$topName = 'Haroof-Maa-Hussein'
$top = Join-Path $stage $topName
$runtime = Join-Path $root 'runtime\node.exe'

function Say($m) { Write-Host $m }

Say ('ROOT  = ' + $root)
Say ('ZIP   = ' + $zip)

# ---------------------------------------------------------------- 1) Node runtime
if (-not (Test-Path -LiteralPath $runtime)) {
  Say 'runtime\node.exe is missing - downloading the Node LTS portable build...'
  $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 90
  $rel = $idx | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
  if (-not $rel) { throw 'the Node download index did not list an LTS win-x64 build' }
  $ver = $rel.version
  $url = 'https://nodejs.org/dist/' + $ver + '/node-' + $ver + '-win-x64.zip'
  Say ('downloading ' + $url)
  $tmpZip = Join-Path $env:TEMP 'horoof-node-dl.zip'
  Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 900
  $tmpDir = Join-Path $env:TEMP ('horoof-node-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $tmpZip -DestinationPath $tmpDir -Force
  $exe = Get-ChildItem -LiteralPath $tmpDir -Recurse -Filter 'node.exe' | Select-Object -First 1
  if (-not $exe) { throw 'node.exe was not found in the downloaded archive' }
  New-Item -ItemType Directory -Path (Join-Path $root 'runtime') -Force | Out-Null
  Copy-Item -LiteralPath $exe.FullName -Destination $runtime -Force
  Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
Say ('node.exe: ' + [math]::Round((Get-Item -LiteralPath $runtime).Length / 1MB, 1) + ' MB')

# ---------------------------------------------------------------- 2) Stage the app
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $top -Force | Out-Null

foreach ($d in @('server', 'public', 'shared', 'data', 'presets')) {
  Copy-Item -LiteralPath (Join-Path $root $d) -Destination (Join-Path $top $d) -Recurse -Force
}
foreach ($f in @('package.json', 'install.bat', 'install.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root $f) -Destination (Join-Path $top $f) -Force
}
# launcher(s), docs and the licence files in the root
Get-ChildItem -LiteralPath $root -File | Where-Object {
  $_.Name -notin @('install.bat', 'install.ps1', 'package.json') -and
  ($_.Extension -in @('.bat', '.md', '.txt'))
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $top $_.Name) -Force }

New-Item -ItemType Directory -Path (Join-Path $top 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $top 'runtime\node.exe') -Force
# Internet link (Cloudflare): bundled when present, otherwise the game downloads it on first run
$cf = Join-Path $root 'runtime\cloudflared.exe'
if (Test-Path -LiteralPath $cf) { Copy-Item -LiteralPath $cf -Destination (Join-Path $top 'runtime\cloudflared.exe') -Force }

# readme for the friend: Arabic, saved as UTF-8 WITH BOM so Notepad shows it correctly
$readmeSrc = Join-Path $root 'scripts\setup-readme-ar.txt'
$readmeTxt = [System.IO.File]::ReadAllText($readmeSrc, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText((Join-Path $top 'README-FIRST.txt'), $readmeTxt, (New-Object System.Text.UTF8Encoding($true)))

Remove-Item -LiteralPath (Join-Path $top 'data\state.json') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $top 'data\questions.json.bak') -Force -ErrorAction SilentlyContinue

$count = (Get-ChildItem -LiteralPath $top -Recurse -File).Count
$size = [math]::Round(((Get-ChildItem -LiteralPath $top -Recurse -File | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Say ('staged: ' + $count + ' files / ' + $size + ' MB')

# ---------------------------------------------------------------- 3) Zip it
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($top, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Say ('zip: ' + [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1) + ' MB')

# ---------------------------------------------------------------- 4) Smoke test the zip
$test = Join-Path $env:TEMP 'horoof-setup-test'
if (Test-Path -LiteralPath $test) { Remove-Item -LiteralPath $test -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $test -Force
$appDir = Join-Path $test $topName
if (-not (Test-Path -LiteralPath $appDir)) { throw ('the zip does not contain the expected folder ' + $topName) }
Say ('extracted to: ' + $appDir)

$node = Join-Path $appDir 'runtime\node.exe'
$proc = Start-Process -FilePath $node -ArgumentList 'server\index.js', '--port', '3112' -WorkingDirectory $appDir -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5
$health = 'FAIL'
$screen = 'FAIL'
$presets = 'FAIL'
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3112/api/health' -UseBasicParsing -TimeoutSec 6; if ($r.StatusCode -eq 200) { $health = '200' } } catch { }
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3112/screen' -UseBasicParsing -TimeoutSec 6; $screen = [string]$r.StatusCode } catch { }
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3112/presets' -UseBasicParsing -TimeoutSec 6; $presets = [string]$r.StatusCode } catch { }
Say ('smoke: health=' + $health + '  /screen=' + $screen + '  /presets=' + $presets)
try { Stop-Process -Id $proc.Id -Force } catch { }
Start-Sleep -Seconds 1
Remove-Item -LiteralPath $test -Recurse -Force -ErrorAction SilentlyContinue

Say 'DONE'
Say ('HEALTH=' + $health)
Say ('ZIP_MB=' + [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1))