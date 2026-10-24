$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
& $python (Join-Path $PSScriptRoot 'setup_idm_vton.py')
if ($LASTEXITCODE -ne 0) { throw 'IDM-VTON setup failed.' }
