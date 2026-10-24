[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='Medium')]
param(
  [switch]$CheckOnly,
  [ValidateRange(1,65535)][int]$AiPort = 7861,
  [ValidateRange(1,65535)][int]$WebPort = 7860,
  [ValidateRange(10,300)][int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$entry = Join-Path $projectRoot 'ai_service.py'
$aiUrl = "http://127.0.0.1:$AiPort"
$webUrl = "http://127.0.0.1:$WebPort"
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $entry)) {
  throw 'Thiếu môi trường Python hoặc mã dịch vụ AI trong dự án.'
}

function Assert-AtelierIdle {
  $jobs = Invoke-RestMethod "$webUrl/api/jobs" -TimeoutSec 5
  $queues = Invoke-RestMethod "$webUrl/api/work-queue" -TimeoutSec 5
  if ($null -eq $jobs.jobs -or $jobs.jobs -isnot [array] -or $null -eq $queues.items -or $queues.items -isnot [array]) {
    throw 'Không đọc được danh sách tác vụ. Giữ nguyên dịch vụ AI.'
  }
  if (@($jobs.jobs | Where-Object { $_.status -in @('running','cancelling','queued') }).Count -or
      @($queues.items | Where-Object { $_.status -in @('running','queued') }).Count) {
    throw 'Còn tác vụ hoặc lô ảnh đang chạy. Đợi hoàn tất rồi thử lại.'
  }
}

function Get-AtelierAiProcess {
  $health = Invoke-RestMethod "$aiUrl/health" -TimeoutSec 5
  if (-not $health.ok -or [int]$health.pid -le 0) { throw 'Dịch vụ AI không trả về trạng thái hợp lệ.' }
  $service = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$health.pid)"
  if (-not $service -or $service.CommandLine -notmatch '(?i)(^|[\\/\s"''])ai_service\.py(["'']|\s|$)') {
    throw 'Tiến trình trên cổng AI không phải dịch vụ ai_service.py.'
  }
  $launcher = Get-CimInstance Win32_Process -Filter "ProcessId=$($service.ParentProcessId)"
  if ($service.ExecutablePath -ne $python -and $launcher.ExecutablePath -ne $python) {
    throw 'Không xác nhận được dịch vụ thuộc môi trường Python của dự án này.'
  }
  [pscustomobject]@{ Health=$health; Process=$service }
}

Assert-AtelierIdle
$before = Get-AtelierAiProcess
if ($CheckOnly) {
  [pscustomobject]@{
    ok=$true; pid=$before.Process.ProcessId
    manualCutoutReady=($before.Health.manualCutoutVersion -ge 1)
    action='check-only'; serviceChanged=$false
  }
  return
}
if (-not $PSCmdlet.ShouldProcess("Dịch vụ AI của $projectRoot (PID $($before.Process.ProcessId))", 'Khởi động lại')) { return }

# Preflight before stopping the existing service; it does not load a model.
& $python -X utf8 -c 'import torch; assert torch.cuda.is_available(), "CUDA is unavailable"'
if ($LASTEXITCODE -ne 0) { throw 'Môi trường CUDA chưa sẵn sàng. Giữ nguyên dịch vụ đang chạy.' }
$logDirectory = Join-Path $projectRoot 'workspace\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdout = Join-Path $logDirectory "ai-$stamp.stdout.log"
$stderr = Join-Path $logDirectory "ai-$stamp.stderr.log"
Assert-AtelierIdle
$current = Get-AtelierAiProcess
if ($current.Process.ProcessId -ne $before.Process.ProcessId -or $current.Process.CreationDate -ne $before.Process.CreationDate) {
  throw 'Dịch vụ đã thay đổi trong lúc kiểm tra. Hãy chạy lại lệnh.'
}

Stop-Process -Id $current.Process.ProcessId -ErrorAction Stop
Wait-Process -Id $current.Process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
$previousPort = $env:AI_SEGMENT_PORT
$previousVariant = $env:SAM2_VARIANT
try {
  $env:AI_SEGMENT_PORT = [string]$AiPort
  $env:SAM2_VARIANT = if ($before.Health.variant) { [string]$before.Health.variant } else { 'tiny' }
  $started = Start-Process -FilePath $python -ArgumentList @('-X','utf8','ai_service.py') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  $env:AI_SEGMENT_PORT = $previousPort
  $env:SAM2_VARIANT = $previousVariant
}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Milliseconds 500
  try {
    $after = Get-AtelierAiProcess
    if ($after.Health.version -eq (Get-Content -LiteralPath (Join-Path $projectRoot 'version.json') -Raw | ConvertFrom-Json).version -and $after.Health.manualCutoutVersion -ge 1 -and $after.Process.ProcessId -ne $before.Process.ProcessId) {
      [pscustomobject]@{ ok=$true; pid=$after.Process.ProcessId; manualCutoutReady=$true; serviceChanged=$true; stdout=$stdout; stderr=$stderr }
      return
    }
  } catch { }
  if ($started.HasExited) { break }
} while ((Get-Date) -lt $deadline)
throw "Chưa xác nhận được dịch vụ mới. Xem nhật ký: $stderr. Có thể mở lại bằng .\start-ai.ps1."
