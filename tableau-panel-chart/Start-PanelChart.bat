@echo off
title PanelChart viz extension server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-PanelChart.ps1"
echo.
pause
