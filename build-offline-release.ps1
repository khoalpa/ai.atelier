param(
  [string]$Destination = (Join-Path $PSScriptRoot 'workspace\releases'),
  [string]$InpaintModelPath = (Join-Path $PSScriptRoot 'models\text-to-image\stable-diffusion-3.5-large'),
  [switch]$IncludeModels
)

$ErrorActionPreference = 'Stop'
$appVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json).version
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseRoot = Join-Path $Destination "ai-image-offline-$appVersion-$stamp"
. (Join-Path $PSScriptRoot 'scripts\runtime.ps1')
$node = Resolve-AtelierRuntime -Root $PSScriptRoot -Kind node
& $node (Join-Path $PSScriptRoot 'scripts\build-web.js') | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Không dựng được giao diện phát hành.' }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

$required = @('version.json','service_lifecycle.py','ai_service.py','background_edit.py','character.py','character_geometry.py','character_runtime.py','character_controls.py','character_quality.py','character_workflow.py','quality_learning.py','quality_report.py','object_removal.py','catvton_inputs.py','vton_pilot.py','tryon_geometry.py','tryon_quality.py','local_request_security.py','sd35_depth_control.py','idm_vton_runtime.py','prompt_catalog.py','prompt_limits.py','processing_mode_prompts.py','outpainting.py','outpaint_quality.py','new_image.py','image_enhancement.py','skin_retouch.py','skin_edge.py','makeup.py','makeup_comparison.py','makeup_reference.py','samples','open_app.bat','start.ps1','start-all.ps1','start-ai.ps1','restart-ai.ps1','scripts','app','tests','docs','README.md','verify-offline-release.ps1','test-clean-install.ps1','install-offline.ps1','update-offline.ps1','rollback-offline.ps1')
$required += @('apps','packages','services','package.json','pnpm-lock.yaml','requirements-ai.lock','requirements-ai-sources.lock','requirements-ai-audit.json')
foreach ($item in $required) {
  $source = Join-Path $PSScriptRoot $item
  if (-not (Test-Path -LiteralPath $source)) { throw "Thiếu thành phần phát hành: $item" }
  Copy-Item -LiteralPath $source -Destination $releaseRoot -Recurse -Force
}

$characterVendorTarget=Join-Path $releaseRoot 'vendor\LivePortrait'
New-Item -ItemType Directory -Path $characterVendorTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'vendor\LivePortrait') -Force | Where-Object { $_.Name -notin @('.git','__pycache__') } | Copy-Item -Destination $characterVendorTarget -Recurse -Force

$enhanceVendorTarget = Join-Path $releaseRoot 'vendor\enhance'
New-Item -ItemType Directory -Path $enhanceVendorTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'vendor\enhance') -File | Copy-Item -Destination $enhanceVendorTarget -Force

$vendorSource = Join-Path $PSScriptRoot 'vendor\CatVTON'
$vendorTarget = Join-Path $releaseRoot 'vendor\CatVTON'
New-Item -ItemType Directory -Path $vendorTarget -Force | Out-Null
Get-ChildItem -LiteralPath $vendorSource -Force | Where-Object { $_.Name -notin @('.git','__pycache__','resource') } | Copy-Item -Destination $vendorTarget -Recurse -Force
$idmSource = Join-Path $PSScriptRoot 'vendor\IDM-VTON'
$idmTarget = Join-Path $releaseRoot 'vendor\IDM-VTON'
if (Test-Path -LiteralPath $idmSource) {
  New-Item -ItemType Directory -Path $idmTarget -Force | Out-Null
  Get-ChildItem -LiteralPath $idmSource -Force | Where-Object { $_.Name -notin @('.git','__pycache__','assets','gradio_demo','ckpt') } | Copy-Item -Destination $idmTarget -Recurse -Force
}
$profileTarget = Join-Path $releaseRoot 'workspace\review'
New-Item -ItemType Directory -Path $profileTarget -Force | Out-Null
$profileSource = Join-Path $PSScriptRoot 'workspace\review\reference-profiles.json'
if (Test-Path -LiteralPath $profileSource) {
  Copy-Item -LiteralPath $profileSource -Destination $profileTarget -Force
} else {
  '{"schemaVersion":1,"profiles":{}}' | Set-Content -LiteralPath (Join-Path $profileTarget 'reference-profiles.json') -Encoding utf8
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'workspace\prompts.json') -Destination (Join-Path $releaseRoot 'workspace\prompts.json') -Force
$referenceSource = Join-Path $PSScriptRoot 'workspace\references'
if (Test-Path -LiteralPath $referenceSource) {
  Copy-Item -LiteralPath $referenceSource -Destination (Join-Path $releaseRoot 'workspace') -Recurse -Force
}
$loraTarget = Join-Path $releaseRoot 'models\lora'
New-Item -ItemType Directory -Path $loraTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'models\lora\registry.json') -Destination $loraTarget -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'models\lora\README.md') -Destination $loraTarget -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'models\registry.json') -Destination (Join-Path $releaseRoot 'models') -Force
foreach ($catalog in @('inpaint-candidates.json','external-sources.json')) {
  $catalogSource = Join-Path $PSScriptRoot "models\$catalog"
  Copy-Item -LiteralPath $catalogSource -Destination (Join-Path $releaseRoot 'models') -Force
}

