@echo off
setlocal
cd /d "%~dp0"
echo [1/3] Locating Node.js...
call "%~dp0find-node.cmd"
if errorlevel 1 goto setup_failed
echo Node executable: "%INVOICEBOT_NODE_EXE%"
"%INVOICEBOT_NODE_EXE%" --version
if errorlevel 1 goto setup_failed
"%INVOICEBOT_NODE_EXE%" -e "if(Number(process.versions.node.split('.')[0])<22){console.error('Node.js 22 or newer is required. Detected: '+process.version);process.exit(1);}"
if errorlevel 1 goto setup_failed
set "INVOICEBOT_NPM_CLI=%INVOICEBOT_NODE_DIR%node_modules\npm\bin\npm-cli.js"
if not exist "%INVOICEBOT_NPM_CLI%" (
    echo npm was not found beside Node.js. Install Node with its npm component, then retry.
    goto setup_failed
)
echo npm version:
"%INVOICEBOT_NODE_EXE%" "%INVOICEBOT_NPM_CLI%" --version
if errorlevel 1 goto setup_failed
if /i "%~1"=="--check-node" (
    echo Node.js and npm detection passed. No packages installed.
    exit /b 0
)
echo.
echo [2/3] Installing dependencies using npm ci...
echo This step needs access to the npm registry. Download progress will appear below.
"%INVOICEBOT_NODE_EXE%" "%INVOICEBOT_NPM_CLI%" ci --no-audit --no-fund --loglevel=info --fetch-timeout=60000 --fetch-retries=1
if errorlevel 1 goto setup_failed
echo.
echo [3/3] Preparing working folders...
for %%D in (pending uploaded failed logs edge-profile) do if not exist "%%D\" mkdir "%%D"
echo Setup complete. Microsoft Edge must be installed.
echo Check billing-company.csv, then place PDFs inside mapped company subfolders of pending.
echo Run run-bot.cmd to start. Final Save is enabled for real invoice uploads.
pause
exit /b 0

:setup_failed
echo.
echo Setup stopped. Review the error above.
if /i not "%~1"=="--check-node" pause
exit /b 1
