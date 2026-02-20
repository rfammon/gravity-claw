# Gravity Claw Startup Persistence Script
# This script ensures PM2 and Gravity Claw are online.

$PM2_PATH = "$env:APPDATA\npm\pm2.cmd"
$PROJECT_DIR = "c:\Users\vinil\gravity-claw"

Write-Host "🚀 Initializing Gravity Claw Background Daemon..." -ForegroundColor Cyan

if (Test-Path $PM2_PATH) {
    Set-Location $PROJECT_DIR
    # Start the ecosystem if not already running
    & $PM2_PATH start ecosystem.config.cjs
    & $PM2_PATH save
    Write-Host "✅ Gravity Claw is now managed by PM2." -ForegroundColor Green
} else {
    Write-Error "❌ PM2 not found at $PM2_PATH. Please ensure it's installed globally."
}
