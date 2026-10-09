# opencode-cmon

Tracks what opencode costs per calendar month, per agent (sub-agents included), in a local SQLite database. opencode V2 only.

<img width="400" height="124" alt="image" src="https://github.com/user-attachments/assets/a62db5d4-4a1a-486d-9880-f5c43b232b2b" />

- **Server plugin** (`.`): records every completed or failed model step and every compaction into `~/.local/share/opencode/cmon.db` (WAL, safe for several opencode processes), keyed by message ID. On first start it backfills up to 6 months from opencode's own `opencode.db` (read-only). Rows older than 6 calendar months are pruned on startup and every 24 h.
- **TUI plugin** (`./tui`): a collapsible block in the sidebar and the home footer. Wrapped by default: `▸ This month: $12.34`. Opened: cost per agent. Click the header to toggle; the state is shared and persisted. In the sidebar, the opened block has a `View [Agents] Models Providers` row: click a tab to show cost per agent, per model id, or per provider (not persisted; defaults to Agents on each start). The footer always lists agents.

Cost accuracy: opencode sometimes records Claude cache-write tokens at $0 for GitHub Copilot, but GitHub bills them at 1.25x the input price. The plugin stores opencode's own cost plus the token counts per message, and when it builds the summary it adds the cache-write cost for `github-copilot` Claude rows whose recorded cost lacks it (the cost is below what the tokens would cost without cache writes, plus half the cache-write charge). Prices come from the current model catalog (using opencode's tier selection). Nothing is baked into the database, so the figure follows the catalog. If some pricing is unknown (for example the catalog has not loaded yet), the total is shown as `~$12.34` instead of a silently low number. On the first start after upgrading, missing token counts are filled once from `opencode.db`.

## Agent tools

The server plugin also registers two read-only tools (namespace `cmon`) so agents can find where cost goes and how to cut it. They are pinned Code Mode tools: they add no schema to every model request, but an agent whose permissions deny `execute` does not see them.

- `cost_report`: cost, share, steps, average cost per step, token counts (input, output, reasoning, cache read, cache write), cache-read ratio and failed-step cost, grouped by `agent` (default), `model`, `provider`, `session`, `day` or `gap` (time since the session's previous step: first, <1m, 1-5m, >5m); `sort` by `cost`, `steps` or `avgCost`. Its total equals the TUI total for the same range. Remaining groups beyond `limit` (default 10, max 50) fold into `others`.
- `cost_hotspots`: ranked findings, each with evidence, the cost attributable to the pattern, a suggestion (or none for plain facts) and the formula behind it: top sessions and steps, low cache-read ratio, cache writes, failed and truncated steps, compactions, sub-agent fan-out, context growth, rewrites after idle pauses over 5 minutes (the cache expired), and each agent's model mix. Attributable costs overlap between findings, so do not add them up. Thresholds are constants in `src/analysis.ts`; `limit` defaults to 10, max 30.

Shared inputs: `period` (`month` by default, `YYYY-MM`, `<N>d` for the last N days up to 184, or `YYYY-MM-DD..YYYY-MM-DD` inclusive local days), exact `agent`, `model`, `provider`, `kind` (`step` or `compaction`), `session` (includes its sub-agent sessions unless `includeSubagents` is false) and `project`. `project` matches a directory and everything below it, so a repo root covers its worktrees; `current` is the calling session's directory; by default all projects are included. Rows without a recorded directory are excluded under a project filter and reported as a count. Output and detail columns (output and reasoning tokens, finish reason, directory) are filled for older rows once from `opencode.db`.

Not tracked: title-generation cost (opencode does not deliver that event to plugins).

## Install

```sh
bun install && bun run build
```

Load `dist/index.js` as a server plugin (e.g. symlink into `~/.config/opencode/plugins/`) and `dist` as a TUI plugin via `plugins` in `~/.config/opencode/cli.json`.

Options (server plugin): `dbPath`, `sourceDbPath`.

## Develop

`bun run test`, `bun run lint`, `bun run build`. Behaviour is specified in `openspec/`.
