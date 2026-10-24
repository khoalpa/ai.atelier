param([string]$BasePython='python',[string]$Environment=(Join-Path (Split-Path $PSScriptRoot -Parent) '.venv-sam2'),[string]$Wheelhouse=(Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\wheels'))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if (Test-Path -LiteralPath $Environment) { throw 'Thư mục môi trường đã tồn tại. Chọn -Environment mới để giữ bản hiện tại.' }
& $BasePython -c 'import sys; assert sys.version_info[:2] == (3,10), "Requires Python 3.10"'
if ($LASTEXITCODE -ne 0) { throw 'Cần Python 3.10 để cài bộ thư viện đã khóa.' }
if (-not (Test-Path -LiteralPath $Wheelhouse)) { throw 'Thiếu thư mục wheel offline. Chuẩn bị bằng prepare-runtime.ps1 trên máy có mạng.' }
$checksums=Join-Path $Wheelhouse 'checksums.json'
if (-not (Test-Path -LiteralPath $checksums)) { throw 'Thiếu danh sách checksum của bộ wheel.' }
foreach ($entry in (Get-Content -LiteralPath $checksums -Raw | ConvertFrom-Json)) {
    if ([IO.Path]::GetFileName($entry.name) -ne $entry.name) { throw 'Tên wheel không hợp lệ.' }
    $file=Join-Path $Wheelhouse $entry.name
    if (-not (Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Wheel thiếu hoặc sai checksum: $($entry.name)" }
}
& $BasePython -m venv $Environment
if ($LASTEXITCODE -ne 0) { throw 'Không tạo được môi trường Python riêng.' }
$python=Join-Path $Environment 'Scripts\python.exe'
& $python -m pip install --no-index --find-links $Wheelhouse -r (Join-Path $root 'requirements-ai.lock')
if ($LASTEXITCODE -ne 0) { throw 'Bộ wheel chưa đủ. Môi trường cũ được giữ nguyên.' }
Push-Location $root
try { & $python -c 'from services.ai.application import main; import torch; print("AI imports OK; CUDA:", torch.cuda.is_available())'; if ($LASTEXITCODE -ne 0) { throw 'Môi trường mới chưa nạp được ứng dụng.' } } finally { Pop-Location }
Write-Output "Môi trường sẵn sàng: $python"
