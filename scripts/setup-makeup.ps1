param([switch]$Offline)
$ErrorActionPreference='Stop'
$makeupRoot=Split-Path -Parent $PSScriptRoot
$makeupPython=Join-Path $makeupRoot '.venv-sam2\Scripts\python.exe'
if(-not $Offline){
  # Keep the project's existing OpenCV/Numpy/Torch versions intact.
  & $makeupPython -m pip install --no-deps mediapipe==0.10.32 absl-py==2.3.1
  if($LASTEXITCODE -ne 0){throw 'Không cài được bộ nhận diện.'}
  & $makeupPython -m pip install matplotlib==3.10.9
  if($LASTEXITCODE -ne 0){throw 'Không cài được phụ thuộc nhận diện.'}
  & ollama pull qwen3:4b
  if($LASTEXITCODE -ne 0){throw 'Không tải được bộ đọc mô tả. Kiểm tra Ollama rồi chạy lại.'}
}
$makeupModel=Join-Path $makeupRoot 'models\makeup\face_landmarker.task'
$expected='64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
if(-not (Test-Path -LiteralPath $makeupModel)){
  if($Offline){throw 'Thiếu model nhận diện khuôn mặt trong gói offline.'}
  New-Item -ItemType Directory -Path (Split-Path $makeupModel) -Force | Out-Null
  Invoke-WebRequest -Uri 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' -OutFile "$makeupModel.partial"
  if((Get-FileHash -LiteralPath "$makeupModel.partial" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Model tải về không đúng checksum.'}
  Move-Item -LiteralPath "$makeupModel.partial" -Destination $makeupModel
}
if((Get-FileHash -LiteralPath $makeupModel -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Model khuôn mặt không đúng checksum.'}
& $makeupPython -c 'import mediapipe; print("Face landmarks ready:", mediapipe.__version__)'
if($LASTEXITCODE -ne 0){throw 'Bộ nhận diện khuôn mặt chưa sẵn sàng.'}
$makeupTags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
if(-not ($makeupTags.models | Where-Object {$_.name -eq 'qwen3:4b'})){throw 'Chưa có bộ đọc mô tả qwen3:4b trong Ollama. Các phong cách có sẵn vẫn dùng được.'}
Write-Output 'Trang điểm đã sẵn sàng. Chạy scripts/start-makeup.ps1.'
