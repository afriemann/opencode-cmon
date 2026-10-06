# Proposal

## Why

The by-model breakdown labels lines `providerId/modelId`, which is long and truncates the distinguishing model id. The provider is better shown as its own breakdown.

## What Changes

- Model lines show only the bare model id; the same id served by two providers merges into one line.
- A new Providers breakdown lists the cost per provider id.
- The sidebar toggle row becomes `View  [Agents]  Models  Providers`; each tab word is its own click target and selects that breakdown (replaces click-anywhere-flips).
- The summary RPC gains `providers` and its `models` entries are keyed by model id only.
- Sidebar tolerates a summary lacking `models` or `providers` (older server).
- Out of scope: footer, agent x model matrix, schema change, persistence, keyboard access.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cost-display`: summary shape (model key, providers), the toggle becomes a three-way word-click control, older-server tolerance covers providers.

## Impact

- `src/types.ts`, `src/store.ts`, `src/tui.tsx`, their tests, `README.md`, and the `cost-display` spec.
