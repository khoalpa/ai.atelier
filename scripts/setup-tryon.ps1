$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$git = (Get-Command git -ErrorAction Stop).Source
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$vendor = Join-Path $projectRoot 'vendor\CatVTON'
$modelRoot = Join-Path $projectRoot 'models\tryon'

if (-not (Test-Path -LiteralPath (Join-Path $vendor '.git'))) {
    & $git clone --depth 1 https://github.com/Zheng-Chong/CatVTON.git $vendor
}

& $python -c "from huggingface_hub import snapshot_download; snapshot_download('zhengchong/CatVTON', local_dir=r'$modelRoot\CatVTON')"

New-Item -ItemType Directory -Path (Join-Path $modelRoot 'stable-diffusion-inpainting\unet') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $modelRoot 'stable-diffusion-inpainting\scheduler') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $modelRoot 'sd-vae-ft-mse') -Force | Out-Null
$unetConfig = Join-Path $modelRoot 'stable-diffusion-inpainting\unet\config.json'
$schedulerConfig = Join-Path $modelRoot 'stable-diffusion-inpainting\scheduler\scheduler_config.json'
$vaeConfig = Join-Path $modelRoot 'sd-vae-ft-mse\config.json'
$unetModel = Join-Path $modelRoot 'stable-diffusion-inpainting\unet\diffusion_pytorch_model.fp16.safetensors'
$vaeModel = Join-Path $modelRoot 'sd-vae-ft-mse\diffusion_pytorch_model.bin'

Invoke-WebRequest -Uri 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting/resolve/main/unet/config.json' -OutFile $unetConfig
Invoke-WebRequest -Uri 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting/resolve/main/scheduler/scheduler_config.json' -OutFile $schedulerConfig
Invoke-WebRequest -Uri 'https://huggingface.co/stabilityai/sd-vae-ft-mse/resolve/main/config.json' -OutFile $vaeConfig

if (-not (Test-Path -LiteralPath $unetModel) -or (Get-Item -LiteralPath $unetModel).Length -ne 1719154104) {
    & (Join-Path $projectRoot 'scripts\download-ranged.ps1') -Url 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting/resolve/main/unet/diffusion_pytorch_model.fp16.safetensors?download=true' -Output $unetModel -Size 1719154104 -Parts 2
}
if (-not (Test-Path -LiteralPath $vaeModel) -or (Get-Item -LiteralPath $vaeModel).Length -lt 300000000) {
    curl.exe -L --fail --retry 10 -C - -o $vaeModel 'https://huggingface.co/stabilityai/sd-vae-ft-mse/resolve/main/diffusion_pytorch_model.bin?download=true'
}

Write-Host 'Da chuan bi CatVTON cho che do offline.'
