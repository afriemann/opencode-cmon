# Tasks

## 1. Summary shape

- [x] 1.1 Add failing `src/store.test.ts` tests (model grouped by bare id merging providers; providers grouped by id; ordering, add-on, sums equal total), then change `ModelTotal`, add `ProviderTotal`/`Summary.providers` in `src/types.ts` and the queries in `Store.summary`; verify store tests pass

## 2. Sidebar tabs

- [x] 2.1 Add failing `src/tui.test.ts` tests: `breakdownLines` per mode, older-server summary for models and providers, `toggleSegments` text per active tab, and click routing via `testRender` + `mockMouse.click` (Models, Providers, `View`, gap, active tab); verify they fail first
- [x] 2.2 Implement three-mode `Breakdown`, per-word click targets in `CostSidebar`; verify tests, tsc, lint, build pass and footer tests are unchanged

## 3. Docs

- [x] 3.1 Update the toggle sentence in `README.md`; verify it names the three tabs
