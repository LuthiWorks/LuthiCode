@echo off
REM Starts the local model server. Double-click it; leave the window open while using Pi.
REM The settings are in server.json (and server.local.json, if you make one);
REM tuning notes are in README.md in this folder. The launcher itself is
REM start-server.mjs, which runs the same way on every OS.
node "%~dp0start-server.mjs" %*
REM Keep the window open if the server exits, so any error stays readable.
pause
