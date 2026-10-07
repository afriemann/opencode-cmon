# Proposal

## Why

Cache-write spend is the largest hotspot, but it has two causes: normal context growth and whole-context rewrites after the provider cache expired during an idle pause. Today agents cannot tell them apart, and the generic "avoid editing early context" suggestion fits only the first.

## What Changes

- `cost_report` gains `groupBy: "gap"`: buckets by time since the previous step of the same session (`first`, `<1m`, `1-5m`, `>5m`), in fixed order.
- `cost_hotspots` gains an `idle_cache_rewrite` finding: steps that follow a gap over 5 minutes with a low cache-read share, with cost, count and average cache-write tokens.
- Gaps are computed from all steps of a session, independent of filters, from recorded step start times (includes tool run and thinking time).
- No schema change.

Out of scope: measuring real provider cache expiry, changes to other findings.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cost-analysis`: new report dimension `gap` and new hotspot finding `idle_cache_rewrite`.

## Impact

`src/store.ts`, `src/analysis.ts`, `src/tools.ts`, tests, README. No design.md: one added dimension and one finding, no new component boundaries, dependencies or configuration.
