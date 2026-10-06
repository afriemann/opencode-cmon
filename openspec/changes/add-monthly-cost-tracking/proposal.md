# Proposal

## Why

opencode shows cost per session but nothing aggregated over time. The user wants to know what opencode costs per calendar month, broken down by agent (including sub-agents), visible at a glance in the TUI without opening a separate tool.

## What Changes

- New opencode V2 plugin `opencode-cmon` with a server half and a TUI half.
- Server half records the cost of every completed or failed model step (`session.step.ended`/`session.step.failed`) and every compaction (`session.compaction.ended`/`.failed`) into a local SQLite database (`cmon.db`, WAL mode, safe for several concurrent opencode server processes), keyed by the assistant/compaction message ID, with agent, model, session, parent session and a UTC epoch timestamp. Agent and model are taken per step. It records sessions from any client (TUI, `opencode run`), and sub-agent sessions are attributed to their own agent (no roll-up to the parent's agent). Costs are stored as integer micro-USD; failed steps count only when cost and tokens are both present (same rule as opencode's session total).
- On first start (tracked by a stored backfill marker) the server half backfills up to 6 months from opencode's `session_message` rows (`assistant` and `compaction` types, keyed by the same message ID) via a read-only connection to `opencode.db`; backfill is idempotent and fails soft with a log if the schema does not match. `session_v2.cost` is never used (it is a running total).
- Title-generation cost is NOT tracked: opencode's `session.usage.recorded` event is internal and not delivered to plugins, and V2 does not persist it per message.
- The TUI half reads data from the server half over a plugin RPC (as `opencode-todo` does), not from the DB file.
- Month = local calendar month, bucketed at query time from UTC timestamps.
- Rows older than 6 months are pruned on startup and once every 24 hours.
- TUI half renders a collapsible block in the `sidebar.content` and `home.footer.status` slots: wrapped by default showing "This month: $X.XX"; opened showing per-agent totals for the current local calendar month. Open/closed state persists.
- Per-model data is stored but not displayed.

Out of scope: per-model display, budgets/alerts, exporting, currencies other than USD, cost of other tools' sessions, changes to opencode itself.

## Capabilities

### New Capabilities

- `cost-recording`: capture per-step cost with agent/model/session attribution (incl. sub-agents) into SQLite, idempotently, from any client.
- `cost-retention`: 6-month retention pruning and first-run backfill from opencode.db.
- `cost-display`: TUI collapsible monthly total and per-agent breakdown.

### Modified Capabilities

(none — new repository)

## Impact

- New repository `afriemann/opencode-cmon` (TypeScript, Bun, `bun:sqlite`, SolidJS/OpenTUI); depends on `@opencode/plugin` >= 2.
- Creates `~/.local/share/opencode/cmon.db`; reads (read-only) `~/.local/share/opencode/opencode.db` for backfill.
- Follow-up in `ai-dotfiles` (separate commit): vendor, build, and enable the plugin.
