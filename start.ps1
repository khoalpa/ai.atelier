$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = 'C:\Users\lpak\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeExecutable = (Get-Command node).Source
} elseif (Test-Path -LiteralPath $bundledNode) {
    $nodeExecutable = $bundledNode
} else {
    throw 'Khong tim thay Node.js. Hay cai Node.js 20+ hoac cap nhat duong dan trong start.ps1.'
}

Write-Host 'Khoi dong AI Image Mask POC tai http://127.0.0.1:7860'
Write-Host 'Nhan Ctrl+C de dung.'
Start-Process 'http://127.0.0.1:7860'
& $nodeExecutable (Join-Path $projectRoot 'app\server.js')

