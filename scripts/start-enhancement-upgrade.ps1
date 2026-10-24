param([ValidateRange(1024,65535)][int]$WebPort=27860,[ValidateRange(1024,65535)][int]$AiPort=27861,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if($WebPort -eq $AiPort){throw 'Web và AI cần hai cổng khác nhau.'}
$projectRoot=Split-Path -Parent $PSScriptRoot
$python=Join-Path $projectRoot '.venv-sam2\Scripts\python.exe'
$node=(Get-Command node -ErrorAction Stop).Source
$url="http://127.0.0.1:$WebPort"
$aiReady=$false;$webReady=$false
try{$aiReady=(Invoke-RestMethod "http://127.0.0.1:$AiPort/health" -TimeoutSec 3).enhanceVersion -eq 1}catch{}
try{$webHealth=Invoke-RestMethod "$url/api/health" -TimeoutSec 3;$webReady=$webHealth.enhanceVersion -eq 1 -and $webHealth.aiPort -eq $AiPort}catch{}
foreach($pair in @(@{port=$AiPort;ready=$aiReady},@{port=$WebPort;ready=$webReady})){
  if(-not $pair.ready -and (Get-NetTCPConnection -LocalPort $pair.port -State Listen -ErrorAction SilentlyContinue)){throw "Cổng $($pair.port) đang được dùng. Chọn cặp cổng khác."}
}
$previous=@{}
foreach($key in @('AI_IMAGE_PORT','AI_SEGMENT_PORT','SAM2_VARIANT','PYTHONIOENCODING')){$previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try{
  $env:AI_IMAGE_PORT="$WebPort";$env:AI_SEGMENT_PORT="$AiPort";$env:SAM2_VARIANT='tiny';$env:PYTHONIOENCODING='utf-8'
  if(-not $aiReady){$null=Start-Process -FilePath $python -ArgumentList ('"'+(Join-Path $projectRoot 'ai_service.py')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot "workspace/enhance-$AiPort.log") -RedirectStandardError (Join-Path $projectRoot "workspace/enhance-$AiPort-error.log") -PassThru}
  if(-not $webReady){$null=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $projectRoot 'app/server.js')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot "workspace/enhance-$WebPort.log") -RedirectStandardError (Join-Path $projectRoot "workspace/enhance-$WebPort-error.log") -PassThru}
}finally{foreach($key in $previous.Keys){[Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')}}
$deadline=(Get-Date).AddSeconds(55)
do{
  try{$ready=(Invoke-RestMethod "$url/api/enhance-config" -TimeoutSec 2).serviceReady -eq $true}catch{$ready=$false}
  if($ready){break};Start-Sleep -Milliseconds 750
}while((Get-Date) -lt $deadline)
if(-not $ready){throw 'Dịch vụ chưa sẵn sàng; kiểm tra nhật ký enhance trong workspace.'}
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
