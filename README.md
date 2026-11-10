# opencode-cmon

Tracks what opencode costs per calendar month, per agent (sub-agents included), in a local SQLite database. opencode V2 only.

<img width="400" height="124" alt="image" src="https://github.com/user-attachments/assets/a62db5d4-4a1a-486d-9880-f5c43b232b2b" />

- **Server plugin** (`.`): records every completed or failed model step and every compaction into `~/.local/share/opencode/cmon.db` (WAL, safe for several opencode processes), keyed by message ID. On first start it backfills up to 6 months from opencode's own `opencode.db` (read-only). Rows older than 6 calendar months are pruned on startup and every 24 h.
- **TUI plugin** (`./tui`): a collapsible block in the sidebar and the home footer. Wrapped by default: `▸ This month: $12.34`. Opened: cost per agent. Click the header to toggle; the state is shared and persisted. In the sidebar, the opened block has a `View [Agents] Models Providers` row: click a tab to show cost per agent, per model id, or per provider (not persisted; defaults to Agents on each start). The footer always lists agents.

Cost accuracy: opencode sometimes records Claude cache-write tokens at $0 for GitHub Copilot, but GitHub bills them at 1.25x the input price. The plugin stores opencode's own cost plus the token counts per message, and when it builds the summary it adds the cache-write cost for `github-copilot` Claude rows whose recorded cost lacks it (the cost is below what the tokens would cost without cache writes, plus half the cache-write charge). Prices come from the current model catalog (using opencode's tier selection). Nothing is baked into the database, so the figure follows the catalog. If some pricing is unknown (for example the catalog has not loaded yet), the total is shown as `~$12.34` instead of a silently low number. On the first start after upgrading, missing token counts are filled once from `opencode.db`.

Step attribution: if the plugin misses a step's start, it tries to recover the agent, provider and model from that exact assistant message in `opencode.db`, verifying the session. It never borrows another step's attribution. Recovery is best-effort: unavailable or invalid fields stay `unknown`, while the event's cost is still recorded. Missing attribution on retained steps is retried on every startup, before summaries are available. Repair and step redelivery fill only unknown attribution fields; they preserve existing costs, tokens, timestamps and known attribution, including on backfilled steps. Compaction fallback and redelivery behavior are unchanged.

Attribution diagnostics use stderr and contain categorical reasons, counts and a random setup-local correlation token—not message/session IDs, paths, message content, credentials or raw errors. Live failures are limited to one entry per category per plugin setup, with one aggregate startup repair summary. These limits apply to the new attribution diagnostics, not unrelated plugin logs. Recovery cannot remove `unknown` when the source evidence is unavailable.

## Agent tools

The server plugin also registers two read-only tools (namespace `cmon`) so agents can find where cost goes and how to cut it. They are pinned Code Mode tools: they add no schema to every model request, but an agent whose permissions deny `execute` does not see them.

