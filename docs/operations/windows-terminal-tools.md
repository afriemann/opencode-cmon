# Windows terminal tools

Prepare a local ConPTY terminal and bounded process-tree launcher without opening OpenCode or sending provider traffic.

Parent: [operations](README.md). Test criteria and terminal assertions remain in the [test plan](../../openspec/changes/archive/2026-10-24-toggle-token-display/tasks.md#executable-coverage).

## Installed tools

CPython 3.12.10, Windows x64; scratch target `node_modules/.cache/cmon-native-tools/site` (not a global installation or virtual environment). The [requirements](../../src/test-support/windows-terminal-requirements.txt) pin binary wheels and SHA256 hashes:

| Distribution | Version | Wheel SHA256                                                       |
| ------------ | ------- | ------------------------------------------------------------------ |
| pywinpty     | 2.0.15  | `83a8f20b430bbc5d8957249f875341a60219a4e971580f2ba694fbfb54a45ebc` |
| pyte         | 0.8.2   | `85db42a35798a5aafa96ac4d8da78b090b2c933248819157fc0e6f78876a0135` |
| wcwidth      | 0.2.13  | `3da69048e4540d84af32131829ff948f1e022c1c6bdb8d6102117aac784f6859` |

From the worktree root, bound download/install together to 120 seconds. Pip has no network retry, a 20-second network timeout, no cache, no source builds and mandatory hash verification. Temporary files and the explicit cache directory stay in scratch:

```powershell
$s = Join-Path $PWD 'node_modules/.cache/cmon-native-tools'
New-Item -ItemType Directory -Force -Path "$s/tmp","$s/cache","$s/wheels","$s/site" | Out-Null
$env:TEMP = "$s/tmp"; $env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = "$s/cache"; $env:PYTHONDONTWRITEBYTECODE = '1'
python -m pip --isolated download --disable-pip-version-check --no-input --no-cache-dir --timeout 20 --retries 0 --only-binary=:all: --require-hashes --dest "$s/wheels" -r src/test-support/windows-terminal-requirements.txt
if ($LASTEXITCODE) { throw 'Wheel download failed' }
python -m pip --isolated install --disable-pip-version-check --no-input --no-cache-dir --no-index --find-links "$s/wheels" --only-binary=:all: --require-hashes --target "$s/site" -r src/test-support/windows-terminal-requirements.txt
if ($LASTEXITCODE) { throw 'Local install failed' }
$env:PYTHONPATH = "$s/site"
```

Use `python -s` so the runner does not load user site packages. These environment settings affect only the current process and its children; do not persist them in global configuration.

## Finite readiness smoke

```powershell
python -s docs/operations/windows-job.py --cwd "$PWD" --evidence "$s/job-smoke.json" --timeout 20 -- python -s docs/operations/windows-terminal-smoke.py "$s/terminal-smoke.json"
```

Outer command bound: 55 seconds. The smoke selects `Backend.ConPTY` explicitly, parses an ANSI marker with pyte and exercises resize. The one-second deadline exercise interrupts it while its harmless terminal child is still alive, proving whole-tree teardown; normal Python shutdown may close that child itself. This is terminal-tool readiness, not application rendering or acceptance.

`windows-job.py` creates **only a new owned process**, suspended; assigns it to a new Windows Job Object before resuming; enables kill-on-close and does not enable either breakaway flag. Worker membership alone is insufficient: use the [ConPTY gate interface](standalone-readiness.md#required-terminal-worker-interface) to verify the actual terminal child and suspended application before application resume. On completion, failure or deadline it terminates the job, queries active process IDs until empty (30-second cleanup deadline), then closes all handles. Assignment failure kills the still-suspended root. The existing service is never attached. A new private standalone host is allowed only within the separately approved scratch boundary.

## Test-runner launch interface

After an independent Windows assertion harness exists, replace the final smoke command with that harness and its arguments:

```powershell
python -s docs/operations/windows-job.py --cwd "<owned-scratch-project>" --evidence "$s/acceptance-job.json" --timeout 600 -- python -s "<absolute-harness-path>" <harness-arguments>
```

The two placeholder paths must resolve inside this worktree. The wrapper inherits the child-only environment, including `PYTHONPATH` and any approved inline CLI configuration. It preserves nonzero root exit status; timeout is 124, cleanup failure is 125, and missing terminal-containment proof on an otherwise successful worker is 126. Evidence separately records `root_exit`, `containment_proven`, observed process IDs, remaining IDs and `cleanup_ok`. Use fresh evidence/proof paths for every run. Allow an outer bound of 635 seconds. The harness owns readiness/assertion deadlines, terminal queries, mouse actions, private-client RPC observation and rendered assertions. No application acceptance is claimed by this tooling.

## Observed result

2026-10-24: hash-checked download and offline target install exited 0. ConPTY smoke exited 0; all three versions matched, ANSI marker parsed and resize returned. Job inventory included the root and the terminal PID; whole-job termination left no members. A separate one-second deadline exercise returned 124: both root and terminal were members immediately before termination, and membership was empty afterward. Effective job-limit flags read back as 8192 (kill-on-close only). Private evidence is in `node_modules/.cache/cmon-native-tools/`. No OpenCode terminal, session, prompt, credential access or provider request was involved.
