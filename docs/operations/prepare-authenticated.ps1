param(
  [ValidatePattern('\A[1-3]\z')]
  [string]$MaxRequests = '3'
)
$ErrorActionPreference = 'Stop'
$requestLimit = [int]$MaxRequests
$revision = '9a55b54b0db1ea9546811aed55da1a54c95baf89'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$run = Join-Path $repo ('node_modules/.cache/cmon-auth/run-' + [guid]::NewGuid().ToString('N'))
$candidate = Join-Path $run 'candidate'
New-Item -ItemType Directory -Path $candidate, (Join-Path $run 'project') | Out-Null
try {
  $archive = Join-Path $run 'candidate.tar'
  git -C $repo archive --format=tar "--output=$archive" $revision
  if ($LASTEXITCODE) { throw 'Candidate export failed' }
  tar -xf (Join-Path $run 'candidate.tar') -C $candidate
  if ($LASTEXITCODE) { throw 'Candidate extraction failed' }
  if ((Get-FileHash (Join-Path $candidate 'bun.lock')).Hash -ne (Get-FileHash (Join-Path $repo 'bun.lock')).Hash) {
    throw 'Candidate and prepared dependency lockfiles differ'
  }
  New-Item -ItemType Junction -Path (Join-Path $candidate 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
  Copy-Item (Join-Path $PSScriptRoot 'authenticated-candidate.mjs') (Join-Path $run 'index.js')
  @{ revision=$revision; phase='prepared-not-armed'; maxRequests=$requestLimit; maxUSD=0.05 } |
    ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $run 'environment.json')
  @{ attempts=0; reservedUSD=0; maxRequests=$requestLimit } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $run 'requests.json')
  # Only this disposable location substitutes its inherited cmon instance.
   # Launch only with the private standalone host; never load on the shared service.
  @{ '$schema'='https://opencode.ai/config.json'; model='deepseek/deepseek-flash';
    default_agent='general'; warming=$false; compaction=@{auto=$false};
    plugins=@('-opencode-cmon', @{package=([uri]($run + [IO.Path]::DirectorySeparatorChar)).AbsoluteUri; options=@{maxRequests=$requestLimit}}) } |
    ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $run 'project/opencode.json')
  @{ plugins=@('-opencode-cmon-tui', @{package=([uri]((Join-Path $candidate 'dist') + [IO.Path]::DirectorySeparatorChar)).AbsoluteUri}) } |
    ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $run 'cli-inline.json')
  Write-Output $run
} catch {
  Write-Error "Preparation failed; retain only this run for diagnosis: $run. $_"
  exit 1
}
