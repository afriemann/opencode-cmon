# Private-host readiness

Contain the real terminal child before starting a private OpenCode host; do not send a prompt.

Parent: [operations](README.md). Status: **containment tooling verified; private application readiness not yet verified**.

## Boundary and launch

- Candidate: unchanged `9a55b54b0db1ea9546811aed55da1a54c95baf89`; installed Windows host 2.1.4. Preserve the existing Docker evidence separately.
- Use a fresh run from `prepare-authenticated.ps1` (30 seconds), then `bun run build` in its candidate directory (120 seconds). The project pins `default_agent=general`, model `deepseek/deepseek-flash`, warming off and automatic compaction off.
- Launch `opencode --standalone` with **working directory exactly `<run>/project`**, not merely a positional directory. The official [CLI guide](https://opencode.ai/v2/docs/cli) and the installed binary's fresh `--help` both confirm private-server operation. The earlier host probe also established the working-directory requirement. The TUI RPC has no location argument: sharing another server's working directory is not isolation.
- Keep inherited providers/login opaque. Never read/copy authentication files, write global settings, change normal history or stop/reload the shared service. Existing opaque login reuse is authorized; a private host does not itself promise a separate runtime history store.
- `project/opencode.json` uses the documented ordered plugin control `-opencode-cmon`, followed by the fresh local adapter package. This is location-scoped, not a global edit. Confirm the effective **private** inventory contains the adapter and excludes the original server plugin before proceeding; inherited higher-precedence settings can override a local file.
- Candidate `dbPath` is `<run>/ledger.sqlite`; `sourceDbPath` is the fresh absent `<run>/absent-source.sqlite`. Do not populate either with normal history. Supply only the run's `cli-inline.json` through child-only `OPENCODE_CLI_CONFIG_CONTENT`; retain the candidate terminal plugin exclusion/replacement.
- Admission must remain absent and request reservations exactly zero. Preserve the source-reviewed adapter's primary-only endpoint/model guards, disabled retries/auxiliary generation and durable three-attempt ceiling (reserved total below USD 0.05). No arming, real prompt or request-cap experiment is authorized here.

## Required terminal-worker interface

The acceptance worker currently spawns normal shared-service `opencode` directly. Do not rerun it unchanged. Its owner must replace only that launch interface with:

```python
PtyProcess.spawn(
    [sys.executable, "-s", str(ROOT / "docs/operations/windows-pty-gate.py"),
     "--parent-pid", str(os.getpid()), "--", "opencode", "--standalone"],
    cwd=str(run / "project"), env=child_env,
    dimensions=(45, 140), backend=Backend.ConPTY,
)
```

Launch the worker through `windows-job.py` using fresh evidence paths as in [terminal tools](windows-terminal-tools.md). The gate inherits `CMON_JOB_NAME` and `CMON_JOB_PROOF`; these are process-local, never persisted globally. Do not put a prompt on this command. A fresh private session must be created/observed through that private client's supported interface, with General and Flash explicitly confirmed. Do not create it through the default `opencode api` command: that would still address the shared service. A prior shared-service session ID is not private-host readiness evidence.

The gate checks the actual ConPTY bootstrap's parent PID and creation time against its live worker handle, verifies that worker is in the owned job, assigns itself if inheritance is absent, and checks `IsProcessInJob`. Only then does it create the application **suspended**, verify its parent/creation time and job membership, assign if necessary, and resume. It writes `<evidence-stem>.pty.json` atomically before resume. It closes its temporary job handle before waiting, preserving the outer kill-on-close safety net. Failure before these checks never starts application code.

The supervisor requires both proof PIDs in its actual job inventory. Root exit zero without terminal proof returns **126**, not success. Timeouts remain 124 and cleanup failure 125. Kill-on-close remains the sole job limit flag (8192); breakaway is not enabled. Only the new suspended worker and gate-created application can be assigned; no existing service is attached. The finite outer deadline terminates the owned job, including inherited private-server descendants, and requires an empty membership inventory within 30 seconds. Application readiness must also verify that any reported private-server PID belongs to this inventory; do not infer a separate service process exists.

## Observer import correction

The retained observer contains a `file:` import whose scoped-package segment is `%40opencode`. Activation failure is suspected, not proved by that text alone. The local package explicitly exports `@opencode/plugin/tui`. Prefer `import { Plugin } from "@opencode/plugin/tui"` with a worktree-owned observer dependency junction, or a generated relative source import `../candidate/node_modules/@opencode/plugin/dist/tui/index.js`. Neither requires reading an external installation. Keep `CostRpc` imported from the actual candidate `../candidate/dist/rpc.js`. Require an explicit observer-ready record and a successful real RPC response from that same private terminal client; import syntax alone is not activation proof. Do not patch production RPC to add a location override.

## Evidence and remaining gate

2026-10-24, private scratch `node_modules/.cache/cmon-native-tools/`:

| Evidence | Result |
| --- | --- |
| `job-gate-smoke.json`, matching terminal/proof files | Exit 0; actual ConPTY bootstrap and harmless application in job; parent/creation identity recorded; ANSI marker and resize passed; no members after cleanup |
| `job-gate-final.json`, matching terminal/proof files | Final-source rerun exited 0; containment true; cleanup true; zero remaining members |
| `job-gate-timeout.json`, matching proof | Exit 124 at one second with worker, bootstrap and application live; containment proved; no members after cleanup |
| `job-no-proof.json` | Harmless zero-exit worker without handshake rejected with 126; cleanup empty |

These are tooling checks, not OpenCode acceptance. The previous application evidence had only its worker in the job, and failed waiting for rendered `This month`; it cannot establish terminal containment or zero-state rendering.

Python AST parsing, PowerShell parser validation and tracked operations diff-whitespace checks also passed. No dependencies were installed or production/test files changed.

**Remaining:** adapt the independently owned worker to the gate/private-session interface; correct and prove observer activation; run one bounded unarmed private-host readiness check covering effective plugin exclusion, matching current directory, unchanged candidate hashes, zero ledger/RPC, General/Flash selection and owned private-server containment/teardown. Matching-host source-diagnosis file paths were not included in this handoff and must accompany the next run's evidence; public CLI documentation alone does not prove hook abort semantics. No actual OpenCode child, private session, provider request or shared-service mutation was performed by these corrected tooling checks. Keep all inference gates closed.
