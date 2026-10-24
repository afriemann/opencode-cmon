# Operations

Prepare isolated verification environments without touching user installations or production.

The Linux runner checks formatting of live source/test files, not immutable archive history. `openspec/changes/archive/2026-10-24-toggle-token-display/tasks.md` is excluded, like earlier archives; this is not a formatting pass for that historical file. Preserve archived bytes and verify their identity separately.

## Environment and isolation

- Target: disposable Docker Linux/amd64 on the reachable local engine.
- Pass a local commit ID explicitly with `-Revision`; the runner resolves and records one immutable commit SHA.
- The default mode prepares the pinned image and runs bounded readiness probes. Add `-Verify` to install dependencies and run candidate checks.
- No production, shared data deletion, host home/config/auth mounts, global settings, dependency/test changes, provider calls or persistent services.
- Docker manages image storage. Do not inspect its host storage directories. Scratch stays in ignored `node_modules/.cache/cmon-linux/`.
- Separate Windows authorization: unchanged candidate `9a55b54` on a new private `--standalone` host, launched from the owned scratch project with existing opaque login. Only fresh scratch configuration, ledgers, bounded owned processes and normal new usage appends are allowed. No credential copying, global edits, history mutation, shared-service membership/termination or inference during readiness. See [standalone readiness](standalone-readiness.md); the earlier shared-service-only launch restriction is superseded.

## Procedures

| Document                                                                  | Purpose                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Linux verification](linux-verification.md)                               | Pinned images, finite clean-room commands, cleanup and evidence                                 |
| [Host preparation](host-preparation.md)                                   | Credential-free host lifecycle/RPC requirements and verification limitations                    |
| [Authenticated-runtime feasibility](authenticated-runtime-feasibility.md) | Unarmed candidate setup on the existing authenticated service; remaining safety/rendering gates |
| [Windows terminal tools](windows-terminal-tools.md)                       | Hash-pinned local ConPTY/pyte tools and finite Job Object launcher                              |
| [Standalone readiness](standalone-readiness.md)                           | Actual terminal-child containment, private-host boundary and remaining runner interface        |

Host preparation uses `prepare-host.ps1`, `host.Dockerfile` and `host-smoke.py`; see its procedure for the immutable host/terminal pins and optional independent Python runner interface. Runtime networking remains disabled; provider activity is not authorized by these commands.

The separately authorized private-host setup uses `prepare-authenticated.ps1` and `authenticated-candidate.mjs`, entirely within disposable repository scratch. Normal new accounting entries are approved; existing history and global configuration are not modified. **No inference is permitted during setup.** The historical shared-service procedure is not the current launch procedure.

For the current budget continuation, use `prepare-authenticated.ps1 -MaxRequests 1`, not its generic default 3. One prior physical request remains charged against the original three-request / USD 0.05 authorization; preserve its reservation and evidence. See [remaining-budget interface and offline proof](authenticated-runtime-feasibility.md#remaining-budget-run-limit-2026-10-24).