$enhanceModelTarget = Join-Path $releaseRoot 'models\enhancement'
New-Item -ItemType Directory -Path $enhanceModelTarget -Force | Out-Null
foreach ($notice in @('README.md','LICENSE.txt')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot "models\enhancement\$notice") -Destination $enhanceModelTarget -Force }

$modelChecks = @(
  @{ Name='Character Models'; Path=(Join-Path $PSScriptRoot 'models\character\installation.json') },
  @{ Name='SDXL Shared Components'; Path=(Join-Path $PSScriptRoot 'models\inpainting\stable-diffusion-xl-1.0-inpainting-0.1\model_index.json') },
  @{ Name='Makeup Face Landmarker'; Path=(Join-Path $PSScriptRoot 'models\makeup\face_landmarker.task') },
  @{ Name='SAM2'; Path=(Join-Path $PSScriptRoot 'models\segmentation\sam2.1_hiera_tiny.pt') },
  @{ Name='YOLO Pose'; Path=(Join-Path $PSScriptRoot 'models\pose\yolo11n-pose.pt') },
  @{ Name='CatVTON'; Path=(Join-Path $PSScriptRoot 'models\tryon\CatVTON') },
  @{ Name='CatVTON Base'; Path=(Join-Path $PSScriptRoot 'models\tryon\stable-diffusion-inpainting') },
  @{ Name='CatVTON VAE'; Path=(Join-Path $PSScriptRoot 'models\tryon\sd-vae-ft-mse') },
  @{ Name='SD3.5'; Path=$InpaintModelPath },
  @{ Name='Chroma1-HD'; Path=(Join-Path $PSScriptRoot 'models\flux\chroma1-hd') }
  @{ Name='SDXL Base FP16'; Path=(Join-Path $PSScriptRoot 'models\text-to-image\stable-diffusion-xl-base-1.0\unet\diffusion_pytorch_model.fp16.safetensors') }
  @{ Name='YOLO-World CLIP'; Path=(Join-Path $PSScriptRoot 'weights\clip\ViT-B-32.pt') }
)

$makeupNoticeTarget=Join-Path $releaseRoot 'models\makeup'
New-Item -ItemType Directory -Path $makeupNoticeTarget -Force | Out-Null
foreach ($notice in @('README.md','LICENSE.txt')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot "models\makeup\$notice") -Destination $makeupNoticeTarget -Force }
$models = foreach ($model in $modelChecks) {
  [pscustomobject]@{ name=$model.Name; path=$model.Path; exists=(Test-Path -LiteralPath $model.Path) }
}
if ($IncludeModels -and $models.Where({-not $_.exists}).Count) { throw 'Thiếu model; không thể tạo gói tự chứa model.' }

if ($IncludeModels) {
  $modelTarget = Join-Path $releaseRoot 'models'
  New-Item -ItemType Directory -Path $modelTarget -Force | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'models') -Force | Copy-Item -Destination $modelTarget -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'weights') -Destination $releaseRoot -Recurse -Force
}

$fileChecksums = Get-ChildItem -LiteralPath $releaseRoot -File -Recurse | ForEach-Object {
  [pscustomobject]@{ path=$_.FullName.Substring($releaseRoot.Length + 1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); size=$_.Length }
}
$manifest = [ordered]@{
  schemaVersion = 1
  version = $appVersion
  createdAt = (Get-Date).ToString('o')
  includeModels = [bool]$IncludeModels
  models = $models
  missingModels = @($models.Where({-not $_.exists}) | ForEach-Object { $_.name })
  minimumFreeDiskGb = if ($IncludeModels) { 80 } else { 5 }
  backupRecommendation = 'Chạy nút sao lưu trong ứng dụng trước khi nâng cấp.'
  files = $fileChecksums
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseRoot 'release-manifest.json') -Encoding utf8
Write-Output $releaseRoot
