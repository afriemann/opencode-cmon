# Tasks

## 1. Store: detail columns (cost-recording)

- [x] 1.1 Red tests then code: `migrate` ensures `tokens_output`, `tokens_reasoning`, `finish`, `directory`, `details_checked` on a v3 file via `PRAGMA table_info` without a version bump, concurrency-safe; verify store tests for "Detail columns are added without a version bump" and the unchanged upgrade scenarios pass
- [x] 1.2 Extend `CostRow`/`TokenCounts`, insert bindings and `upsertLive` (COALESCE on redelivery); verify "Rows store output and reasoning tokens" and redelivery scenarios pass

## 2. Recorder (cost-recording)

- [x] 2.1 Carry event `location` and replace `resolveParent` by a cached session lookup returning parent and directory; verify "Rows store the project directory" scenarios pass
- [x] 2.2 Record output/reasoning tokens and finish (step.ended only); verify finish and token scenarios pass

## 3. Backfill and detail fill (cost-retention)

- [x] 3.1 Map output, reasoning, finish, directory and `failed` from `$.error` in `completeBackfill`; verify "Backfill maps detail fields and failure" tests pass against a fixture `opencode.db`
- [x] 3.2 Add the detail fill (own predicate `details_checked IS NULL`, terminal marker, NULL for absent data, chunked, fail-soft) and call it in `index.ts` after the token fill; verify "Missing details are filled once" tests pass

## 4. Shared pricing

- [x] 4.1 Extract the per-row cache-write add-on from `buildSummary` into `pricing.ts`; verify existing summary and pricing tests pass unchanged

## 5. Analysis (cost-analysis)

- [x] 5.1 Store query for filtered rows (period, agent/model/provider/kind, session subtree via recursive CTE, project path-boundary match, excluded-unknown count); verify store tests for filter, subtree and project scenarios pass
- [x] 5.2 `analysis.ts` period parsing and report (groupBy, sort, shares, others, ratios, failed cost, notes, TUI-total invariant); verify the report scenarios and the invariant test pass
- [x] 5.3 `analysis.ts` hotspots (named threshold constants, all finding types, ranking, overlap note); verify one test per hotspot scenario passes
- [x] 5.4 Text rendering with 8 KB / 120-line cap and limits validation; verify the output-bound scenarios pass

## 6. Tools and wiring (cost-analysis)

- [x] 6.1 `tools.ts`: both tools with input/output schemas, descriptions (USD, period grammar, project rule, title-generation caveat), `current` project resolution, closed guard; verify tool tests pass
- [x] 6.2 Wire in `index.ts` via `ctx.tool.transform` (pinned Code Mode, namespace `cmon`), dispose before store close, none when the store fails; verify "registered only while tracking runs" scenarios pass in `index.test.ts`

## 7. Docs and checks

- [x] 7.1 Document the tools, period grammar, project rule and the `execute` caveat in `README.md`; verify README matches behaviour
- [x] 7.2 Run `bun run test`, `bun run lint`, `bun run build`; verify all pass
- [x] 7.3 Route the `AGENTS.md` "No agent tools" line update to `agent-engineer`; verify the line is updated
