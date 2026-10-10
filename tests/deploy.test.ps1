$ErrorActionPreference = 'Stop'
$global:vpulseDeployCalls = [System.Collections.Generic.List[string]]::new()
$global:vpulseFailCommand = ''
$vpulseDeployScript = Join-Path $PSScriptRoot '../deploy.ps1'
function global:npm {
  $command = 'npm ' + ($args -join ' ')
  $global:vpulseDeployCalls.Add($command)
  $global:LASTEXITCODE = if ($command -eq $global:vpulseFailCommand) { 1 } else { 0 }
}
function global:npx {
  $command = 'npx ' + ($args -join ' ')
  $global:vpulseDeployCalls.Add($command)
  $global:LASTEXITCODE = if ($command -eq $global:vpulseFailCommand) { 1 } else { 0 }
}
# Mock every external command: this test must never deploy or access remote D1.
Push-Location -LiteralPath ([IO.Path]::GetTempPath())
try {
  $invocationDirectory = (Get-Location).Path
  foreach ($failure in @('npm test', 'npm run build', 'npm run d1:migrate:remote', 'npx wrangler d1 execute vpulse-db --remote --file=schema.sql', 'npx wrangler deploy')) {
    $global:vpulseDeployCalls.Clear()
    $global:vpulseFailCommand = $failure
    $failed = $false
    try { & $vpulseDeployScript -InitDb } catch { $failed = $true }
    if (-not $failed -or $global:vpulseDeployCalls[-1] -ne $failure) { throw "Did not stop at $failure" }
    if ((Get-Location).Path -ne $invocationDirectory) { throw 'Working directory was not restored' }
    Write-Output "PASS: stops at $failure"
  }
  $global:vpulseDeployCalls.Clear()
  $global:vpulseFailCommand = ''
  & $vpulseDeployScript
  if ($global:vpulseDeployCalls[-1] -ne 'npx wrangler deploy') { throw 'Deployment flow incomplete' }
  Write-Output 'PASS: checked flow from another working directory'
} finally {
  Pop-Location
  Remove-Item Function:\npm,Function:\npx
  Remove-Variable vpulseDeployCalls,vpulseFailCommand -Scope Global
}
