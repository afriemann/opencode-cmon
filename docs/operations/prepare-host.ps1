[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{7,40}$')]
    [string]$Revision,
    # Optional independently supplied Python acceptance runner; never created here.
    [string]$Driver
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$id = 'cmon-host-' + [guid]::NewGuid().ToString('N')
$scratch = Join-Path $root "node_modules/.cache/cmon-host/$id"
New-Item -ItemType Directory -Force $scratch | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
function Run([string]$Exe, [string[]]$Arguments, [int]$Seconds, [string]$Name) {
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
    $text = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
    # Keep a bounded diagnostic tail. Drivers must bound their own evidence files.
    if ($text.Length -gt 262144) { $text = '[truncated to final 256 KiB]' + $text.Substring($text.Length - 262144) }
    [IO.File]::WriteAllText((Join-Path $scratch "$Name.log"), $text, $utf8)
    $rc = if ($finished) { $p.ExitCode } else { 124 }
    Add-Content (Join-Path $scratch 'exits.log') "$Name exit=$rc"
    if ($rc -ne 0) { throw "$Name failed ($rc); see $scratch" }
}
$attempted = $false
try {
    Run git @('rev-parse', '--verify', '--end-of-options', "$Revision^{commit}") 15 'candidate-resolve'
    $candidate = [IO.File]::ReadAllText((Join-Path $scratch 'candidate-resolve.log')).Trim()
    if ($candidate -cnotmatch '^[0-9a-f]{40}$') { throw 'Expected one immutable commit' }
    [IO.File]::WriteAllText((Join-Path $scratch 'candidate.txt'), "$candidate`n", $utf8)
    Run git @('archive', '--format=zip', "--output=$scratch/candidate.zip", $candidate) 30 'archive'
    Expand-Archive -LiteralPath (Join-Path $scratch 'candidate.zip') -DestinationPath (Join-Path $scratch 'source')
    Copy-Item (Join-Path $PSScriptRoot 'host.Dockerfile') (Join-Path $scratch 'Dockerfile')
    Copy-Item (Join-Path $PSScriptRoot 'host-smoke.py') (Join-Path $scratch 'smoke.py')
    if ($Driver) {
        if ([IO.Path]::IsPathRooted($Driver)) { throw 'Driver must be repository-relative' }
        $driverPath = [IO.Path]::GetFullPath((Join-Path $root $Driver))
        if (!$driverPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Driver escapes repository' }
        $cursor = $root
        foreach ($part in [IO.Path]::GetRelativePath($root, $driverPath).Split([IO.Path]::DirectorySeparatorChar)) {
            $cursor = Join-Path $cursor $part
            if ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Driver path must not traverse links' }
        }
        Copy-Item -LiteralPath $driverPath -Destination (Join-Path $scratch 'driver.py')
    }
    Get-FileHash -Algorithm SHA256 $PSCommandPath, (Join-Path $scratch 'Dockerfile'), (Join-Path $scratch '*.py'), (Join-Path $scratch 'candidate.zip') |
        Format-List | Out-String | Set-Content (Join-Path $scratch 'inputs.sha256.txt')
    Run docker @('build', '--platform', 'linux/amd64', '--pull', '--tag', $id, $scratch) 600 'image-build'
    Run docker @('image', 'inspect', $id) 20 'image-identity'
    $command = 'timeout -k 5s 110s python /input/smoke.py'
    if ($Driver) { $command += ' && cd /opt/candidate && python /input/driver.py' }
    $attempted = $true
    Run docker @('run', '--name', $id, '--rm', '--init', '--network=none', '--platform', 'linux/amd64', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=6g', '--cpus=2', '--tmpfs', '/work:rw,exec,size=2g', '--mount', "type=bind,source=$scratch,target=/input,readonly", '--mount', "type=bind,source=$scratch,target=/evidence", $id, 'timeout', '-k', '10s', '590s', 'bash', '-ec', $command) 610 'host-run'
} finally {
    if ($attempted) {
        try { Run docker @('rm', '--force', $id) 20 'container-remove' } catch { }
        Run docker @('ps', '-aq', '--filter', "name=^/$id`$") 20 'cleanup-check'
        if ((Get-Item (Join-Path $scratch 'cleanup-check.log')).Length) { throw "Cleanup uncertain: $id" }
    }
    # Also remove a tag created just before a failed/timed-out build response.
    try { Run docker @('image', 'rm', $id) 30 'image-remove' } catch {
        Run docker @('image', 'ls', '-q', $id) 20 'image-cleanup-check'
        if ((Get-Item (Join-Path $scratch 'image-cleanup-check.log')).Length) { throw "Image cleanup uncertain: $id" }
    }
    Write-Host "Evidence: $scratch"
}
