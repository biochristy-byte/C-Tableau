@echo off
title Depth Lines viz extension server
echo Serving Depth Lines on http://localhost:8772 . Leave this window open.
python -m http.server 8772
pause
