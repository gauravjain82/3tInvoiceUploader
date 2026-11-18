$ErrorActionPreference = 'Stop'
$driverDir = Join-Path $PSScriptRoot 'drivers'
$driverPath = Join-Path $driverDir 'IEDriverServer.exe'
if (Test-Path -LiteralPath $driverPath) {
    Write-Host "IE Driver already exists: $driverPath"
    exit 0
}
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('invoicebot-iedriver-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $zipPath = Join-Path $tempDir 'driver.zip'
    $url = 'https://github.com/SeleniumHQ/selenium/releases/download/selenium-4.14.0/IEDriverServer_Win32_4.14.0.zip'
    Write-Host 'Downloading the official Selenium IE Driver 4.14.0 (32-bit)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir
    $extracted = Join-Path $tempDir 'IEDriverServer.exe'
    if (-not (Test-Path -LiteralPath $extracted -PathType Leaf)) { throw 'The downloaded archive does not contain IEDriverServer.exe.' }
    New-Item -ItemType Directory -Path $driverDir -Force | Out-Null
    Copy-Item -LiteralPath $extracted -Destination $driverPath
    Write-Host "IE Driver installed: $driverPath"
} catch {
    Write-Error "IE Driver setup failed: $_"
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}
