@echo off
REM Copies this folder's Pi config into %USERPROFILE%\.pi\agent\
REM Any existing file is first saved next to it with a .bak extension.

set DEST=%USERPROFILE%\.pi\agent
set SRC=%~dp0

if not exist "%DEST%" mkdir "%DEST%"

for %%F in (models.json settings.json) do (
  if exist "%DEST%\%%F" copy /Y "%DEST%\%%F" "%DEST%\%%F.bak" >nul
  copy /Y "%SRC%%%F" "%DEST%\%%F" >nul
  echo Installed %%F
)

echo.
echo Done. Restart Pi if it was running.
pause
