param([switch]$Offline)
$ErrorActionPreference='Stop'
$characterRoot=Split-Path -Parent $PSScriptRoot
$characterPython=Join-Path $characterRoot '.venv-sam2\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $characterPython)) { throw 'Chay scripts/setup-ai.ps1 truoc.' }
if ($Offline) {
  & $characterPython -X utf8 (Join-Path $PSScriptRoot 'setup-character.py') --offline
} else {
  & $characterPython -m pip install 'timm==1.0.30' 'einops==0.8.2' 'PyYAML==6.0.3' 'rich==15.0.0'
  if ($LASTEXITCODE -ne 0) { throw 'Khong cai duoc thu vien xu ly nhan vat.' }
  & $characterPython -X utf8 (Join-Path $PSScriptRoot 'setup-character.py')
}
if ($LASTEXITCODE -ne 0) { throw 'Chuan bi model nhan vat chua hoan tat.' }
$characterCheck = @'
import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import character_runtime as c
state=c.configuration(Path(sys.argv[1]))
print(state)
sys.exit(0 if state['faceReady'] and state['bodyReady'] else 1)
'@
$characterCheck | & $characterPython -X utf8 - $characterRoot
if ($LASTEXITCODE -ne 0) { throw 'Thieu thanh phan dung chung. Chay setup-ai.ps1, setup-makeup.ps1 va chuan bi SDXL inpainting truoc (xem README).' }
Write-Output 'Tu the va bieu cam san sang. Ollama qwen3:4b doc mo ta; llava:7b goi y trang phuc (tuy chon).'
