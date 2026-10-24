$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$checkpoint = Join-Path $projectRoot 'models\segmentation\sam2.1_hiera_tiny.pt'

if (-not (Test-Path -LiteralPath $python)) {
    throw 'Chua co moi truong SAM 2. Hay chay scripts\setup-ai.ps1.'
}
if (-not (Test-Path -LiteralPath $checkpoint)) {
    throw 'Thieu checkpoint SAM 2.1 Tiny. Hay chay scripts\setup-ai.ps1.'
}
& $python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) {
    throw 'PyTorch CUDA khong hoat dong. Hay chay lai scripts\setup-ai.ps1.'
}

$env:SAM2_VARIANT = 'tiny'
# Keep any explicit model override; otherwise the service reads the saved config.
& $python (Join-Path $projectRoot 'ai_service.py')

