@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-installed-app.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" echo Installed app and release data verified successfully.
if not "%EXITCODE%"=="0" echo Installed app update or data verification failed with exit code %EXITCODE%.
pause
exit /b %EXITCODE%
