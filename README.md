# opencode-cmon

Tracks what opencode costs per calendar month, per agent (sub-agents included), in a local SQLite database. opencode V2 only.

<img width="400" height="124" alt="image" src="https://github.com/user-attachments/assets/a62db5d4-4a1a-486d-9880-f5c43b232b2b" />

- **Server plugin** (`.`): records every completed or failed model step and every compaction into `~/.local/share/opencode/cmon.db` (WAL, safe for several opencode processes), keyed by message ID. On first start it backfills up to 6 months from opencode's own `opencode.db` (read-only). Rows older than 6 calendar months are pruned on startup and every 24 h.
- **TUI plugin** (`./tui`): a collapsible block in the sidebar and the home footer. Wrapped by default: `▸ This month: $12.34`. Opened: cost per agent. Click the header to toggle; the state is shared and persisted. In the sidebar, the opened block has a `View [Agents] Models Providers` row: click a tab to show cost per agent, per model id, or per provider (not persisted; defaults to Agents on each start). The footer always lists agents.

Cost accuracy: opencode prices Claude cache-write tokens at $0 for GitHub Copilot, but GitHub bills them at 1.25x the input price. The plugin stores opencode's own cost plus the token counts per message, and adds the cache-write cost for `github-copilot` Claude models when it builds the summary, priced from the current model catalog (using opencode's tier selection). Nothing is baked into the database, so the figure follows the catalog. If some pricing is unknown (for example the catalog has not loaded yet), the total is shown as `~$12.34` instead of a silently low number. On the first start after upgrading, missing token counts are filled once from `opencode.db`.

Not tracked: title-generation cost (opencode does not deliver that event to plugins).

## Install

```sh
bun install && bun run build
```

Load `dist/index.js` as a server plugin (e.g. symlink into `~/.config/opencode/plugins/`) and `dist` as a TUI plugin via `plugins` in `~/.config/opencode/cli.json`.

Options (server plugin): `dbPath`, `sourceDbPath`.

## Develop

`bun run test`, `bun run lint`, `bun run build`. Behaviour is specified in `openspec/`.
