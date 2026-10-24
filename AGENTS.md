# opencode-cmon

opencode V2-only plugin that records monthly cost and token usage in a local SQLite database and shows either unit in a collapsible TUI block, including usage grouped by agent.

- Runtime: V2 (`@opencode/plugin`) only. Server plugin `.` (`src/index.ts`, consumes events via `ctx.event.subscribe`) and TUI plugin `./tui` (`src/tui.tsx`, Solid/opentui); RPC in `src/rpc.ts`. The server plugin registers two read-only pinned Code Mode agent tools, `cost_report` and `cost_hotspots` (namespace `cmon`), via `ctx.tool.transform`; implemented in `src/tools.ts` over the pure logic in `src/analysis.ts`.
- Layout: `src/` with colocated `*.test.ts` (`store`, `recorder`, `backfill`, `pricing`, `summary`, `money`, `time`, `analysis`, `tools`), `script/build-tui.mjs`, `openspec/` specs.
- Commands (bun): `bun run test`, `bun run lint`, `bun run build` (`tsc` + TUI build to `dist/`). CI: `.github/workflows/ci.yml`.
- Gotcha: the `test` script sets `TZ=Europe/Berlin` and `--conditions=browser`; run tests through the script, not bare `bun test`.
- Usage and install: see `README.md`.

## Documentation

- [Installation and usage](README.md)
- [Capability specifications](openspec/specs/)
- [Dollar/token display specification](openspec/specs/cost-display/spec.md)
- [Display architecture](openspec/changes/archive/2026-10-24-toggle-token-display/design.md)
- [Display layout](openspec/changes/archive/2026-10-24-toggle-token-display/ux.md)
- [Executable test coverage](openspec/changes/archive/2026-10-24-toggle-token-display/tasks.md)
- [Code changes](docs/status_log.md)
- [Verification procedures](docs/operations/README.md)
- [Display implementation and specification review](https://github.com/renl/opencode-cmon-tokens/pull/1)
