param(
  [ValidateRange(1024,65535)][int]$WebPort = 37860,
  [ValidateRange(1024,65535)][int]$AiPort = 37861,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
if ($WebPort -eq $AiPort) { throw 'Web và AI cần hai cổng khác nhau.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $python)) { throw 'Chưa có môi trường Python của dự án.' }
$url = "http://127.0.0.1:$WebPort"
$aiReady = $false
$webReady = $false
try { $health = Invoke-RestMethod "http://127.0.0.1:$AiPort/health" -TimeoutSec 3; $aiReady = $health.ok -and $health.outpaintVersion -eq 2 } catch {}
try { $webReady = (Invoke-RestMethod "$url/api/outpaint-config" -TimeoutSec 3).version -eq 2 } catch {}
foreach ($pair in @(@{port=$AiPort;ready=$aiReady},@{port=$WebPort;ready=$webReady})) {
  if (-not $pair.ready -and (Get-NetTCPConnection -LocalPort $pair.port -State Listen -ErrorAction SilentlyContinue)) {
    throw "Cổng $($pair.port) đang được dùng bởi phiên khác. Chọn cặp cổng khác; không tự dừng phiên đang chạy."
  }
}
if (-not $aiReady) {
  $running = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'workspace/jobs') -Filter '*.json' | Where-Object { $_.Name -notlike '*.request.json' } | ForEach-Object {
    try { $job = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json; if ($job.status -in @('running','cancelling')) { $job.jobId } } catch {}
  })
  if ($running.Count) { throw 'Hãy đợi tác vụ AI đang chạy hoàn tất trước khi mở phiên AI mới.' }
}
$previous = @{}
foreach ($key in @('AI_IMAGE_PORT','AI_SEGMENT_PORT','SAM2_VARIANT','PYTHONIOENCODING')) { $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
try {
  $env:AI_IMAGE_PORT = "$WebPort"
  $env:AI_SEGMENT_PORT = "$AiPort"
  $env:SAM2_VARIANT = 'tiny'
  $env:PYTHONIOENCODING = 'utf-8'
  if (-not $aiReady) {
    $null = Start-Process -FilePath $python -ArgumentList ('"' + (Join-Path $projectRoot 'ai_service.py') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  }
  if (-not $webReady) {
    $null = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $projectRoot 'app/server.js') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  }
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
}
$deadline = (Get-Date).AddSeconds(60)
do {
  try { $ready = (Invoke-RestMethod "$url/api/outpaint-config" -TimeoutSec 3).serviceReady -eq $true } catch { $ready = $false }
  if ($ready) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not $ready) { throw "Dịch vụ chưa sẵn sàng sau 60 giây. Kiểm tra phiên tại $url." }
if (-not $NoBrowser) { Start-Process $url }
Write-Output $url
