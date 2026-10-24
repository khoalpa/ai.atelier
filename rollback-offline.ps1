param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [string]$InstallPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $InstallPath).Path; $backup = (Resolve-Path -LiteralPath $BackupPath).Path
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $target 'workspace\version-backups'))
if (-not ($backup -eq $allowedRoot -or $backup.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar))) { throw 'Bản rollback phải nằm trong workspace\version-backups của ứng dụng.' }
$preserved = @('workspace','models','.venv-ai','.venv-sam2')
Get-ChildItem -LiteralPath $backup -Force | Where-Object { $_.Name -notin $preserved } | Copy-Item -Destination $target -Recurse -Force
[pscustomobject]@{ok=$true;restoredFrom=$backup;workspacePreserved=$true;modelsPreserved=$true}
