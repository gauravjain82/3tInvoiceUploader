@echo off
setlocal
cd /d "%~dp0"
call "%~dp0find-node.cmd"
if errorlevel 1 (
    pause
    exit /b 1
)
"%INVOICEBOT_NODE_EXE%" unload-receipts\inspect.js --navigate %*
set "UNLOAD_RECEIPT_EXIT=%ERRORLEVEL%"
pause
exit /b %UNLOAD_RECEIPT_EXIT%
