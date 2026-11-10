# Proposal

## Why

A prompt-cache regression on an OpenAI model showed as cache reads frozen at one value while uncached input kept growing, plus isolated full misses. No aggregate exposes either, so the investigation needed hand-written SQL. Cost reports also cannot be broken down by two dimensions (day by model).

## What Changes

- `cost_report` `groupBy` accepts one dimension (unchanged) or an array of exactly two distinct dimensions and returns one row per combination.
- New pinned tool `cache_breaks` examines sessions with at least 20 steps and reports, per flagged session, frozen-cache runs, full cache misses, 0.5 cache-ratio change-points and the estimated waste, plus a per-model flagged/examined summary.
- `cache_breaks` is a stricter, separate detector from the `cache_stall` hotspot finding, which is unchanged.
- Uncached input is `tokens_input`; the cache ratio for `cache_breaks` is cache read / (cache read + input).

## Capabilities

### Modified Capabilities

- `cost-analysis`: `cost_report` two-dimension grouping; new `cache_breaks` tool.

## Impact

- `src/analysis.ts`, `src/tools.ts`, new `src/cache-breaks.ts`; `README.md`, `AGENTS.md`.
- No schema change; `cache_breaks` never outputs prompts or message content.
