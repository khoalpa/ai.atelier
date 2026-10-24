param([ValidateRange(1024,65535)][int]$WebPort=27864,[ValidateRange(1024,65535)][int]$AiPort=27865,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$null=& (Join-Path $PSScriptRoot 'start-enhancement-upgrade.ps1') -WebPort $WebPort -AiPort $AiPort -NoBrowser
$url="http://127.0.0.1:$WebPort"
$config=Invoke-RestMethod "$url/api/enhance-config" -TimeoutSec 5
if($config.edgeVersion -ne 1){throw 'Phiên này chưa nạp công cụ làm rõ viền. Khởi động lại phiên hoặc chọn cặp cổng khác.'}
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
