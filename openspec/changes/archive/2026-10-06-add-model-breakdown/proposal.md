# Proposal

## Why

The cost block only breaks the month's spend down by agent. Users also want to see which models drive the cost, without losing the per-agent view.

## What Changes

- The RPC `summary` additionally returns per-model sums, keyed `providerId/modelId`, sorted like agents.
- The opened sidebar block gets a clickable toggle row switching the breakdown between agents and models. It defaults to agents on every TUI start and is not persisted.
- The toggle is visually distinct from the breakdown lines (own colour, bracketed, bold active mode).
- The home footer is unchanged and keeps listing agents.
- Out of scope: footer changes, an agent x model matrix, DB schema changes, the month range, persistence of the choice.

## Capabilities

### New Capabilities

### Modified Capabilities

- `cost-display`: the summary gains per-model sums; the opened sidebar lists the selected breakdown and offers a toggle.

## Impact

- `src/types.ts`, `src/store.ts` (summary query), `src/tui.tsx` (sidebar), their tests, and the `cost-display` spec.
- No schema change: `provider_id` and `model_id` are already stored.
