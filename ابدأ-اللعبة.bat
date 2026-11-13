@echo off
title Haroof maa Hussein - Server
chcp 65001 >nul
cd /d "%~dp0"

set PORT=3000

rem --- Prefer the bundled Node runtime (runtime\node.exe) so no install is needed ---
set NODE=node
if exist "%~dp0runtime\node.exe" set NODE="%~dp0runtime\node.exe"

echo.
echo   ============================================
echo        Haroof maa Hussein  -  Arabic Letters
echo   ============================================
echo.

rem --- Already running? then just reopen the screen (never start a 2nd copy) ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 1 } } catch {}; exit 0" >nul 2>nul
if not errorlevel 1 goto :run

echo   The game is ALREADY running on port 3000.
echo   Opening the game screen in your browser...
echo.
echo   Do NOT start a second copy: it would take another port
echo   (3001, 3002, ...) and the QR codes would then open the
echo   wrong server and show a 404 page.
echo.
start "" "http://localhost:3000/screen"
timeout /t 6 >nul
exit /b 0

:run
if exist "%~dp0runtime\node.exe" goto :firewall

where node >nul 2>nul
if not errorlevel 1 goto :firewall

echo   [X] Node.js is NOT installed on this computer.
echo.
echo       1. Open:  https://nodejs.org
echo       2. Download the version marked LTS
echo       3. Install it - just click Next until the end
echo       4. Double-click this file again
echo.
echo   (If you used install.bat from the game folder, this should
echo    never happen: it already comes with a bundled Node runtime.)
echo.
pause
exit /b 1

:firewall
echo.
echo   Starting the game server...
echo.
echo   IMPORTANT:
echo     - Do NOT close this window while playing.
echo     - The game screen opens in your browser automatically.
echo     - On your phone, scan the QR code shown on the screen.
echo.
echo   To allow phones on the same Wi-Fi network, Windows may ask once
echo   for permission to allow the game through the Private network firewall.
echo   Choose "Allow access" if the prompt appears.
echo.

powershell -NoProfile -Command "if (Get-NetFirewallRule -DisplayName 'HoroofMaaHussein','HiveGame' -ErrorAction SilentlyContinue) { exit 0 }; exit 1" >nul 2>nul
if not errorlevel 1 goto :startgame

choice /C YN /N /M "Add the one-time Windows firewall rule for phones on this Wi-Fi"
if errorlevel 2 goto :startgame

echo.
echo   Windows will now ask for administrator permission once.
echo   Choose Yes to allow TCP port %PORT% on Private networks.
powershell -NoProfile -Command "Start-Process -FilePath netsh -ArgumentList 'advfirewall firewall add rule name=HoroofMaaHussein dir=in action=allow protocol=TCP localport=%PORT% profile=private' -Verb RunAs -Wait"

:startgame

start "" "http://localhost:%PORT%/screen"

%NODE% server\index.js --port %PORT%

echo.
echo   The server has stopped.
pause