@echo off
setlocal
cd /d "%~dp0"
title AI Image Offline

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Windows PowerShell.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"
if errorlevel 1 (
  echo.
  echo Khong the khoi dong ung dung. Xem thong bao loi phia tren.
  pause
  exit /b 1
)
endlocal
