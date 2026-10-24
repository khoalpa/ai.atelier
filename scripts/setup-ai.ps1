$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$basePython = 'C:\Users\lpak\AppData\Local\Programs\Python\Python310\python.exe'
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$modelDir = Join-Path $projectRoot 'models\segmentation'

if (-not (Test-Path -LiteralPath $basePython)) {
    throw 'Khong tim thay Python 3.10 co PyTorch CUDA tren may nay.'
}
& $basePython -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) {
    throw 'Python 3.10 goc khong co PyTorch CUDA hoat dong.'
}

if (-not (Test-Path -LiteralPath $python)) {
    & $basePython -m venv --system-site-packages (Join-Path $projectRoot '.venv-sam2')
}
& $python -m pip install 'git+https://github.com/facebookresearch/sam2.git'
& $python -m pip install 'opencv-python-headless==4.10.0.84'
& $python -m pip install 'kornia==0.8.2' 'timm==1.0.30'
if ($LASTEXITCODE -ne 0) {
    throw 'Khong the cai thu vien BiRefNet (kornia, timm).'
}
& $python -m pip install --no-deps 'ultralytics==8.4.176'
& $python -m pip install 'git+https://github.com/ultralytics/CLIP.git'

# Some dependencies can install a CPU-only PyTorch build in the venv and
# shadow the shared CUDA build. Remove that local build and verify CUDA.
& $python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) {
    & $python -m pip uninstall -y torch torchvision
}
& $python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) {
    throw 'Moi truong SAM 2 dang dung PyTorch CPU; khong the kich hoat CUDA.'
}

$clipDir = Join-Path $projectRoot 'weights\clip'
$clipModel = Join-Path $clipDir 'ViT-B-32.pt'
$clipSha256 = '40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af'
New-Item -ItemType Directory -Path $clipDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $clipModel) -or (Get-FileHash -LiteralPath $clipModel -Algorithm SHA256).Hash.ToLowerInvariant() -ne $clipSha256) {
    Invoke-WebRequest -Uri 'https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt' -OutFile $clipModel
}

$poseDir = Join-Path $projectRoot 'models\pose'
$poseModel = Join-Path $poseDir 'yolo11n-pose.pt'
if (-not (Test-Path -LiteralPath $poseModel)) {
    New-Item -ItemType Directory -Path $poseDir -Force | Out-Null
    Push-Location $poseDir
    try { & $python -c "from ultralytics import YOLO; YOLO('yolo11n-pose.pt')" } finally { Pop-Location }
}

$checkpoint = Join-Path $modelDir 'sam2.1_hiera_tiny.pt'
if (-not (Test-Path -LiteralPath $checkpoint)) {
    Invoke-WebRequest -Uri 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt' -OutFile $checkpoint
}

# Shared SDXL base required by both IP-Adapter SDXL and Depth ControlNet.
# Limit the snapshot to FP16 runtime files so the offline package does not
# duplicate full-precision weights.
$sdxlBase = Join-Path $projectRoot 'models\stable-diffusion-xl-base-1.0'
$sdxlPatterns = @(
    'model_index.json','scheduler/*','tokenizer/*','tokenizer_2/*',
    'unet/config.json','unet/diffusion_pytorch_model.fp16.safetensors',
    'vae/config.json','vae/diffusion_pytorch_model.fp16.safetensors',
    'text_encoder/config.json','text_encoder/model.fp16.safetensors',
    'text_encoder_2/config.json','text_encoder_2/model.fp16.safetensors'
)
& $python -c "from huggingface_hub import snapshot_download; snapshot_download('stabilityai/stable-diffusion-xl-base-1.0', local_dir=r'$sdxlBase', allow_patterns=$($sdxlPatterns | ConvertTo-Json -Compress))"

Write-Host 'Da cai SAM 2 va checkpoint Tiny.'

