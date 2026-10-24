# Disposable OpenCode host

Prepare a pinned, credential-free Linux host for independent terminal and RPC verification.

Parent: [operations](README.md). Application acceptance cases: [test plan](../../openspec/changes/archive/2026-10-24-toggle-token-display/tasks.md#verification-result).

## Finite invocation

From the repository root, using PowerShell 7 and a Linux/amd64 Docker engine:

```powershell
# Prepare, build and observe startup; no application assertion suite.
pwsh -NoProfile -NonInteractive -File docs/operations/prepare-host.ps1 -Revision 6ff10b39178bd1ce9ca5acb5080c049de1e08406

# Run an independently supplied Python acceptance runner in the same image.
# Replace the placeholder with an existing repository-relative file.
pwsh -NoProfile -NonInteractive -File docs/operations/prepare-host.ps1 -Revision <commit-sha> -Driver <relative-runner.py>
```

Prerequisites: Git, Docker registry/npm/PyPI connectivity for preparation, PowerShell 7 and 6 GiB available container memory. Allow 23 minutes for preparation plus the bounded host lifecycle and cleanup. No global installation, published ports, host home/config/auth/database mounts or Docker socket mount. Execution has **no network** and receives no credentials. There is intentionally no provider-enabled mode: provider activity requires separately authorized network, model, request/spend bounds and ephemeral credentials if needed.

The command exports the exact resolved commit with `git archive`, then builds its frozen dependencies and entrypoints into `/opt/candidate`. No application tests run. The Dockerfile and probe come from the invoking checkout, not the candidate commit; `inputs.sha256.txt` fingerprints both and the source archive. Build readiness does not imply application acceptance.

## Artifact pins

| Component | Immutable source |
| --- | --- |
| Python 3.13.9 / Debian Bookworm, Linux/amd64 | `python@sha256:8cdd496996889eef0a8a7921c152c0a4a9f18a26c7a5e7257d3c90b431891894` |
| Bun 1.4.3 and Node 22.23.1 | Same immutable source images as [Linux verification](linux-verification.md#image-pins); only their executables are copied |
| OpenCode 2.0.24 baseline x64 | [Supported platform package](https://registry.npmjs.org/@opencode%2fcli-linux-x64-baseline/2.0.24), tarball below |
| Terminal tools | Python stdlib `pty`, `termios`, `select`, `subprocess`; `pyte==0.8.2`, `wcwidth==0.2.13`, hash-checked wheels |

```text
https://registry.npmjs.org/@opencode/cli-linux-x64-baseline/-/cli-linux-x64-baseline-2.0.24.tgz
sha512-dGa99UyGYS46alr6uxgaSKKHa/CtGgTlWdse1bbhNjLomeOhdIJVJwwxVKfFQz4/NDg1SzDXbxgcIXha2QYHPg==

pyte wheel SHA256:
85db42a35798a5aafa96ac4d8da78b090b2c933248819157fc0e6f78876a0135
wcwidth wheel SHA256:
3da69048e4540d84af32131829ff948f1e022c1c6bdb8d6102117aac784f6859
```

The build verifies the entire host tarball **before** reading its executable, requires exactly one `/bin/opencode` member, and copies only that member. Wheel pins are from [pyte metadata](https://pypi.org/pypi/pyte/0.8.2/json) and [wcwidth metadata](https://pypi.org/pypi/wcwidth/0.2.13/json). No application dependency or lockfile changes occur.

## Terminal runner interface

- `/opt/candidate` is read-only and contains the immutable source, locked dependencies and built `dist/{index,tui,rpc}.js`. Copy only fixture/work files that need mutation into `/work`.
- HOME and XDG config/data/state/cache directories, temporary files, project and ledgers all live under disposable `/work` tmpfs. Evidence alone is writable at `/evidence`; `/input` is the read-only invocation snapshot.
- The optional driver is copied to `/input/driver.py` and launched as `python /input/driver.py`, initially from `/opt/candidate`. Python and the pinned terminal libraries are on PATH/import paths. It returns nonzero on assertion failure; no acceptance criteria are implemented by this wrapper.
- Create separate project/state roots for lifecycle and compatibility fixtures. Write `opencode.json` with `{"plugins":["file:///opt/candidate/dist"]}` in the selected project. **Set the child process working directory to that project**, then launch `opencode --standalone` under a PTY. A positional directory with a different working directory produced HTTP 400 on the cost RPC in the startup probe; matching the working directory restored the empty dollar panel.
- The pinned binary's own `--help` confirms `--standalone` and `reload`; `opencode reload --help` confirms `--server` and `--standalone`. The [CLI documentation](https://opencode.ai/v2/docs/cli) explains private-server operation. Do not invoke bare `opencode reload` against a shared background service. The [installation instructions](../../README.md#install) describe `/reload`; its behavior on the private running TUI still requires independent verification.
- `pty.openpty()` supplies input/output descriptors. `termios.tcsetwinsize()` changes terminal size; this does not independently measure slot width. `pyte.Screen`/`ByteStream` supplies rendered-cell parsing. **Pyte is not a complete modern terminal or automatic query responder.** The acceptance runner must handle required terminal queries, mouse encoding, alternate-screen behavior, resize signals and actual slot measurements, and record unsupported cases rather than infer success. No guessed host geometry or RPC API is provided here.
- Use the supported real plugin RPC interfaces from the [test plan](../../openspec/changes/archive/2026-10-24-toggle-token-display/tasks.md#executable-coverage); no replacement endpoint is created by this environment.

## Bounds, readiness and teardown

- Image build has a 600-second host bound; frozen installation and candidate build each have 180-second internal bounds. Installation has no lifecycle scripts. Preparation is network-enabled; runtime is `--network=none`.
- `host-smoke.py` checks exact output `opencode v2.0.24`, CLI help, PTY availability, terminal parsing and artifact hashes. Its entire readiness probe is capped at 110 seconds (TERM, KILL after 5). The startup observation is 15 seconds, at 120×40 terminal cells; it sends **no prompt or terminal input**.
- Startup evidence consists of raw bytes (≤1 MiB), parsed cells and up to eight log tails (≤64 KiB each). Logs may contain isolated runtime identifiers; keep scratch private. The final host subprocess diagnostic tail is capped at 256 KiB. Drivers must independently bound/redact their evidence files and set per-assertion deadlines.
- The probe terminates the private host process group (TERM, then KILL after 5 seconds), waits for its child, captures evidence, and removes/recreates its isolated state before the optional driver starts. This prevents startup history from becoming first-use data.
- Overall container work, including probe and optional driver, is capped at 590 seconds plus 10 seconds to KILL. Host wait is 610 seconds. `--init` reaps children; container removal destroys the entire process tree and tmpfs even if a child escapes its original process group.
- PowerShell `finally` removes only the invocation's UUID-named container and image tag and checks container absence. No volumes, services or shared-resource prune. Docker-managed pinned base/build cache may remain; no host storage directory inspection is needed.
- Evidence remains under ignored `node_modules/.cache/cmon-host/cmon-host-<UUID>/`: candidate, archive/runner hashes, image identity, build and host diagnostics, startup frames/logs, separate command/cleanup statuses. A zero smoke exit means **facility checks completed**, not that application assertions passed. Cleanup uncertainty blocks completion. After an interrupted terminal, use the recorded UUID for bounded `docker rm --force <name>`, `docker ps -aq --filter 'name=^/<name>$'` and `docker image rm <name>`; verify absence, never prune.

## Observed preparation result

Candidate: `6ff10b39178bd1ce9ca5acb5080c049de1e08406`. Local derived image ID: `sha256:0675967224fba9b2533dff62c18261fc08817ea85e6fd4b8e8911006eaf541c1` (not published; invocation tag removed after use).

| Signal | Result |
| --- | --- |
| Host artifact and executable version | Tarball integrity verified; `opencode v2.0.24`; executable SHA256 `bf9b40108c8af8ff67192b0db534c8fdf80613c9a0114530d4d17a716eba146d` |
| Candidate build | Frozen install/build exit 0; lock SHA256 `489dcc606351dfc3cf56620b81f1ab15d090fd340ed5acd11e5f001d499c6184` |
| Built server / TUI SHA256 | `1fcb37595b2a81ca1d45bc1f9a5e99776ff9b88d3cdb19281525b4cc8caa5f6c` / `129a61c61c9f1728db0c61b700b18bff70e144207644f40027f792c64c3f794b` |
| Startup | Real private server boots, candidate server loads, event stream connects; PTY frame shows `$0.00 this month` and host `2.0.24` |
| Offline warnings | Update/catalog fetches fail as expected under network isolation; no prompt/model request was submitted |
| Cleanup | Host run and cleanup checks exit 0; container absent, invocation image tag removed |

Evidence bundle: `node_modules/.cache/cmon-host/cmon-host-169ff0aee87a4c4883402c30e6e20446/`. The earlier startup capture with a mismatched working directory is retained separately; it is not counted as healthy application behavior.

The final wrapper was also exercised with its own operational smoke probe as `-Driver docs/operations/host-smoke.py`: both bounded probes and cleanup exited 0, validating runner-file handoff without implementing application assertions. Evidence: `node_modules/.cache/cmon-host/cmon-host-794f8793319a4c2ea89a2a1949f1ae65/`.

This establishes host/facility suitability for credential-free verification, **not** two-slot interactions, reload/restart state, NULL/zero/legacy real-RPC assertions or measured narrow geometry. Those checks still need an independent terminal runner. Provider-backed clean first use remains separately blocked on explicit provider/network/request authorization. No production deployment or rollback is involved.
