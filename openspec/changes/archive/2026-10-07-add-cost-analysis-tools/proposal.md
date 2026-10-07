# Proposal

## Why

The plugin records opencode cost but only the TUI can read it, and only as per-agent/model/provider totals. Agents cannot discover where money goes or how to reduce it: output and reasoning tokens (the most expensive classes), finish reasons and project are not stored, and there is no session/day/step-level view.

## What Changes

- Record, per step, output tokens, reasoning tokens, finish reason and project directory (additive nullable columns, `user_version` stays 3 so older plugin processes keep working; NULL = unknown). Fill them once for existing rows from `opencode.db`.
- Register two agent tools from the server plugin, visible to all agents:
  - `cost_report`: facts. Period, group-by (agent, model, provider, session, day, kind), filters (agent, model, provider, session, project, include sub-agents), sort and limit. Returns cost, share, step count, average cost per step, token breakdown, cache-read ratio, failed-step cost, and the `complete` flag.
  - `cost_hotspots`: ranked findings with evidence, cost and the attributable cost (a fact, overlapping across findings), a suggestion and the formula behind it (top sessions/steps, low cache-read ratio, cache-write spend, failed/truncated steps, compaction spend, sub-agent fan-out, input growth within a session; agent/model mix as a plain fact).
- Project filter is optional (`current` = the calling session's directory; matches that directory and its descendants); default is all projects. Rows with unknown directory are excluded under the filter and the excluded count is reported.
- Tools are registered through `ctx.tool.transform` as pinned Code Mode tools (no per-request token cost); agents that deny `execute` do not see them.
- No backwards compatibility with the previous internal store API is required.

Out of scope: step duration, dollar saving estimates, tool-call attribution, TUI changes, budgets/alerts, storing prompt or content, permission gating, changes to existing summary behaviour.

## Capabilities

### New Capabilities
- `cost-analysis`: agent-facing cost report and hotspot tools, their inputs, outputs, filters and estimate semantics.

### Modified Capabilities
- `cost-recording`: rows additionally store output/reasoning tokens, finish reason and directory; additive columns are ensured without a version bump.
- `cost-retention`: the one-shot fill from `opencode.db` also fills the new columns.

## Impact

`src/store.ts`, `src/types.ts`, `src/pricing.ts`, `src/recorder.ts`, `src/backfill.ts`, `src/index.ts`, new `src/analysis.ts` and `src/tools.ts`, tests, README. `AGENTS.md` ("No agent tools") needs a one-line update via `agent-engineer`. No new dependencies.
