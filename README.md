# opencode-cmon

Tracks what opencode costs per calendar month, per agent (sub-agents included), in a local SQLite database. opencode V2 only.

- **Server plugin** (`.`): records every completed or failed model step and every compaction into `~/.local/share/opencode/cmon.db` (WAL, safe for several opencode processes), keyed by message ID. On first start it backfills up to 6 months from opencode's own `opencode.db` (read-only). Rows older than 6 calendar months are pruned on startup and every 24 h.
- **TUI plugin** (`./tui`): a collapsible block in the sidebar and the home footer. Wrapped by default: `▸ This month: $12.34`. Opened: cost per agent. Click the header to toggle; the state is shared and persisted.

Cost accuracy: opencode prices Claude cache-write tokens at $0 for GitHub Copilot, but GitHub bills them at 1.25x the input price. The plugin keeps opencode's figure and adds the cache-write cost for `github-copilot` Claude models (priced from the model catalog, using opencode's tier selection), so the shown total matches your bill. The first start after upgrading corrects existing history once.

Not tracked: title-generation cost (opencode does not deliver that event to plugins).

## Install

```sh
bun install && bun run build
```

Load `dist/index.js` as a server plugin (e.g. symlink into `~/.config/opencode/plugins/`) and `dist` as a TUI plugin via `plugins` in `~/.config/opencode/cli.json`.

Options (server plugin): `dbPath`, `sourceDbPath`.

## Develop

`bun run test`, `bun run lint`, `bun run build`. Behaviour is specified in `openspec/`.
