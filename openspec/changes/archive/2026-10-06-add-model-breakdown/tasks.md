# Tasks

## 1. Summary returns per-model sums

- [x] 1.1 Add failing `src/store.test.ts` tests "Models are grouped by provider and model" (ordering, name tie-break, cache-write add-on included, sum equals total), then add `ModelTotal`/`Summary.models` in `src/types.ts` and the grouped query in `Store.summary`; verify the store tests pass

## 2. Sidebar toggle

- [x] 2.1 Add failing `src/tui.test.ts` tests for pure helpers: breakdown lines per mode, empty/loading/error give no lines, toggle row text for each active mode, toggle absent unless ready; verify they fail first
- [x] 2.2 Generalise `agentLines` to a mode-aware helper, add the toggle-row helper, a local mode signal (default agent) and the clickable toggle row in `CostSidebar` using `theme.text.action.primary.base`; verify tests pass and footer tests are unchanged and green
- [x] 2.3 Type-check the theme token against the installed plugin types and run lint, build and the full suite; verify all are clean

## 3. Docs

- [x] 3.1 Update `README.md` if it describes the opened block; verify it mentions the toggle (or record that it does not describe the block)
