@echo off
title Haroof maa Hussein - Server
chcp 65001 >nul
cd /d "%~dp0"
set "GAMEDIR=%~dp0"

set PORT=3000

rem --- Prefer the bundled Node runtime (runtime\node.exe) so no install is needed ---
set NODE=node
if exist "%~dp0runtime\node.exe" set NODE="%~dp0runtime\node.exe"

echo.
echo   ============================================
echo        Haroof maa Hussein  -  Arabic Letters
echo   ============================================
echo.

rem --- Already running? The server saves its real port in data\active-port.txt.
rem     We only trust it if OUR game answers there (another program may use the same port).
set RUNPORT=
if exist "%GAMEDIR%data\active-port.txt" set /p RUNPORT=<"%GAMEDIR%data\active-port.txt"
if "%RUNPORT%"=="" goto :run
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%RUNPORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.Content -match 'horoof-maa-hussein') { exit 1 } } catch {}; exit 0" >nul 2>nul
if not errorlevel 1 goto :run

echo   The game is ALREADY running on port %RUNPORT%.
echo   Opening the game screen in your browser...
echo.
echo   Do NOT start a second copy - keep using the window that is already open.
echo.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%GAMEDIR%server\open-screen.ps1" -Port %RUNPORT%
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
echo     - The game screen opens in Chrome automatically (press F11 for full screen).
echo     - Everything is controlled from the referee phone - no mouse needed.
echo     - On your phone, scan the QR code shown on the screen.
echo.
echo   To allow phones on the same Wi-Fi network, Windows may ask once
echo   for permission to allow the game through the Private network firewall.
echo   Choose "Allow access" if the prompt appears.
echo.

rem The game may move to 3001, 3002... when another program already uses 3000,
rem so the rule allows the whole range 3000-3010.
powershell -NoProfile -Command "if (Get-NetFirewallRule -DisplayName 'HoroofMaaHussein-Ports' -ErrorAction SilentlyContinue) { exit 0 }; exit 1" >nul 2>nul
if not errorlevel 1 goto :startgame

echo   ^>^> Press Y then wait for the Windows Yes/No prompt, or N to skip.
choice /C YN /M "   Add the one-time Windows firewall rule for phones on this Wi-Fi"
if errorlevel 2 goto :startgame

echo.
echo   Windows will now ask for administrator permission once.
echo   Choose Yes to allow TCP ports 3000-3010 on Private networks.
powershell -NoProfile -Command "Start-Process -FilePath netsh -ArgumentList 'advfirewall firewall add rule name=HoroofMaaHussein-Ports dir=in action=allow protocol=TCP localport=3000-3010 profile=private' -Verb RunAs -Wait"

:startgame

rem --- The server opens the screen itself, on the port it really got (3000, or 3001... if taken) ---
%NODE% server\index.js --port %PORT% --open-screen

echo.
echo   The server has stopped.
pause
exit /b 0