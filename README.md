# opencode-cmon

Tracks what opencode costs per calendar month, per agent (sub-agents included), in a local SQLite database. opencode V2 only.

This fork adds a clickable `$` / `Tokens` selector to the monthly panel. The feature lives on the `toggle-token-display` branch; `main` does not contain it.

<img width="400" height="124" alt="Monthly cost panel showing this month's total and per-agent dollar amounts" src="https://github.com/user-attachments/assets/a62db5d4-4a1a-486d-9880-f5c43b232b2b" />

- **Server plugin** (`.`): records every completed or failed model step and every compaction into `~/.local/share/opencode/cmon.db` (WAL, safe for several opencode processes), keyed by message ID. On first start it backfills up to 6 months from opencode's own `opencode.db` (read-only). Rows older than 6 calendar months are pruned on startup and every 24 h.
- **TUI plugin** (`./tui`): a collapsible block in the sidebar and the home footer. Wrapped by default: `▸ This month: $12.34`. Opened: cost per agent. Click the header to toggle; the open/closed state is shared and persisted. In the sidebar, the opened block has two separate rows: `View [Agents] Models Providers` and `Unit [$] Tokens`. Click a View tab to show cost per agent, per model id, or per provider (not persisted; starts at Agents). The footer always lists agents, whichever View tab the sidebar uses. Click `$` or `Tokens` to switch the header, sidebar breakdown and footer between dollars and token counts. Counts below 1,000 stay exact; larger amounts are compact decimals (`7.93k`, `590.98M`, `1.58B tokens`, `1 token`), rounded to at most two decimals for display only, while ordering and totals use the exact stored counts. Each label and its brackets form one complete click target and never split across rows. The panel measures its own sidebar width, so both rows and the amounts stay visible and clickable in a narrow sidebar; long breakdown names shorten first. The unit is shared for the current TUI session and is not persisted, so a restart returns to dollars. Switching units keeps the panel open and the current View tab; the View tab itself starts at Agents again after a restart. Dollar values and their `~` pricing marker are unaffected by the unit switch.

Token totals add the five stored, disjoint categories once each: input, cache read, cache write, output and reasoning. Stored input already excludes cached tokens and stored output already excludes reasoning, so nothing is subtracted twice. An incomplete total gets `~` (some stored token counts are unavailable, not unknown prices), and `Tokens unavailable` means no counts are available at all, for example on an older server. In the opened sidebar, `Partial: some token counts unavailable` explains incomplete or unavailable token history. An empty month on a token-capable server shows `0 tokens` without a partial marker.

Cost accuracy: opencode sometimes records Claude cache-write tokens at $0 for GitHub Copilot, but GitHub bills them at 1.25x the input price. The plugin stores opencode's own cost plus the token counts per message, and when it builds the summary it adds the cache-write cost for `github-copilot` Claude rows whose recorded cost lacks it (the cost is below what the tokens would cost without cache writes, plus half the cache-write charge). Prices come from the current model catalog (using opencode's tier selection). Nothing is baked into the database, so the figure follows the catalog. If some pricing is unknown (for example the catalog has not loaded yet), the total is shown as `~$12.34` instead of a silently low number. On the first start after upgrading, missing token counts are filled once from `opencode.db`.

Step attribution: if the plugin misses a step's start, it tries to recover the agent, provider and model from that exact assistant message in `opencode.db`, verifying the session. It never borrows another step's attribution. Recovery is best-effort: unavailable or invalid fields stay `unknown`, while the event's cost is still recorded. Missing attribution on retained steps is retried on every startup, before summaries are available. Repair and step redelivery fill only unknown attribution fields; they preserve existing costs, tokens, timestamps and known attribution, including on backfilled steps. Compaction fallback and redelivery follow the same rules.

