@echo off
rem Double-click to serve this extension for Tableau. Leave the window open.
title Range Dot viz extension server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
node serve.js
echo.
pause
