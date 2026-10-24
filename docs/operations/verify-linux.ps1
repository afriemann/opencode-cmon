[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{7,40}$')]
    [string]$Revision,
    [switch]$Verify
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location $root
$id = 'cmon-linux-' + [guid]::NewGuid().ToString('N')
$scratch = Join-Path $root "node_modules/.cache/cmon-linux/$id"
New-Item -ItemType Directory -Force $scratch | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
function Invoke-Finite([string]$Exe, [string[]]$Arguments, [int]$Seconds, [string]$Name) {
    $info = [Diagnostics.ProcessStartInfo]::new($Exe)
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    $p = [Diagnostics.Process]::new()
    $p.StartInfo = $info
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEndAsync()
    $stderr = $p.StandardError.ReadToEndAsync()
    $finished = $p.WaitForExit($Seconds * 1000)
    if (!$finished) { $p.Kill($true); $p.WaitForExit() }
    [IO.File]::WriteAllText((Join-Path $scratch "$Name.log"), $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult(), $utf8)
    $rc = if ($finished) { $p.ExitCode } else { 124 }
    Add-Content (Join-Path $scratch 'host-exits.log') "$Name exit=$rc"
    if ($rc -ne 0) { throw "$Name failed ($rc); see $scratch" }
}
$imageCreated = $false
$containerAttempted = $false
try {
    # Accept only hexadecimal commit IDs; resolve once so no moving ref can drift.
    Invoke-Finite git @('rev-parse', '--verify', '--end-of-options', "$Revision^{commit}") 15 'candidate-resolve'
    $candidate = [IO.File]::ReadAllText((Join-Path $scratch 'candidate-resolve.log')).Trim()
    if ($candidate -cnotmatch '^[0-9a-f]{40}$') { throw 'Revision did not resolve to one full commit SHA' }
    [IO.File]::WriteAllText((Join-Path $scratch 'requested-revision.txt'), "$Revision`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $scratch 'candidate.txt'), "$candidate`n", $utf8)
    Copy-Item (Join-Path $PSScriptRoot 'verification.Dockerfile') (Join-Path $scratch 'Dockerfile')
    Invoke-Finite docker @('build', '--platform', 'linux/amd64', '--pull', '--tag', $id, $scratch) 300 'image-build'
    $imageCreated = $true
    Invoke-Finite docker @('image', 'inspect', $id) 20 'image-identity'
    # Normalize only the operations runner, never candidate files.
    $script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'verify-linux.sh')).Replace("`r`n", "`n")
    [IO.File]::WriteAllText((Join-Path $scratch 'verify-linux.sh'), $script, $utf8)
    Get-FileHash -Algorithm SHA256 (Join-Path $scratch 'Dockerfile'), (Join-Path $scratch 'verify-linux.sh'), $PSCommandPath |
        Format-List | Out-String | Set-Content (Join-Path $scratch 'runner-hashes.txt')
    $containerAttempted = $true
    if ($Verify) {
        Invoke-Finite git @('archive', '--format=zip', "--output=$scratch/candidate.zip", $candidate) 30 'archive'
        Get-FileHash -Algorithm SHA256 (Join-Path $scratch 'candidate.zip') |
            Format-List | Out-String | Set-Content (Join-Path $scratch 'source-snapshot-hash.txt')
        Expand-Archive -LiteralPath (Join-Path $scratch 'candidate.zip') -DestinationPath (Join-Path $scratch 'source')
        Invoke-Finite docker @('run', '--name', $id, '--rm', '--platform', 'linux/amd64', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=6g', '--cpus=2', '--tmpfs', '/work:rw,exec,size=4g', '--mount', "type=bind,source=$scratch,target=/input,readonly", '--mount', "type=bind,source=$scratch,target=/evidence", $id, 'timeout', '--signal=TERM', '--kill-after=10s', '1450s', 'bash', '/input/verify-linux.sh') 1500 'verification'
    } else {
        Invoke-Finite docker @('run', '--name', $id, '--rm', '--network=none', '--platform', 'linux/amd64', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--mount', "type=bind,source=$scratch/verify-linux.sh,target=/probe.sh,readonly", $id, 'timeout', '20s', 'sh', '-ec', 'uname -m; bun --version; bun --revision; node --version; timeout --version | head -n 1; bash -n /probe.sh') 30 'readiness'
    }
} finally {
    # Remove only this invocation's named resources; no global prune or volume deletion.
    if ($containerAttempted) {
        $ErrorActionPreference = 'Continue'
        try { Invoke-Finite docker @('rm', '--force', $id) 20 'container-remove' } catch { }
        $ErrorActionPreference = 'Stop'
        Invoke-Finite docker @('ps', '-aq', '--filter', "name=^/$id`$") 20 'cleanup-check'
        if ((Get-Item (Join-Path $scratch 'cleanup-check.log')).Length -gt 0) { throw "Container cleanup uncertain: $id" }
    }
    if ($imageCreated) { Invoke-Finite docker @('image', 'rm', $id) 30 'image-remove' }
    Write-Host "Evidence: $scratch"
}
