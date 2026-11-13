@echo off
setlocal
title Haroof maa Hussein - Installer
chcp 65001 >nul
cd /d "%~dp0"

rem --- one-time setup: Node runtime, firewall rule, desktop shortcut ---
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Requesting administrator permission once...
  echo   (needed to open the Windows firewall for phones on your Wi-Fi^)
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause