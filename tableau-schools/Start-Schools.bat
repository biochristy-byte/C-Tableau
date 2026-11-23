@echo off
title Schools viz extension server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Schools.ps1"
echo.
pause
