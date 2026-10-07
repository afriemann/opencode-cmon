# Tasks

## 1. Store

- [x] 1.1 Add `stepGaps` (ms since previous step of the same session over all steps, null for first); verify store tests pass for gaps, filter independence and compactions not resetting

## 2. Analysis

- [x] 2.1 Add `gap` group-by with fixed ordered buckets and the constants; verify the three gap-grouping scenarios pass
- [x] 2.2 Add the `idle_cache_rewrite` finding; verify its three scenarios pass

## 3. Tools and docs

- [x] 3.1 Add `gap` to the tool enum, load gaps in both tools, update descriptions; verify tool tests pass
- [x] 3.2 Update README; run `bun run test`, `bun run lint`, `bun run build` and verify all pass
