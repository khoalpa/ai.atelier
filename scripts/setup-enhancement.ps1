$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$target=Join-Path $projectRoot 'models\enhancement\RealESRGAN_x2plus.pth'
$expected='49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb'
if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected) { Write-Output 'Model AI 2x da san sang.'; exit 0 }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$partial=$target+'.download'
Invoke-WebRequest -Uri 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth' -OutFile $partial
if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Checksum model khong khop; tep tai ve chua duoc kich hoat.' }
Move-Item -LiteralPath $partial -Destination $target -Force
Write-Output 'Da cai model AI 2x; xu ly anh khong can Internet.'
