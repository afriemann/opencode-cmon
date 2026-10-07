# opencode-cmon

opencode V2-only plugin that records opencode cost per calendar month (per agent, sub-agents included) in a local SQLite database and shows it in a collapsible TUI block.

- Runtime: V2 (`@opencode/plugin`) only. Server plugin `.` (`src/index.ts`, consumes events via `ctx.event.subscribe`) and TUI plugin `./tui` (`src/tui.tsx`, Solid/opentui); RPC in `src/rpc.ts`. The server plugin registers two read-only pinned Code Mode agent tools, `cost_report` and `cost_hotspots` (namespace `cmon`), via `ctx.tool.transform`; implemented in `src/tools.ts` over the pure logic in `src/analysis.ts`.
- Layout: `src/` with colocated `*.test.ts` (`store`, `recorder`, `backfill`, `pricing`, `summary`, `money`, `time`, `analysis`, `tools`), `script/build-tui.mjs`, `openspec/` specs.
- Commands (bun): `bun run test`, `bun run lint`, `bun run build` (`tsc` + TUI build to `dist/`). CI: `.github/workflows/ci.yml`.
- Gotcha: the `test` script sets `TZ=Europe/Berlin` and `--conditions=browser`; run tests through the script, not bare `bun test`.
- Usage and install: see `README.md`.
