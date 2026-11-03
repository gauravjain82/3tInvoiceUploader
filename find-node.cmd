@echo off
rem Shared resolver. The caller uses setlocal; keep the resolved variables in its scope.
set "INVOICEBOT_NODE_EXE="
set "INVOICEBOT_NODE_DIR="
if defined INVOICEBOT_NODE (
    call :candidate "%INVOICEBOT_NODE%"
    if not defined INVOICEBOT_NODE_EXE (
        echo INVOICEBOT_NODE does not point to an existing node.exe. 1>&2
        exit /b 1
    )
    goto found
)
if defined NVM_SYMLINK call :candidate "%NVM_SYMLINK%\node.exe"
if defined FNM_MULTISHELL_PATH call :candidate "%FNM_MULTISHELL_PATH%\node.exe"
if defined ProgramFiles call :candidate "%ProgramFiles%\nodejs\node.exe"
if defined ProgramW6432 call :candidate "%ProgramW6432%\nodejs\node.exe"
if defined ProgramFiles(x86) call :candidate "%ProgramFiles(x86)%\nodejs\node.exe"
if defined LOCALAPPDATA call :candidate "%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined LOCALAPPDATA call :candidate "%LOCALAPPDATA%\nodejs\node.exe"
if defined INVOICEBOT_NODE_EXE goto found
rem Bound the PATH lookup: disconnected network paths must not hang setup forever.
for /f "delims=" %%N in ('powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$p = New-Object Diagnostics.Process; $p.StartInfo.FileName = $env:SystemRoot + '\System32\where.exe'; $p.StartInfo.Arguments = 'node.exe'; $p.StartInfo.UseShellExecute = $false; $p.StartInfo.RedirectStandardOutput = $true; $p.StartInfo.RedirectStandardError = $true; $p.StartInfo.CreateNoWindow = $true; try { [void]$p.Start(); if ($p.WaitForExit(8000)) { if ($p.ExitCode -eq 0) { $p.StandardOutput.ReadToEnd() } } else { $p.Kill() } } finally { $p.Dispose() }"') do call :candidate "%%N"
if defined INVOICEBOT_NODE_EXE goto found
echo Node.js was not found in common installation locations or PATH. 1>&2
echo Reopen Command Prompt after installing Node, or set INVOICEBOT_NODE to its full node.exe path. 1>&2
exit /b 1

:candidate
if defined INVOICEBOT_NODE_EXE exit /b 0
if exist "%~1" set "INVOICEBOT_NODE_EXE=%~1"
exit /b 0

:found
for %%I in ("%INVOICEBOT_NODE_EXE%") do set "INVOICEBOT_NODE_DIR=%%~dpI"
set "PATH=%INVOICEBOT_NODE_DIR%;%PATH%"
exit /b 0
