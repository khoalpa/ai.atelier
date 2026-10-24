param(
  [Parameter(Mandatory=$true)][string]$ReleasePath,
  [string]$InstallPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $ReleasePath).Path; $target = (Resolve-Path -LiteralPath $InstallPath).Path
if ($source -eq $target) { throw 'Nguon cap nhat va thu muc cai dat phai khac nhau.' }
& (Join-Path $source 'verify-offline-release.ps1') -ReleasePath $source | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $source 'release-manifest.json') -Raw | ConvertFrom-Json
$backupRoot = Join-Path $target 'workspace\version-backups'; New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backup = Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss'); New-Item -ItemType Directory -Path $backup | Out-Null
$preserved = @('samples','workspace','models','weights','runtime','node_modules','.git','.venv-ai','.venv-sam2')
Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -notin $preserved } | Copy-Item -Destination $backup -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $target 'samples')) { Copy-Item -LiteralPath (Join-Path $target 'samples') -Destination $backup -Recurse -Force }
Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin $preserved } | Copy-Item -Destination $target -Recurse -Force
& (Join-Path $source 'scripts\install-samples.ps1') -SourceRoot $source -TargetRoot $target | Out-Null
@{version=$manifest.version;updatedAt=(Get-Date).ToString('o');rollback=$backup} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'workspace\current-version.json') -Encoding utf8
[pscustomobject]@{ok=$true;version=$manifest.version;backup=$backup;workspacePreserved=$true;modelsPreserved=$true}
