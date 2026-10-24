param(
  [string]$ReleasePath = $PSScriptRoot,
  [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'AI Image Offline'),
  [string]$InpaintModelPath = '',
  [string]$ChromaModelPath = '',
  [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $ReleasePath).Path
if ([IO.Path]::GetFullPath($InstallPath) -eq [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($InstallPath))) { throw 'Khong the cai vao thu muc goc o dia.' }
& (Join-Path $source 'verify-offline-release.ps1') -ReleasePath $source | Out-Null
$target = [IO.Path]::GetFullPath($InstallPath)
New-Item -ItemType Directory -Path $target -Force | Out-Null
$preserved = @('samples','workspace','models','weights','runtime','node_modules','.git','.venv-ai','.venv-sam2')
Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin $preserved } | Copy-Item -Destination $target -Recurse -Force
& (Join-Path $source 'scripts\install-samples.ps1') -SourceRoot $source -TargetRoot $target | Out-Null
foreach ($name in @('workspace','models')) {
  $sourceItem = Join-Path $source $name; $targetItem = Join-Path $target $name
  if ((Test-Path -LiteralPath $sourceItem) -and -not (Test-Path -LiteralPath $targetItem)) { Copy-Item -LiteralPath $sourceItem -Destination $targetItem -Recurse -Force }
}
$configDirectory = Join-Path $target 'workspace'; New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$configPath = Join-Path $configDirectory 'config.json'
$existing = @{}
if (Test-Path -LiteralPath $configPath) { $saved=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json; foreach($property in $saved.PSObject.Properties){$existing[$property.Name]=$property.Value} }
if (-not $InpaintModelPath) { $InpaintModelPath = if ($existing['inpaintModel']) { $existing['inpaintModel'] } else { Join-Path $target 'models\text-to-image\stable-diffusion-3.5-large' } }
if (-not $ChromaModelPath) { $ChromaModelPath = if ($existing['chromaModel']) { $existing['chromaModel'] } else { Join-Path $target 'models\flux\chroma1-hd' } }
$existing['inpaintModel'] = [IO.Path]::GetFullPath($InpaintModelPath)
$existing['chromaModel'] = [IO.Path]::GetFullPath($ChromaModelPath)
$existing['installedAt'] = (Get-Date).ToString('o')
$existing | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding utf8
if ($CreateDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop'); $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktop 'AI Image Offline.lnk')); $shortcut.TargetPath = (Join-Path $target 'open_app.bat'); $shortcut.WorkingDirectory = $target; $shortcut.Save()
}
[pscustomobject]@{ok=$true;installPath=$target;config=$configPath;workspacePreserved=$true;modelsPreserved=$true}
