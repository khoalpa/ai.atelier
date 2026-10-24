param([ValidateRange(1024,65535)][int]$WebPort=57860,[ValidateRange(1024,65535)][int]$AiPort=7861,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if($WebPort -eq $AiPort){throw 'Web và AI cần hai cổng khác nhau.'}
$projectRoot=Split-Path -Parent $PSScriptRoot
$url="http://127.0.0.1:$WebPort"
$ready=$false
try{$ready=(Invoke-RestMethod "$url/api/quality-learning/state" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5).version -eq 1}catch{}
if(-not $ready){
  if(Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue){throw "Cổng $WebPort đang được dùng. Chọn WebPort khác."}
  $previousWeb=[Environment]::GetEnvironmentVariable('AI_IMAGE_PORT','Process')
  $previousAi=[Environment]::GetEnvironmentVariable('AI_SEGMENT_PORT','Process')
  try{
    $env:AI_IMAGE_PORT="$WebPort";$env:AI_SEGMENT_PORT="$AiPort"
    $node=(Get-Command node -ErrorAction Stop).Source
    $null=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $projectRoot 'app/server.js')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot "workspace/quality-web-$WebPort.log") -RedirectStandardError (Join-Path $projectRoot "workspace/quality-web-$WebPort-error.log") -PassThru
  }finally{
    [Environment]::SetEnvironmentVariable('AI_IMAGE_PORT',$previousWeb,'Process')
    [Environment]::SetEnvironmentVariable('AI_SEGMENT_PORT',$previousAi,'Process')
  }
  $deadline=(Get-Date).AddSeconds(20)
  do{
    try{$ready=(Invoke-RestMethod "$url/api/quality-learning/state" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3).version -eq 1}catch{}
    if($ready){break}
    Start-Sleep -Milliseconds 500
  }while((Get-Date) -lt $deadline)
}
if(-not $ready){throw 'Bộ kiểm tra chất lượng chưa sẵn sàng; kiểm tra nhật ký quality-web trong workspace.'}
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