- `cost_report`: cost, share, steps, average cost per step, token counts (input, output, reasoning, cache read, cache write), cache-read ratio and failed-step cost, grouped by `agent` (default), `model`, `provider`, `session`, `day` or `gap` (time since the session's previous step: first, <1m, 1-5m, >5m); `groupBy` also accepts an array of exactly two distinct dimensions such as `["day","model"]` for one row per combination (`key` is `a / b`, `keys` holds both values); `sort` by `cost`, `steps` or `avgCost`. Its total equals the TUI total for the same range. Remaining groups beyond `limit` (default 10, max 50) fold into `others`.
- `cache_breaks`: prompt-cache regressions in sessions with at least 20 steps with known tokens. Per flagged session: a frozen cache (15+ consecutive steps with an identical cache read above 0 while uncached input is above 0: run length, frozen value, start step and time, uncached input at start and end), full misses (a step with cache read 0 right after one above 0; the first step and the step after a compaction are excluded; count and up to 10 entries), change-points of the rolling 10-step cache ratio `cache read / (cache read + uncached input)` across 0.5, and the estimated waste in USD (flagged steps' uncached input at the catalog input price instead of the session's median catalog cache-read price; omitted with a statement when a price is unknown). Also lists flagged versus examined sessions per provider/model so a provider-wide regression is visible. Filters as for the other tools except `kind`; `limit` defaults to 10, max 30. Sorted by session cost; never outputs prompts or message content.
- `cost_hotspots`: ranked findings, each with evidence, the cost attributable to the pattern, a suggestion (or none for plain facts) and the formula behind it: top sessions and steps, low cache-read ratio, cache writes, failed and truncated steps, compactions, sub-agent fan-out, context growth, rewrites after idle pauses over 5 minutes (the cache expired), cache stalls (5+ consecutive steps whose cache read stays at the fixed prompt prefix while uncached input grows: start time, stalled steps and cost, whether still ongoing; also shown as a TUI toast and a warning line in the cost block), and each agent's model mix. Attributable costs overlap between findings, so do not add them up. Thresholds are constants in `src/analysis.ts`; `limit` defaults to 10, max 30.

Shared inputs: `period` (`month` by default, `YYYY-MM`, `<N>d` for the last N days up to 184, or `YYYY-MM-DD..YYYY-MM-DD` inclusive local days), exact `agent`, `model`, `provider`, `kind` (`step` or `compaction`), `session` (includes its sub-agent sessions unless `includeSubagents` is false) and `project`. `project` matches a directory and everything below it, so a repo root covers its worktrees; `current` is the calling session's directory; by default all projects are included. Rows without a recorded directory are excluded under a project filter and reported as a count. Output and detail columns (output and reasoning tokens, finish reason, directory) are filled for older rows once from `opencode.db`.

Not tracked: title-generation cost (opencode does not deliver that event to plugins).

## Install

```sh
bun install && bun run build
```

Load `dist/index.js` as a server plugin (e.g. symlink into `~/.config/opencode/plugins/`) and `dist` as a TUI plugin via `plugins` in `~/.config/opencode/cli.json`.

Options (server plugin): `dbPath`, `sourceDbPath`, `copilotUsageProbe` (default `false`).

### Copilot usage probe

Set `copilotUsageProbe: true` in the server plugin's options to inspect existing GitHub Copilot `/chat/completions` and `/responses` JSON/SSE responses. This is diagnostic only: it makes no provider requests and changes no recorded costs or prices. Leave it disabled unless investigating usage metadata.

The probe samples at most two responses per endpoint per plugin load, including failed samples. Inspection stops after 1 MiB per response, 64 KiB per SSE event, 30 seconds from response-hook entry, or plugin unload. It follows consumer reads without a separate draining branch; inspection adds bounded parsing work. Slow or abandoned consumers can therefore produce incomplete samples. Response delivery continues after inspection stops.

Structured stderr entries with `message: "copilot usage observation"` contain an endpoint category, outcome, snapshot count, validated host model ID when available, and fixed numeric usage fields. `fields` distinguishes present, invalid, absent and unknown; `usageState` distinguishes a usage object from no usage or incomplete evidence. Multiple snapshots use the latest values, not their sum. `cacheWrite`, `billedCost` and `nanoAiu` inspect candidate usage keys `cache_write_tokens`, `cost` and `totalNanoAiu`; their presence does not establish billing units, currency or meaning. A cutoff, malformed stream or transport error is not evidence that billing fields are absent.

Bodies are inspected transiently within the limits, never logged or stored by the plugin. Output excludes prompts, generated text, headers, URLs, credentials, response/session IDs and arbitrary field names. There is no export or ledger storage; stderr retention is controlled by the host's log policy. Disable the option and reload the plugin after collecting samples. Hook incompatibility leaves the probe inactive without disabling normal cost tracking.

## Develop

`bun run test`, `bun run lint`, `bun run build`. Behaviour is specified in `openspec/`.
