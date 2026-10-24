param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][long]$Size,
    [int]$Parts = 8
)

$ErrorActionPreference = 'Stop'
$outputPath = [System.IO.Path]::GetFullPath($Output)
$partDirectory = "$outputPath.parts"
New-Item -ItemType Directory -Path $partDirectory -Force | Out-Null
$chunkSize = [math]::Ceiling($Size / $Parts)
$processes = @()
$partInfo = @()

for ($index = 0; $index -lt $Parts; $index++) {
    $start = [long]($index * $chunkSize)
    $end = [long][math]::Min($Size - 1, (($index + 1) * $chunkSize) - 1)
    if ($start -gt $end) { break }
    $partPath = Join-Path $partDirectory ("part-{0:D3}.bin" -f $index)
    $expected = $end - $start + 1
    $partInfo += [PSCustomObject]@{ Path = $partPath; Expected = $expected; Start = $start; End = $end }
    $existing = if (Test-Path -LiteralPath $partPath) { (Get-Item -LiteralPath $partPath).Length } else { 0 }
    if ($existing -eq $expected) { continue }
    if ($existing -gt $expected) { throw "Phần tải vượt kích thước dự kiến: $partPath ($existing/$expected)." }

    $resumeStart = $start + $existing
    $resumePath = "$partPath.resume"
    if (Test-Path -LiteralPath $resumePath) { Remove-Item -LiteralPath $resumePath -Force }
    $arguments = @('-L', '--fail', '--retry', '20', '--retry-delay', '2', '--range', "$resumeStart-$end", '-o', $resumePath, $Url)
    $process = Start-Process -FilePath 'curl.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $processes += [PSCustomObject]@{ Process = $process; PartPath = $partPath; ResumePath = $resumePath }
}

foreach ($download in $processes) {
    $download.Process.WaitForExit()
    if ($download.Process.ExitCode -ne 0) { throw "Tải một phần thất bại với mã $($download.Process.ExitCode)." }
    $targetPart = [System.IO.File]::Open($download.PartPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
    try {
        $resumePart = [System.IO.File]::OpenRead($download.ResumePath)
        try { $resumePart.CopyTo($targetPart) } finally { $resumePart.Dispose() }
    } finally { $targetPart.Dispose() }
    Remove-Item -LiteralPath $download.ResumePath -Force
}

foreach ($part in $partInfo) {
    $actual = (Get-Item -LiteralPath $part.Path).Length
    if ($actual -ne $part.Expected) { throw "Sai kích thước $($part.Path): $actual/$($part.Expected)." }
}

$target = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
    foreach ($part in $partInfo) {
        $source = [System.IO.File]::OpenRead($part.Path)
        try { $source.CopyTo($target) } finally { $source.Dispose() }
    }
} finally { $target.Dispose() }

$finalSize = (Get-Item -LiteralPath $outputPath).Length
if ($finalSize -ne $Size) { throw "Tệp ghép sai kích thước: $finalSize/$Size." }
Write-Host "Đã tải và ghép: $outputPath ($finalSize bytes)"