Attribution diagnostics use stderr and contain categorical reasons, counts and a random setup-local correlation token—not message/session IDs, paths, message content, credentials or raw errors. Live failures are limited to one entry per category per plugin setup, with one aggregate startup repair summary. These limits apply to attribution diagnostics, not unrelated plugin logs. Recovery cannot remove `unknown` when the source evidence is unavailable.

## Agent tools

The server plugin also registers two read-only tools (namespace `cmon`) so agents can find where cost goes and how to cut it. They are pinned Code Mode tools: they add no schema to every model request, but an agent whose permissions deny `execute` does not see them. Both tools report cost in dollars regardless of the panel's unit; their token-count columns are not affected by the unit switch.

- `cost_report`: cost, share, steps, average cost per step, token counts (input, output, reasoning, cache read, cache write), cache-read ratio and failed-step cost, grouped by `agent` (default), `model`, `provider`, `session`, `day` or `gap` (time since the session's previous step: first, <1m, 1-5m, >5m); `sort` by `cost`, `steps` or `avgCost`. Its total equals the TUI total for the same range. Remaining groups beyond `limit` (default 10, max 50) fold into `others`.
- `cost_hotspots`: ranked findings, each with evidence, the cost attributable to the pattern, a suggestion (or none for plain facts) and the formula behind it: top sessions and steps, low cache-read ratio, cache writes, failed and truncated steps, compactions, sub-agent fan-out, context growth, rewrites after idle pauses over 5 minutes (the cache expired), and each agent's model mix. Attributable costs overlap between findings, so do not add them up. Thresholds are constants in `src/analysis.ts`; `limit` defaults to 10, max 30.

Shared inputs: `period` (`month` by default, `YYYY-MM`, `<N>d` for the last N days up to 184, or `YYYY-MM-DD..YYYY-MM-DD` inclusive local days), exact `agent`, `model`, `provider`, `kind` (`step` or `compaction`), `session` (includes its sub-agent sessions unless `includeSubagents` is false) and `project`. `project` matches a directory and everything below it, so a repo root covers its worktrees; `current` is the calling session's directory; by default all projects are included. Rows without a recorded directory are excluded under a project filter and reported as a count. Output and detail columns (output and reasoning tokens, finish reason, directory) are filled for older rows once from `opencode.db`.

Not tracked: title-generation cost (opencode does not deliver that event to plugins).

## Install

Keep the install directory: the global config loads its built `dist` directory in place, and updates are applied there.

Prerequisites:

- OpenCode V2 with plugin API 2.0 or newer.
- Git, Bun and Node.js 22.5 or newer. Bun runs the install/build scripts; the TUI build runs under Node.

Point the config at the built `dist` directory, not at the checkout root and not at `dist/index.js`. For a local directory, opencode loads the server, TUI and RPC entry files directly from that directory; it does not use the root package exports. The `dist` directory contains `index.js` (server), `tui.js` (TUI) and `rpc.js` (RPC), so one entry loads both the server and the panel. The checkout root has none of those files, so the plugin does not load and the panel does not appear. `dist/index.js` is the server entry only, so it records cost but has no panel. Run `bun install --frozen-lockfile` and `bun run build` before adding the config entry; the path does not work until `dist` exists.

### Windows PowerShell

```powershell
$data = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME ".local\share" }
$install = Join-Path $data "opencode\plugins\opencode-cmon-tokens"
New-Item -ItemType Directory -Force (Split-Path $install) | Out-Null
git clone --branch toggle-token-display https://github.com/renl/opencode-cmon-tokens.git $install
Set-Location $install
bun install --frozen-lockfile
bun run build
```

### macOS and Linux

```sh
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/plugins/opencode-cmon-tokens"
mkdir -p "$(dirname "$install_dir")"
git clone --branch toggle-token-display https://github.com/renl/opencode-cmon-tokens.git "$install_dir"
cd "$install_dir"
bun install --frozen-lockfile
bun run build
```

### Configure globally

Back up `~/.config/opencode/opencode.json` or `opencode.jsonc` first, then add one entry to its `plugins` array. Keep unrelated settings and other plugin entries. On Windows the file is under `C:\Users\<you>\.config\opencode\`.

Windows:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///C:/Users/<you>/.local/share/opencode/plugins/opencode-cmon-tokens/dist"
  ]
}
```

macOS and Linux:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///home/<you>/.local/share/opencode/plugins/opencode-cmon-tokens/dist"
  ]
}
```

On macOS, use `/Users/<you>/...` instead of `/home/<you>/...`. If you installed elsewhere or set `XDG_DATA_HOME`, point the entry at that actual directory's `dist` subdirectory. Use the `file://` URL on Windows; it avoids JSON backslash escaping.

