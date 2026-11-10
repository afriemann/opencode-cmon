# Proposal

## Why

`cost_hotspots` on a 30-day period blocked the server's event loop for about 57 seconds, because `stepGaps` runs one full-table scan per session with synchronous SQLite. The host treated the server as dead and restarted it, aborting the caller's tool call every time.

## What Changes

- Per-session step lookups use an index instead of scanning the table.
- Loading analysis input yields to the event loop between units of work, so no tool call blocks the server for a noticeable time regardless of ledger size.

## Capabilities

### Modified Capabilities

- `cost-analysis`: tool calls keep the server responsive.

## Impact

`src/store.ts` (index, yielding `stepGaps`), `src/tools.ts` (await it). The index is additive; older plugin processes sharing `cmon.db` keep working.
