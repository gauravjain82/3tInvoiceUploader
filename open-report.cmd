@echo off
setlocal
cd /d "%~dp0"
call "%~dp0find-node.cmd"
if errorlevel 1 (
    echo Node.js was not found. Run setup-client.cmd to diagnose the installation.
    pause
    exit /b 1
)
"%INVOICEBOT_NODE_EXE%" run-log.js
if errorlevel 1 (
    echo Could not refresh the report. Close any CSV files open in Excel and retry.
    pause
    exit /b 1
)
start "" "%~dp0logs\report.html"
