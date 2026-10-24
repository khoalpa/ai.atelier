param([ValidateRange(1024,65535)][int]$WebPort=27866,[ValidateRange(1024,65535)][int]$AiPort=27867,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$null=& (Join-Path $PSScriptRoot 'start-enhancement-upgrade.ps1') -WebPort $WebPort -AiPort $AiPort -NoBrowser
$url="http://127.0.0.1:$WebPort"
$config=Invoke-RestMethod "$url/api/makeup-config" -TimeoutSec 5
if(-not $config.serviceReady){throw 'Phiên này chưa nạp Trang điểm AI. Chọn cặp cổng khác hoặc khởi động lại phiên.'}
if($config.referenceVersion -ne 1){throw 'Phiên này chưa nạp trang điểm theo ảnh tham chiếu. Khởi động lại web và AI của phiên trang điểm hoặc chọn cặp cổng mới.'}
if($config.comparisonVersion -ne 1){throw 'Phiên này chưa nạp so sánh phong cách. Khởi động lại web và AI của phiên trang điểm hoặc chọn cặp cổng mới.'}
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
