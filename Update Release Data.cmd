@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-data-wizard.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" echo Release data workflow completed successfully.
if not "%EXITCODE%"=="0" echo Release data refresh, install, or verification failed with exit code %EXITCODE%.
pause
exit /b %EXITCODE%
