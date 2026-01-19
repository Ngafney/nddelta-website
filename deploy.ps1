# DELTA Website Deployment Script
# Builds and deploys the website to nddelta.com

Write-Host "🔨 Building production version..." -ForegroundColor Cyan

npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build successful!" -ForegroundColor Green
    Write-Host "📤 Uploading to server..." -ForegroundColor Cyan
    
    scp -r build\* root@159.65.173.202:/var/www/nddelta/
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "🔧 Fixing permissions..." -ForegroundColor Cyan
        ssh root@159.65.173.202 "chmod -R 755 /var/www/nddelta"
        
        Write-Host ""
        Write-Host "✅ Deployed successfully!" -ForegroundColor Green
        Write-Host "🌐 Visit: https://nddelta.com" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Upload failed" -ForegroundColor Red
    }
} else {
    Write-Host "❌ Build failed" -ForegroundColor Red
}
