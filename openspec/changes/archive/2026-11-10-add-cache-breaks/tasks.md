# Tasks

## 1. Two-dimension grouping

- [x] 1.1 Add failing tests for the "Report groups cost by two dimensions" scenarios in `src/analysis.test.ts` and `src/tools.test.ts`; verify they fail
- [x] 1.2 Support a two-dimension `groupBy` in `buildReport`/`renderReport` and the `cost_report` schema and validation; verify the tests pass and the single-dimension output is unchanged

## 2. Cache breaks

- [x] 2.1 Add failing tests in `src/cache-breaks.test.ts` for the "Cache breaks" scenarios (examine, frozen, full misses, change-points, waste, listing); verify they fail
- [x] 2.2 Implement `src/cache-breaks.ts` and export the needed `analysis.ts` helpers; verify the tests pass
- [x] 2.3 Register the pinned `cache_breaks` tool in `src/tools.ts` and update the tool lists in `src/index.test.ts`; verify the tool tests pass

## 3. Docs and verification

- [x] 3.1 Update `README.md` and `AGENTS.md` for both features; verify the tool names and inputs match the schema
- [x] 3.2 Run `bun run test`, `bun run lint` and `bun run build`; verify all pass
