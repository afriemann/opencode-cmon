# Tasks

## 1. Scaffold

- [x] 1.1 package.json, tsconfig(.build).json, eslint config, build script (mirror opencode-todo), README
- [x] 1.2 Install deps; verify `bun test` and lint run on an empty suite

## 2. Pure logic (TDD)

- [x] 2.1 money.ts (micro-USD, format) — "Sums are exact"
- [x] 2.2 time.ts (month range, retention cutoff) — "Month range across DST"
- [x] 2.3 recorder.ts — all cost-recording scenarios

## 3. Store (TDD)

- [x] 3.1 store.ts schema, WAL, migrations, upsert, summary, prune — recording, retention-prune, range-bound and concurrency scenarios
- [x] 3.2 backfill.ts with fixtures — all backfill scenarios incl. schema mismatch and read-only

## 4. Server plugin

- [x] 4.1 rpc.ts contract and index.ts wiring (event loop, parent lookup cache, backfill then prune, 24 h timer, cleanup)

## 5. TUI (TDD)

- [x] 5.1 useMonthlyCost hook, sidebar and footer components, shared persisted state — all cost-display scenarios
- [ ] 5.2 Verify rendered output against design.md wireframes (live, after install via ai-dotfiles)

## 6. Verify

- [x] 6.1 Full tests, lint, build to dist/ (live load in opencode follows ai-dotfiles install)
