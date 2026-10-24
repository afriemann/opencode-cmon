# Disposable Linux verification

Run the immutable candidate without reusing Windows dependencies, user settings or ledgers.

Parent: [operations index](README.md).

## Invocation (PowerShell 7, from the repository root)

```powershell
$revision = Read-Host 'Local commit ID to verify (7–40 hexadecimal characters)'

# Image preparation/readiness only; no candidate installation or tests.
pwsh -NoProfile -NonInteractive -File docs/operations/verify-linux.ps1 -Revision $revision

# Full candidate verification:
pwsh -NoProfile -NonInteractive -File docs/operations/verify-linux.ps1 -Revision $revision -Verify
```

Prerequisites: Docker Linux/amd64 engine, Git, PowerShell 7, registry connectivity and at least 6 GiB available container memory. No host Bun, Node or package cache is used. Keep this terminal open until the runner exits; interruption still requires checking the recorded resource name and cleanup logs. Do not use a shell timeout shorter than the runner's finite lifecycle (allow 35 minutes for full verification including image preparation).

`-Revision` is mandatory in both modes: a local hexadecimal commit ID (7–40 characters), preferably the full SHA. Invalid, missing, ambiguous or unavailable commits fail rather than falling back to HEAD. No fetch occurs. The resolved SHA in `candidate.txt` is the sole archive source; uncommitted work and subsequent branch movement cannot change it. The operations runner/Dockerfile come from the invoking checkout and their hashes are recorded separately; record their commit alongside the candidate in verification results.

## Image pins

| Component | Source tag (informational) | Immutable Linux/amd64 manifest |
| --- | --- | --- |
| Bun | `oven/bun:1.4.3-debian` | `sha256:cafb038ad9ebf08d42914f8af35a7b0b825655ad4046ea3470f5ef4f714f3325` |
| Node / Debian | `node:22.23.1-bookworm-slim` | `sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27` |

Dockerfile copies only Bun into the pinned Node image; it installs no OS packages. The derived image is local, not published; its exact content ID and base metadata are captured in `image-identity.log`. Never substitute a mutable tag for these digests. Record the Bun revision when comparing results across runtimes; do not assume equivalence between releases.

## Isolation and lifecycle

- `git archive` exports exactly the resolved `-Revision` SHA, excluding ignored/untracked dependencies and local state. No checkout or branch mutation. `source-snapshot-hash.txt` fingerprints the archive before extraction; only that extraction is copied into the container.
- Input and evidence bind mounts contain only this invocation's project-local ignored scratch. No repository Git metadata, host homes/configuration/auth, Docker socket or credential injection.
- Source is copied into fresh container `/work` tmpfs. Dependencies, build, test scratch, home and caches live there and disappear on container removal. Root filesystem is read-only; privileges/capabilities are restricted.
- Full verification uses Docker's default network for locked registry installation; it receives no provider credentials and issues no real model calls. It is not a security sandbox against malicious candidate code. Readiness uses `--network=none`.
- Install: frozen lock, ignored lifecycle scripts, 180 seconds. Existing adapter → summary → display → full suites, typecheck, lint, build and scoped format run separately with 120-second bounds (build 180). Local locked binaries replace `bunx` to forbid accidental remote tool resolution.
- Overall container deadline: 1450 seconds, TERM then KILL after 10 seconds; host wait 1500 seconds. Image build/pull: 300 seconds. Every host subprocess has its own timeout and output capture.
- Shell EXIT trap records the original status; Docker `--rm` plus PowerShell `finally` removes the unique named container and verifies absence. The unique derived image tag is removed; shared pinned base layers may remain in Docker-managed cache. No persistent services or volumes are created; no prune.
- Logs remain in `node_modules/.cache/cmon-linux/cmon-linux-<UUID>/`. `host-exits.log`, `exits.log`, stage logs, requested/resolved candidate identity, runner/archive hashes, lock/build hashes and `cleanup-check.log` are the evidence bundle. Readiness does not export a source archive or run candidate checks. An empty successful cleanup query proves no matching container remains; an `rm` error alone can mean `--rm` already removed it.
- Any failed gate stops the sequence and retains logs. Cleanup uncertainty is a blocker, not success. Do not rerun silently or label tests passed from runtime readiness.

## Verification limits

Image readiness checks runtime availability and shell syntax only; it does not run candidate checks. Full verification runs the scripted suites and build, but does not launch OpenCode or exercise real host RPC transport, terminal lifecycle or provider activity. See [host preparation](host-preparation.md) for the separate pinned host and PTY facility. No rollout or rollback of a deployed service is involved.

The revision-selection/readiness runner was separately checked against candidate `6ff10b39178bd1ce9ca5acb5080c049de1e08406`: resolution, pinned image build, runtime/shell readiness and cleanup all exited 0. The recorded SHA matches that candidate; no source archive or candidate tests ran in readiness mode. An unavailable all-`f` SHA failed resolution with exit 128; `HEAD` and a missing revision were rejected by parameter validation without launching Docker. Evidence: `node_modules/.cache/cmon-linux/cmon-linux-8ff8c29c6c4d453a986a01098f997e0b/` and `cmon-linux-de1d769829924745b24608c2ffdc3051/` under the same scratch parent. This validates the executable runner delta, not a prose-only equivalence claim or a repeat of unchanged application suites.
