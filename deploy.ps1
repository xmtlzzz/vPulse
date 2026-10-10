<#
.SYNOPSIS
  vPulse - Build and Deploy to Cloudflare (Worker + D1 + Assets)
#>
param(
  [switch]$SkipBuild,
  [switch]$InitDb
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$env:WRANGLER_HOME = Join-Path $Root '.wrangler'

# 1. Proxy auto-detection for Windows environment
if (-not $env:HTTPS_PROXY) {
  try {
    $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
      $proxyServer = $reg.ProxyServer
      if ($proxyServer -notmatch '^https?://') { $proxyServer = "http://$proxyServer" }
      $env:HTTPS_PROXY = $proxyServer
      $env:HTTP_PROXY  = $proxyServer
      Write-Host "[*] Proxy detected: $proxyServer" -ForegroundColor DarkGray
    }
  } catch {}
}

# 2. Build Frontend Assets
if (-not $SkipBuild) {
  Write-Host '[1/3] Building frontend assets (Vite)...' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[x] Frontend build failed' -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host '[1/3] Skipping frontend build' -ForegroundColor DarkGray
}

# 3. Cloudflare D1 Database Provisioning (Optional flag -InitDb)
if ($InitDb) {
  Write-Host '[*] Initializing Cloudflare D1 Database schema...' -ForegroundColor Cyan
  npx wrangler d1 execute vpulse-db --file=./schema.sql --remote
}

# 4. Deploy Worker + Assets
Write-Host '[2/3] Deploying vPulse Worker to Cloudflare...' -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host '[x] Cloudflare deploy failed' -ForegroundColor Red
  exit 1
}

Write-Host '[3/3] Deployment completed successfully! [OK]' -ForegroundColor Green
Write-Host 'vPulse is now live and running on Cloudflare Global Edge.' -ForegroundColor Cyan
