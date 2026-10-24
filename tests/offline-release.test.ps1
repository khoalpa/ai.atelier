$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('atelier-release-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  $release = & (Join-Path $projectRoot 'build-offline-release.ps1') -Destination $temporaryRoot
  $verified = & (Join-Path $release 'verify-offline-release.ps1') -ReleasePath $release
  if (-not $verified.ok) { throw 'Release verification failed' }
  $python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
  Push-Location $release
  try {
    & $python -I -c 'import sys; sys.path.insert(0, sys.argv[1]); import ai_service, outpainting, processing_mode_prompts, prompt_limits, local_request_security, sd35_depth_control, vton_pilot; assert ai_service.prompt_text("outpaint.instruction")' $release
    if ($LASTEXITCODE -ne 0) { throw 'Clean release imports failed' }
    & node -e 'const c=require("./app/prompt-store").readCatalog();if(!c.components)process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'Clean release prompt catalog failed' }
  } finally { Pop-Location }
  $installPath = Join-Path $temporaryRoot 'installed'
  $null = & (Join-Path $release 'install-offline.ps1') -ReleasePath $release -InstallPath $installPath -InpaintModelPath (Join-Path $temporaryRoot 'custom-model')
  $null = & (Join-Path $release 'install-offline.ps1') -ReleasePath $release -InstallPath $installPath
  $config = Get-Content -LiteralPath (Join-Path $installPath 'workspace\config.json') -Raw | ConvertFrom-Json
  if ($config.inpaintModel -ne (Join-Path $temporaryRoot 'custom-model')) { throw 'Reinstall overwrote saved model selection' }
  # Even if a manifest omitted a runtime dependency, verification must reject it.
  $missingFile = Join-Path $release 'outpainting.py'
  $manifestPath = Join-Path $release 'release-manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifest.files = @($manifest.files | Where-Object { $_.path -ne 'outpainting.py' })
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Remove-Item -LiteralPath $missingFile
  $rejected = $false
  try { $null = & (Join-Path $release 'verify-offline-release.ps1') -ReleasePath $release 2>$null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Verifier accepted a missing runtime dependency' }
  Write-Output 'OK: offline package verifies, imports in isolation, preserves model configuration and rejects missing dependencies.'
} finally {
  $resolved = [IO.Path]::GetFullPath($temporaryRoot)
  $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not $resolved.StartsWith($tempParent + [IO.Path]::DirectorySeparatorChar) -or -not ([IO.Path]::GetFileName($resolved)).StartsWith('atelier-release-test-')) { throw 'Unexpected test cleanup target' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
