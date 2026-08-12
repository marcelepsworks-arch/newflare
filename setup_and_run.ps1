# Setup and run script for Newflare (Windows PowerShell)
# - checks node/npm
# - optionally installs serve
# - starts local static server (node server.js)
# - opens default browser to http://localhost:3000

$ErrorActionPreference = 'Stop'

function Check-Command($cmd){
  $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

Write-Host "=== Newflare setup & run ==="

if(-not (Check-Command node)){
  Write-Host "Node.js not found. Please install Node.js (https://nodejs.org/) and re-run." -ForegroundColor Red
  exit 1
}

if(-not (Test-Path package.json)){
  Write-Host "package.json not found in current directory. Run this script from project root." -ForegroundColor Red
  exit 1
}

Write-Host "Installing npm dependencies (none required for prototype, running npm ci if lock present)..."
if(Test-Path package-lock.json){ npm ci } else { Write-Host "No package-lock.json, skipping npm ci." }

# Start server
Write-Host "Starting static server (server.js) on http://localhost:3000"
$nodeProc = Start-Process -FilePath node -ArgumentList 'server.js' -PassThru
Start-Sleep -Milliseconds 600

# open default browser
$uri = 'http://localhost:3000'
Start-Process $uri

Write-Host "Server started (PID: $($nodeProc.Id)). Press Ctrl-C to exit or close this window when done." -ForegroundColor Green

# wait for node process to exit
try{ wait-process -Id $nodeProc.Id } catch { }
