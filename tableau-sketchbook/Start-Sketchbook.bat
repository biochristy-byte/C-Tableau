@echo off
title Sketchbook viz extension server
echo Serving Sketchbook on http://localhost:8773 . Leave this window open.
python -m http.server 8773
pause
