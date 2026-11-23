@echo off
title Radar viz extension server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Radar.ps1"
echo.
pause
