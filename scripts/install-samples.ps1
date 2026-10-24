param([Parameter(Mandatory=$true)][string]$SourceRoot,[Parameter(Mandatory=$true)][string]$TargetRoot)
$ErrorActionPreference = 'Stop'
function Get-SampleHash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}
$sampleSource = [IO.Path]::GetFullPath((Join-Path $SourceRoot 'samples'))
$sampleTarget = [IO.Path]::GetFullPath((Join-Path $TargetRoot 'samples'))
if ($sampleSource -eq $sampleTarget) { throw 'Thu muc nguon va dich phai khac nhau.' }
$incoming = Get-Content -LiteralPath (Join-Path $sampleSource 'catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$incomingAliases = Get-Content -LiteralPath (Join-Path $sampleSource 'aliases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($incoming.schemaVersion -ne 2) { throw 'Danh muc anh mau khong duoc ho tro.' }
$assets = [ordered]@{}
$aliases = [ordered]@{}
$existingFile = Join-Path $sampleTarget 'catalog.json'
if (Test-Path -LiteralPath $existingFile) {
  $existing = Get-Content -LiteralPath $existingFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($asset in $existing.assets) { $assets[$asset.id] = $asset }
  $existingAliases = Get-Content -LiteralPath (Join-Path $sampleTarget 'aliases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($entry in $existingAliases.aliases.PSObject.Properties) { $aliases[$entry.Name] = $entry.Value }
} elseif (Test-Path -LiteralPath $sampleTarget) {
  foreach ($file in Get-ChildItem -LiteralPath $sampleTarget -Recurse -File | Where-Object { $_.Extension -match '^\.(png|jpe?g|webp)$' }) {
    $id = $file.FullName.Substring($sampleTarget.Length + 1).Replace('\','/')
    $assets[$id] = [ordered]@{id=$id;path=$id;storage='samples';label=$file.Name;group='Legacy';roles=@('legacy');tasks=@();sha256=(Get-SampleHash $file.FullName);bytes=$file.Length;provenance=@{license='unverified';redistributable=$false}}
    $aliases[$id] = $id
  }
}
foreach ($asset in $incoming.assets) {
  if ($assets.Contains($asset.id) -and $assets[$asset.id].sha256 -ne $asset.sha256) { throw "Anh da thay doi noi dung voi cung ma: $($asset.id)" }
}
# Validate all destinations before any copy; preserve existing image bytes.
$copies = @()
foreach ($file in Get-ChildItem -LiteralPath $sampleSource -Recurse -File) {
  $relative = $file.FullName.Substring($sampleSource.Length + 1)
  if ($relative -in @('catalog.json','aliases.json')) { continue }
  $destination = [IO.Path]::GetFullPath((Join-Path $sampleTarget $relative))
  if (-not $destination.StartsWith($sampleTarget + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Duong dan vuot thu muc anh mau.' }
  if ((Test-Path -LiteralPath $destination) -and $file.Extension -match '^\.(png|jpe?g|webp)$') {
    if ((Get-SampleHash $destination) -ne (Get-SampleHash $file.FullName)) { throw "Anh dich da co noi dung khac: $relative" }
  }
  $copies += @{source=$file.FullName;target=$destination}
}
foreach ($copy in $copies) {
  New-Item -ItemType Directory -Path (Split-Path $copy.target) -Force | Out-Null
  Copy-Item -LiteralPath $copy.source -Destination $copy.target -Force
}
foreach ($asset in $incoming.assets) { $assets[$asset.id] = $asset }
foreach ($entry in $incomingAliases.aliases.PSObject.Properties) { $aliases[$entry.Name] = $entry.Value }
New-Item -ItemType Directory -Path $sampleTarget -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $sampleTarget 'aliases.json'),(@{schemaVersion=1;aliases=$aliases} | ConvertTo-Json -Depth 100),$utf8)
[IO.File]::WriteAllText((Join-Path $sampleTarget 'catalog.json'),(@{schemaVersion=2;assets=@($assets.Values)} | ConvertTo-Json -Depth 100),$utf8)
[pscustomobject]@{sampleAssets=$assets.Count;historicalAliases=$aliases.Count}
