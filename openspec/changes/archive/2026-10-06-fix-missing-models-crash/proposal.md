# Proposal

## Why

Switching the sidebar to by-model crashes the TUI when the server process still runs an older plugin whose summary has no `models` list (the TUI reloads independently of long-lived servers). Confirmed by rendering the sidebar with a summary lacking `models`: `TypeError: undefined is not an object (evaluating 'models.map')`.

## What Changes

- The by-model breakdown treats a summary without `models` as having no model lines instead of throwing.

## Capabilities

### New Capabilities

### Modified Capabilities

- `cost-display`: the sidebar must not throw when the summary lacks a per-model list.

## Impact

- `src/tui.tsx` (`breakdownLines`), `src/tui.test.ts`. No design needed: single-function bug fix, no contracts, infrastructure or dependency changes.
