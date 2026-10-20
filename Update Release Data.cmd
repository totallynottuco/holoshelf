@echo off
setlocal
cd /d "%~dp0"
node "%~dp0scripts\release-data-wizard.mjs" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" echo Release data workflow completed successfully.
if not "%EXITCODE%"=="0" echo Release data refresh, install, or verification failed with exit code %EXITCODE%.
pause
exit /b %EXITCODE%
