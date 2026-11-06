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
foreach ($required in @('version.json','ai_service.py','app\server.js','app\public\index.html','apps\local-api\application.js','apps\local-api\infrastructure\quality-service.js','apps\local-api\queue\work-queue-runner.js','packages\runtime\version.js','packages\runtime\process-lock.js','services\ai\application.py','services\ai\prompting\catalog.py','services\ai\features\character\service.py','services\ai\features\outpaint\service.py','services\ai\quality\learning.py','workspace\prompts.json','models\registry.json','models\inpaint-candidates.json','samples\catalog.json','samples\aliases.json','scripts\manual-image-io.py','scripts\backup-sqlite.py','open_app.bat','restart-ai.ps1','vendor\LivePortrait\src\live_portrait_wrapper.py','vendor\CatVTON\model\pipeline.py','workspace\review\reference-profiles.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $required))) { $errors.Add("Thiếu thành phần chạy: $required") }
}
$versionFile = Join-Path $ReleasePath 'version.json'
foreach ($required in @('apps/local-api/application.js','apps/web/manifest.json','packages/contracts/tasks.json','packages/storage/metadata.js','services/ai/application.py','services/ai/models/state.py','services/ai/models/pipelines.py','scripts/runtime.ps1','requirements-ai.lock')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $required))) { $errors.Add("Thiếu mô-đun: $required") }
}
foreach ($entry in (Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).aiSources) {
  if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $entry))) { $errors.Add("Thiếu nguồn AI: $entry") }
}
if ((Test-Path -LiteralPath $versionFile) -and (Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).version -ne $manifest.version) { $errors.Add('Phiên bản trong gói không nhất quán.') }
if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; throw "Gói offline không hợp lệ: $($errors.Count) lỗi" }
[pscustomobject]@{ ok=$true; version=$manifest.version; checkedFiles=$manifest.files.Count; includeModels=$manifest.includeModels }
