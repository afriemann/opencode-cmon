# Tasks

## 1. Retry on error

- [x] 1.1 Add failing fake-timer tests in `src/tui.test.ts` named after the three scenarios; verify they fail first
- [x] 1.2 Add `ERROR_RETRY_INTERVAL_MS` and the retry timer to `createCostFeed` (single timer, cancelled on success and cleanup); verify the suite, tsc, lint and build pass
