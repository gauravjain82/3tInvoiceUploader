@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0unload-receipts\setup-ie-driver.ps1"
set "DRIVER_SETUP_EXIT=%ERRORLEVEL%"
pause
exit /b %DRIVER_SETUP_EXIT%
