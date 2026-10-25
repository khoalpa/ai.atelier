# Shared runtime discovery for launch, restart and release verification.
function Resolve-AtelierRuntime {
    param([Parameter(Mandatory=$true)][string]$Root,[ValidateSet('node','python')][string]$Kind)
    $override = if ($Kind -eq 'node') { $env:ATELIER_NODE } else { $env:ATELIER_PYTHON }
    $candidates = if ($override) { @($override) } elseif ($Kind -eq 'node') {
        $nodeCandidates = @(
            (Join-Path $Root 'runtime\node\node.exe'),
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
            (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
        )
        if (${env:ProgramFiles(x86)}) {
            $nodeCandidates += Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'
        }
        $nodeCandidates + 'node'
    } else {
        $pythonCandidates = @((Join-Path $Root '.venv-sam2\Scripts\python.exe'), (Join-Path $Root 'runtime\python\python.exe'))

        # On Windows, a real Python installation can be registered only with
        # py.exe while `python.exe` is the non-functional Microsoft Store alias.
        $launcher = Get-Command 'py.exe' -ErrorAction SilentlyContinue
        if ($launcher) {
            $launchedPython = @(& $launcher.Source -3.10 -c 'import sys; print(sys.executable)' 2>$null)
            if ($LASTEXITCODE -eq 0 -and $launchedPython) {
                $pythonCandidates += [string]$launchedPython[-1]
            }
        }
        $pythonCandidates + 'python'
    }
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
    # Keep launcher diagnostics ASCII-compatible because Windows PowerShell 5.1
    # reads UTF-8 files without a BOM using the active legacy code page.
    if ($Kind -eq 'node') {
        throw 'Khong tim thay Node.js 24.15 tro len. Hay dat ATELIER_NODE den tep node.exe.'
    }
    throw 'Khong tim thay Python 3.10. Hay dat ATELIER_PYTHON den tep python.exe.'
}
