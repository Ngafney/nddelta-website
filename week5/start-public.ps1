# Start Week 5 — The Horizon Market — on a public URL from this machine.
#   Right-click -> Run with PowerShell, or: powershell -File week5\start-public.ps1
#
# This is the recommended way to run a live round for a room of people: one
# node process holds the whole market in memory, so every trade is atomic for
# free, polling costs nothing, and there is no database to fall over.
# Keep this window open; closing it stops the site.

$ErrorActionPreference = "SilentlyContinue"
$week5 = $PSScriptRoot

# 0. Make sure the app is built.
if (-not (Test-Path (Join-Path $week5 "..\public\week5\index.html"))) {
  Write-Host "Building the app (first run only) ..."
  Push-Location $week5
  npm install --no-audit --no-fund
  npm run build
  Pop-Location
}

# 1. Server (port 8085) — start only if nothing is listening there yet.
$up = Test-NetConnection -ComputerName localhost -Port 8085 -InformationLevel Quiet
if (-not $up) {
  Write-Host "Starting the market on :8085 ..."
  # KV_FORCE_MEMORY keeps the round in this process, which is what you want for
  # a live room. Drop it to use the shared Upstash database instead.
  $env:KV_FORCE_MEMORY = "1"
  Start-Process -WindowStyle Hidden node -ArgumentList "serve.js" -WorkingDirectory $week5
  Start-Sleep -Seconds 3
} else {
  Write-Host "Market already running on :8085."
}

Write-Host ""
Write-Host "  players -> <public-url>/week5/"
Write-Host "  admin   -> <public-url>/week5/admin     (password 123 until you change it)"
Write-Host "  screen  -> <public-url>/week5/board"
Write-Host ""

# 2. Cloudflare tunnel — prints a fresh https URL each run.
Write-Host "Opening a public tunnel (this window must stay open) ..."
Write-Host "Watch below for:  https://<something>.trycloudflare.com  - add /week5/ to it."
Write-Host ""
npx --yes cloudflared tunnel --url http://localhost:8085 --no-autoupdate
