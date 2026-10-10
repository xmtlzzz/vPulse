<# Build, migrate and deploy from any working directory. #>
param([switch]$SkipBuild, [switch]$InitDb)
$ErrorActionPreference = 'Stop'

$NpmCmd = if ($IsWindows -or $env:OS -match 'Windows') { 'npm.cmd' } else { 'npm' }
$NpxCmd = if ($IsWindows -or $env:OS -match 'Windows') { 'npx.cmd' } else { 'npx' }

function Invoke-Checked {
  param([string]$Command, [string[]]$CommandArgs)
  $executable = if ($Command -eq 'npm') { $NpmCmd } elseif ($Command -eq 'npx') { $NpxCmd } else { $Command }
  & $executable @CommandArgs
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

Push-Location -LiteralPath $PSScriptRoot
try {
  Invoke-Checked 'npm' @('test')
  if ($SkipBuild) {
    Invoke-Checked 'npm' @('run', 'typecheck')
    if (-not (Test-Path -LiteralPath './dist/index.html')) { throw 'No build found; omit -SkipBuild.' }
  } else { Invoke-Checked 'npm' @('run', 'build') }
  if ($InitDb) { Invoke-Checked 'npx' @('wrangler', 'd1', 'execute', 'vpulse-db', '--remote', '--file=schema.sql') }
  Invoke-Checked 'npm' @('run', 'd1:migrate:remote')
  Invoke-Checked 'npx' @('wrangler', 'deploy')
  Write-Host 'vPulse deployment completed.' -ForegroundColor Green
} finally { Pop-Location }
