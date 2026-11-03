@echo off
setlocal
cd /d "%~dp0"
call "%~dp0find-node.cmd"
if errorlevel 1 (
    echo Node.js was not found. Run setup-client.cmd to diagnose the installation.
    pause
    exit /b 1
)
if not exist "node_modules\playwright\package.json" (
    echo Run setup-client.cmd before starting the bot.
    pause
    exit /b 1
)
echo Final Save is enabled. The bot will submit pending invoices to MSIL.
"%INVOICEBOT_NODE_EXE%" bot.js %*
set "INVOICEBOT_EXIT=%ERRORLEVEL%"
echo.
echo Check logs\report.html for invoice results.
pause
exit /b %INVOICEBOT_EXIT%
