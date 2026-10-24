param(
  [Parameter(Mandatory=$true)][string]$ReleasePath
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $ReleasePath).Path
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("ai-image-clean-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $temporaryRoot -Recurse -Force
  $verification = & (Join-Path $temporaryRoot 'verify-offline-release.ps1') -ReleasePath $temporaryRoot
  if (-not $verification.ok) { throw 'Checksum không hợp lệ trong bản sao sạch.' }
  . (Join-Path $PSScriptRoot 'scripts\runtime.ps1')
  $node = Resolve-AtelierRuntime -Root $PSScriptRoot -Kind node
  & $node --check (Join-Path $temporaryRoot 'app\server.js')
  Get-ChildItem -LiteralPath (Join-Path $temporaryRoot 'app') -Filter '*.js' -File -Recurse | ForEach-Object { & $node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "JavaScript không hợp lệ: $($_.FullName)" } }
  $python = Resolve-AtelierRuntime -Root $PSScriptRoot -Kind python
  & $python -m py_compile (Join-Path $temporaryRoot 'ai_service.py') (Join-Path $temporaryRoot 'background_edit.py') (Join-Path $temporaryRoot 'scripts\backup-sqlite.py')
  if ($LASTEXITCODE -ne 0) { throw 'Python không hợp lệ trong gói phát hành.' }
  & $python -m compileall -q (Join-Path $temporaryRoot 'services')
  if ($LASTEXITCODE -ne 0) { throw 'Mô-đun Python không hợp lệ.' }
  Push-Location $temporaryRoot
  try { & $python -c 'from services.ai.application import main; print("AI module imports OK")' | Out-Host; if ($LASTEXITCODE -ne 0) { throw 'Thiếu mô-đun AI trong gói.' } } finally { Pop-Location }
  $startup = & $node (Join-Path $temporaryRoot 'scripts\verify-workflow-release.js') $temporaryRoot | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $startup.ok) { throw 'Gói phát hành không khởi động được trong thư mục sạch.' }
  [pscustomobject]@{ ok=$true; checkedFiles=$verification.checkedFiles; serverStarted=$startup.serverStarted; apiAndAssetChecks=$startup.apiAndAssetChecks; cleanDirectory=$temporaryRoot; note='Đã kiểm tra checksum, cú pháp, khởi động web và các API/tài nguyên trong thư mục sạch.' }
} finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedTemporary.StartsWith($temporaryParent,[StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolvedTemporary)).StartsWith('ai-image-clean-')) { throw 'Đường dẫn dọn bản kiểm thử không hợp lệ.' }
  if (Test-Path -LiteralPath $resolvedTemporary) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
}
