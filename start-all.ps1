$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Users\lpak\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $node)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $node = $nodeCommand.Source } else { throw 'Khong tim thay Node.js.' }
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Chua cai moi truong SAM 2.' }

$env:SAM2_VARIANT = 'tiny'
# ai_service.py resolves an explicit environment override, saved config, then its default.
$aiReady = $false
$webReady = $false
try {
  $aiHealth = Invoke-RestMethod 'http://127.0.0.1:7861/health' -TimeoutSec 2
  $aiReady = $aiHealth.ok -and $aiHealth.device -eq 'cuda' -and $aiHealth.modelsReady
} catch {}
try { $webReady = (Invoke-RestMethod 'http://127.0.0.1:7860/api/health' -TimeoutSec 2).ok } catch {}
if (-not $aiReady) { $ai = Start-Process -FilePath $python -ArgumentList (Join-Path $projectRoot 'ai_service.py') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru }
if (-not $webReady) { $web = Start-Process -FilePath $node -ArgumentList (Join-Path $projectRoot 'app\server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru }

if (-not $aiReady -or -not $webReady) { Start-Sleep -Seconds 3 }
Start-Process 'http://127.0.0.1:7860'
if ($ai) { Write-Host "AI service PID: $($ai.Id)" } else { Write-Host 'AI service dang chay.' }
if ($web) { Write-Host "Web service PID: $($web.Id)" } else { Write-Host 'Web service dang chay.' }
Write-Host 'Ung dung dang chay tai http://127.0.0.1:7860'

