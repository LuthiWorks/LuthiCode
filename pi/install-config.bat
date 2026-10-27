@echo off
REM Installs LuthiCode's Pi setup (model list, settings, the agent's brief and
REM the proven extensions, including the protect-paths guard) into
REM %USERPROFILE%\.pi\agent. Existing files are first saved as .bak.
REM Run it again after pulling changes to LuthiCode. The installer itself is
REM install.mjs, which runs the same way on every OS.
node "%~dp0install.mjs" %*
pause
