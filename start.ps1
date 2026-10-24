$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot 'scripts\runtime.ps1')
$nodeExecutable = Resolve-AtelierRuntime -Root $projectRoot -Kind node

Write-Host 'Khoi dong AI Image Mask POC tai http://127.0.0.1:7860'
Write-Host 'Nhan Ctrl+C de dung.'
Start-Process 'http://127.0.0.1:7860'
& $nodeExecutable (Join-Path $projectRoot 'app\server.js')

