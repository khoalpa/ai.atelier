$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptUnderTest = Join-Path $projectRoot 'restart-ai.ps1'
if (Get-Variable AtelierRestartTestFixture -Scope Global -ErrorAction SilentlyContinue) { throw 'Test fixture already exists' }
$global:AtelierRestartTestFixture = @{}
$script:checks = 0

# All service and process calls are replaced; these tests never stop or start services.
function Invoke-RestMethod {
  param($Uri, $TimeoutSec)
  if ($Uri.EndsWith('/api/jobs')) { return $global:AtelierRestartTestFixture.jobs }
  if ($Uri.EndsWith('/api/work-queue')) { return $global:AtelierRestartTestFixture.queues }
  if ($Uri.EndsWith('/health')) { return $global:AtelierRestartTestFixture.health }
  throw "Unexpected request: $Uri"
}
function Get-CimInstance {
  param($ClassName, $Filter)
  if ($Filter -eq 'ProcessId=1234') { return $global:AtelierRestartTestFixture.process }
  if ($Filter -eq 'ProcessId=5678') { return $global:AtelierRestartTestFixture.launcher }
  throw "Unexpected process: $Filter"
}
function Stop-Process { throw 'Test must never stop a process' }
function Start-Process { throw 'Test must never start a process' }
function Reset-Fixture {
  $global:AtelierRestartTestFixture = @{
    jobs=[pscustomobject]@{jobs=@()}
    queues=[pscustomobject]@{items=@()}
    health=[pscustomobject]@{ok=$true;pid=1234;manualCutoutVersion=0;variant='tiny'}
    process=[pscustomobject]@{ProcessId=1234;ParentProcessId=5678;ExecutablePath='C:\Python\python.exe';CommandLine='python.exe -X utf8 ai_service.py'}
    launcher=[pscustomobject]@{ExecutablePath=(Join-Path $projectRoot '.venv-sam2\Scripts\python.exe')}
  }
}
function Assert-Rejected($Expected) {
  $message = ''
  try { $null = & $scriptUnderTest -CheckOnly } catch { $message = $_.Exception.Message }
  if (-not $message.Contains($Expected)) { throw "Expected '$Expected', got '$message'" }
  $script:checks++
}

try {
Reset-Fixture
$result = & $scriptUnderTest -CheckOnly
if (-not $result.ok -or $result.serviceChanged -or $result.manualCutoutReady) { throw 'Check-only changed the service or misreported the old version' }
$script:checks++
$global:AtelierRestartTestFixture.health.manualCutoutVersion = 1
$result = & $scriptUnderTest -CheckOnly
if (-not $result.manualCutoutReady -or $result.serviceChanged) { throw 'Updated service was not detected' }
$script:checks++
foreach ($status in @('running','cancelling','queued')) {
  Reset-Fixture
  $global:AtelierRestartTestFixture.jobs.jobs = @([pscustomobject]@{status=$status})
  Assert-Rejected 'Còn tác vụ'
}
Reset-Fixture
$global:AtelierRestartTestFixture.queues.items = @([pscustomobject]@{status='running'})
Assert-Rejected 'Còn tác vụ'
Reset-Fixture
$global:AtelierRestartTestFixture.jobs = [pscustomobject]@{unexpected=@()}
Assert-Rejected 'Không đọc được danh sách'
Reset-Fixture
$global:AtelierRestartTestFixture.launcher.ExecutablePath = 'C:\another-project\python.exe'
Assert-Rejected 'Không xác nhận được dịch vụ'
Reset-Fixture
$global:AtelierRestartTestFixture.process.CommandLine = 'python.exe different_service.py'
Assert-Rejected 'không phải dịch vụ'
Reset-Fixture
$null = & $scriptUnderTest -WhatIf
$script:checks++
[pscustomobject]@{ok=$true;passed=$script:checks;serviceChanged=$false}

} finally { Remove-Variable AtelierRestartTestFixture -Scope Global -ErrorAction SilentlyContinue }
