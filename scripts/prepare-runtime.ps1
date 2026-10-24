param([string]$Python='python',[string]$Destination=(Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\wheels'))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
& $Python -m pip wheel --wheel-dir $Destination --extra-index-url https://download.pytorch.org/whl/cu128 -r (Join-Path $root 'requirements-ai-sources.lock')
if ($LASTEXITCODE -ne 0) { throw 'Chưa dựng đủ bộ wheel. Không phát hành như một bộ cài tự chứa.' }
$files=Get-ChildItem -LiteralPath $Destination -Filter '*.whl' | ForEach-Object { [pscustomobject]@{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} }
$files | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $Destination 'checksums.json') -Encoding utf8
