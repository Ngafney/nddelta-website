# Start Week 2 — Gradient Trading — on a public URL from this machine.
#   Right-click -> Run with PowerShell, or: powershell -File week2\start-public.ps1
#
# This is the recommended way to run a live round for a room of people: one
# node process holds the whole market in memory, so every trade is atomic for
# free, polling costs nothing, and there is no database to fall over.
# Keep this window open; closing it stops the site.

$ErrorActionPreference = "SilentlyContinue"
$week2 = $PSScriptRoot

# 0. Make sure the app is built.
if (-not (Test-Path (Join-Path $week2 "..\public\week2\index.html"))) {
  Write-Host "Building the app (first run only) ..."
  Push-Location $week2
  npm install --no-audit --no-fund
  npm run build
  Pop-Location
}

# 1. Server (port 8081) — start only if nothing is listening there yet.
$up = Test-NetConnection -ComputerName localhost -Port 8081 -InformationLevel Quiet
if (-not $up) {
  Write-Host "Starting the market on :8081 ..."
  # KV_FORCE_MEMORY keeps the round in this process, which is what you want for
  # a live room. Drop it to use the shared Upstash database instead.
  $env:KV_FORCE_MEMORY = "1"
  Start-Process -WindowStyle Hidden node -ArgumentList "serve.js" -WorkingDirectory $week2
  Start-Sleep -Seconds 3
} else {
  Write-Host "Market already running on :8081."
}

Write-Host ""
Write-Host "  players -> <public-url>/week2/"
Write-Host "  admin   -> <public-url>/week2/admin     (password 123 until you change it)"
Write-Host "  screen  -> <public-url>/week2/board"
Write-Host ""

# 2. Cloudflare tunnel — prints a fresh https URL each run.
Write-Host "Opening a public tunnel (this window must stay open) ..."
Write-Host "Watch below for:  https://<something>.trycloudflare.com  - add /week2/ to it."
Write-Host ""
npx --yes cloudflared tunnel --url http://localhost:8081 --no-autoupdate
