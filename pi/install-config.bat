@echo off
REM Installs LuthiCode's Pi setup into the Pi agent folder:
REM   models.json, settings.json   - point Pi at the local model server
REM   AGENTS.global.md             - becomes AGENTS.md, the brief Pi loads in every repo
REM   ..\extensions\NAME.ts        - the extensions listed in EXTENSIONS below, including the guard
REM Any existing file is first saved next to it with a .bak extension.
REM Run it again after pulling changes to LuthiCode.

set DEST=%USERPROFILE%\.pi\agent
if defined PI_CODING_AGENT_DIR set DEST=%PI_CODING_AGENT_DIR%
set SRC=%~dp0
set REPO=%~dp0..

if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%\extensions" mkdir "%DEST%\extensions"

for %%F in (models.json settings.json) do (
  if exist "%DEST%\%%F" copy /Y "%DEST%\%%F" "%DEST%\%%F.bak" >nul
  copy /Y "%SRC%%%F" "%DEST%\%%F" >nul
  echo Installed %%F
)

if exist "%DEST%\AGENTS.md" copy /Y "%DEST%\AGENTS.md" "%DEST%\AGENTS.md.bak" >nul
copy /Y "%SRC%AGENTS.global.md" "%DEST%\AGENTS.md" >nul
echo Installed AGENTS.md

REM Only extensions that have earned their place in the eval are installed for
REM everyday use. The others in extensions\ are loaded by the eval on request
REM (run.mjs --extension NAME) until a comparison against the baseline
REM shows they help. Add a name here when one does.
set EXTENSIONS=protect-paths
for %%N in (%EXTENSIONS%) do (
  if exist "%DEST%\extensions\%%N.ts" copy /Y "%DEST%\extensions\%%N.ts" "%DEST%\extensions\%%N.ts.bak" >nul
  copy /Y "%REPO%\extensions\%%N.ts" "%DEST%\extensions\" >nul
  echo Installed extension %%N.ts
)

echo.
echo Done. Restart Pi if it was running.
echo To check the guard: node "%REPO%\extensions\tests\protect-paths.e2e.mjs"
pause
