@echo off
setlocal
cd /d "%~dp0"
call "%~dp0find-node.cmd"
if errorlevel 1 (
    pause
    exit /b 1
)
echo Log in manually, pause on the home screen, then open the portal menus normally.
echo This inspector does not click buttons, submit queries, or download receipts.
"%INVOICEBOT_NODE_EXE%" unload-receipts\inspect.js %*
set "INVOICEBOT_INSPECT_EXIT=%ERRORLEVEL%"
pause
exit /b %INVOICEBOT_INSPECT_EXIT%
