# Start Week 6 — The Sum — on a public URL from this machine.
#   Right-click -> Run with PowerShell, or: powershell -File week6\start-public.ps1
#
# This is the recommended way to run a live round for a room of people: one
# node process holds the whole market in memory, so every trade is atomic for
# free, polling costs nothing, and there is no database to fall over.
# Keep this window open; closing it stops the site.

$ErrorActionPreference = "SilentlyContinue"
$week6 = $PSScriptRoot

# 0. Make sure the app is built.
if (-not (Test-Path (Join-Path $week6 "..\public\week6\index.html"))) {
  Write-Host "Building the app (first run only) ..."
  Push-Location $week6
  npm install --no-audit --no-fund
  npm run build
  Pop-Location
}

# 1. Server (port 8086) — start only if nothing is listening there yet.
$up = Test-NetConnection -ComputerName localhost -Port 8086 -InformationLevel Quiet
if (-not $up) {
  Write-Host "Starting the market on :8086 ..."
  # KV_FORCE_MEMORY keeps the round in this process, which is what you want for
  # a live room. Drop it to use the shared Upstash database instead.
  $env:KV_FORCE_MEMORY = "1"
  Start-Process -WindowStyle Hidden node -ArgumentList "serve.js" -WorkingDirectory $week6
  Start-Sleep -Seconds 3
} else {
  Write-Host "Market already running on :8086."
}

Write-Host ""
Write-Host "  players -> <public-url>/week6/"
Write-Host "  admin   -> <public-url>/week6/admin     (password 123 until you change it)"
Write-Host "  screen  -> <public-url>/week6/board"
Write-Host ""

# 2. Cloudflare tunnel — prints a fresh https URL each run.
Write-Host "Opening a public tunnel (this window must stay open) ..."
Write-Host "Watch below for:  https://<something>.trycloudflare.com  - add /week6/ to it."
Write-Host ""
npx --yes cloudflared tunnel --url http://localhost:8086 --no-autoupdate
