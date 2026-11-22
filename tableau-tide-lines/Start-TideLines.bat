@echo off
title TideLines viz extension server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-TideLines.ps1"
echo.
pause
