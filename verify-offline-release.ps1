param([string]$ReleasePath = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $ReleasePath 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Không tìm thấy release-manifest.json' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$errors = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $manifest.files) {
  $target = Join-Path $ReleasePath $entry.path
  if (-not (Test-Path -LiteralPath $target)) { $errors.Add("Thiếu tệp: $($entry.path)"); continue }
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $entry.sha256) { $errors.Add("Sai checksum: $($entry.path)") }
}
foreach ($required in @('version.json','service_lifecycle.py','app\work-queue-runner.js','app\service-manager.js','app\runtime-version.js','app\process-lock.js','app\acceptance-store.js','app\background-renderer.js','app\render-host.js','app\public\background-render.html','app\public\background-render.js','app\public\acceptance.js','app\public\acceptance.css','app\public\service-manager.js','open_app.bat','restart-ai.ps1','ai_service.py','background_edit.py','character.py','character_geometry.py','character_runtime.py','character_controls.py','character_quality.py','character_workflow.py','quality_learning.py','quality_report.py','catvton_inputs.py','vton_pilot.py','tryon_geometry.py','tryon_quality.py','idm_vton_runtime.py','local_request_security.py','sd35_depth_control.py','prompt_catalog.py','prompt_limits.py','processing_mode_prompts.py','outpainting.py','outpaint_quality.py','workspace\prompts.json','models\registry.json','models\inpaint-candidates.json','samples\characters\c001.png','app\server.js','app\manual-store.js','app\backup-store.js','app\asset-catalog.js','app\region-store.js','app\work-queue-store.js','app\export-presets.js','app\public\export-core.js','app\public\export-studio.js','app\public\manual-workflow.js','app\public\work-queue.js','app\public\library.js','app\public\shared-regions.js','app\public\creative-review.js','app\public\backup-ui.js','app\public\styles\workflow.css','app\public\manual-core.js','app\public\manual-worker.js','app\public\manual-editor.js','app\public\manual-editor.html','app\public\styles\manual-editor.css','scripts\manual-image-io.py','scripts\backup-sqlite.py','app\character-plan.js','app\character-presets.js','app\character-refine.js','app\public\character-extra.js','app\public\character.js','app\public\styles\character.css','vendor\LivePortrait\src\live_portrait_wrapper.py','app\request-security.js','app\output-assets.js','app\product-reference-review.js','app\public\index.html','vendor\CatVTON\model\pipeline.py','workspace\review\reference-profiles.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $required))) { $errors.Add("Thiếu thành phần chạy: $required") }
}
$versionFile = Join-Path $ReleasePath 'version.json'
if ((Test-Path -LiteralPath $versionFile) -and (Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).version -ne $manifest.version) { $errors.Add('Phiên bản trong gói không nhất quán.') }
if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; throw "Gói offline không hợp lệ: $($errors.Count) lỗi" }
[pscustomobject]@{ ok=$true; version=$manifest.version; checkedFiles=$manifest.files.Count; includeModels=$manifest.includeModels }
