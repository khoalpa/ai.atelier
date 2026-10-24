# Shared runtime discovery for launch, restart and release verification.
function Resolve-AtelierRuntime {
    param([Parameter(Mandatory=$true)][string]$Root,[ValidateSet('node','python')][string]$Kind)
    $override = if ($Kind -eq 'node') { $env:ATELIER_NODE } else { $env:ATELIER_PYTHON }
    $candidates = if ($override) { @($override) } elseif ($Kind -eq 'node') {
        @((Join-Path $Root 'runtime\node\node.exe'), 'node')
    } else { @((Join-Path $Root '.venv-sam2\Scripts\python.exe'), (Join-Path $Root 'runtime\python\python.exe'), 'python') }
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $executable = $command.Source
            if ($Kind -eq 'node') {
                & $executable -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>24||(a===24&&b>=15)?0:1)"
            } else { & $executable -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 10) else 1)' }
            if ($LASTEXITCODE -eq 0) { return $executable }
        }
    }
    throw "Không tìm thấy runtime $Kind phù hợp. Cần Node.js 24.15+ hoặc Python 3.10; có thể đặt ATELIER_NODE / ATELIER_PYTHON."
}