One entry is enough: the `dist` directory contains the server, TUI and RPC entries, so opencode loads both the server and the panel from the single `plugins` entry. The TUI auto-loads; do not add it to `cli.json` as well. Remove any earlier cmon entry (the original package, the checkout root, or a separate TUI entry) so the plugin is not loaded twice.

Apply the change with `/reload` in the TUI (or `opencode reload` from a shell). If the block does not appear, check that the `plugins` entry ends in `/dist` and not the checkout root or `dist/index.js`. Then confirm `dist` exists and is current by running `bun install --frozen-lockfile` and `bun run build` in the install directory. After that, restart opencode; changes to a local plugin directory may not hot-reload.

Optional server options use the object form of the same entry: `{"package": "file:///path/to/opencode-cmon-tokens/dist", "options": {"dbPath": "/path/cmon.db", "sourceDbPath": "/path/opencode.db"}}`. The default ledger is `~/.local/share/opencode/cmon.db`; the default source is `~/.local/share/opencode/opencode.db`.

### Update

From the install directory, stay on the feature branch and fast-forward only. If you already installed it, do not clone again. If `git pull --ff-only` refuses, stop and inspect local changes rather than forcing a merge or reset.

Windows PowerShell:

```powershell
$data = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME ".local\share" }
$install = Join-Path $data "opencode\plugins\opencode-cmon-tokens"
Set-Location $install
git switch toggle-token-display
git pull --ff-only
bun install --frozen-lockfile
bun run build
```

macOS and Linux:

```sh
cd "${XDG_DATA_HOME:-$HOME/.local/share}/opencode/plugins/opencode-cmon-tokens"
git switch toggle-token-display
git pull --ff-only
bun install --frozen-lockfile
bun run build
```

The config entry keeps pointing at the same `dist` directory; rebuilding is what updates the loaded code. Then run `/reload` or `opencode reload`; restart opencode if the old TUI code is still shown.

### Uninstall

Remove the cmon entry from the global `plugins` array, then run `/reload` or restart opencode. Optionally delete the install directory with your normal file tools or `Remove-Item -Recurse` / `rm -rf`, after the config entry is gone.

Recorded history is not part of the install directory. Uninstalling leaves `cmon.db` (or your configured `dbPath`) intact; delete it only if you intentionally want to erase cost history.

## Limitations

Automated checks cover recording, storage, pricing, summary logic and the rendered panel, with test doubles standing in for the host. The live path was also exercised on Windows with opencode 2.1.4, using an existing login and a fresh, empty database: the panel mounted, the server and panel exchanged their expected messages, and ordinary provider activity appeared in both units. Not proved by that run:

- signing in or setting up a completely fresh opencode installation, which may behave differently from reusing an existing login;
- the panel in a normal desktop install on macOS or Linux; Linux so far has only automated host runs in containers;
- terminal widths other than the measured ones, and amounts too wide for their line;
- keyboard navigation and screen readers; the controls are mouse-clicked terminal text.

Token display is presentational: it does not change stored costs, and dollar figures remain the basis for ordering, the agent tools and the summaries.

## Develop

`bun run test`, `bun run lint`, `bun run build`. Behaviour is specified in `openspec/`.
