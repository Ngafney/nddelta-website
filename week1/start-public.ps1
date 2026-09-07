# Start the Week 1 arcade on a public URL from this machine.
#   Right-click → Run with PowerShell, or: powershell -File week1\start-public.ps1
# Serves the built app + API on port 8080 and opens a Cloudflare tunnel.
# Prints the public URL. Keep this window open; closing it stops the site.

$ErrorActionPreference = "SilentlyContinue"
$week1 = $PSScriptRoot

# 1. Server (port 8080) — start only if nothing is listening there yet.
$up = Test-NetConnection -ComputerName localhost -Port 8080 -InformationLevel Quiet
if (-not $up) {
  Write-Host "Starting the game server on :8080 ..."
  Start-Process -WindowStyle Hidden node -ArgumentList "serve.js" -WorkingDirectory $week1
  Start-Sleep -Seconds 3
} else {
  Write-Host "Game server already running on :8080."
}

# 2. Cloudflare tunnel — prints a fresh https URL each run.
Write-Host "Opening a public tunnel (this window must stay open) ..."
Write-Host "Watch below for:  https://<something>.trycloudflare.com  — add /week1/ to it."
Write-Host ""
npx --yes cloudflared tunnel --url http://localhost:8080 --no-autoupdate
