param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [string]$InstallPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $InstallPath).Path; $backup = (Resolve-Path -LiteralPath $BackupPath).Path
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $target 'workspace\version-backups'))
if (-not ($backup -eq $allowedRoot -or $backup.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar))) { throw 'Bản rollback phải nằm trong workspace\version-backups của ứng dụng.' }
$preserved = @('workspace','models','weights','runtime','node_modules','.git','.venv-ai','.venv-sam2')
$backupVersion=(Get-Content -LiteralPath (Join-Path $backup 'version.json') -Raw | ConvertFrom-Json).version
if ([version]$backupVersion -lt [version]'3.0.0' -and (Test-Path -LiteralPath (Join-Path $target 'workspace\metadata.sqlite3'))) {
  . (Join-Path $target 'scripts\runtime.ps1')
  $node=Resolve-AtelierRuntime -Root $target -Kind node
  $storage=& $node (Join-Path $target 'scripts\migrate-metadata.js') --action status | ConvertFrom-Json
  if ($storage.active) { & $node (Join-Path $target 'scripts\migrate-metadata.js') --action export; if ($LASTEXITCODE -ne 0) { throw 'Chưa xuất được dữ liệu cho phiên bản cũ. Dừng cả hai dịch vụ rồi thử lại.' } }
}
Get-ChildItem -LiteralPath $backup -Force | Where-Object { $_.Name -notin $preserved } | Copy-Item -Destination $target -Recurse -Force
[pscustomobject]@{ok=$true;restoredFrom=$backup;workspacePreserved=$true;modelsPreserved=$true}
