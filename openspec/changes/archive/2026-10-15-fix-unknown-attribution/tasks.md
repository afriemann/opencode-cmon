# Tasks

## 1. Exact-message live recovery

- [x] 1.1 Add name-matched recorder/backfill tests for missing-start recovery, observed-start authority, identity/type rejection, partial fields and source failure scenarios (red-step evidence and gaps below).
- [x] 1.2 Implement the source reader and recorder injection in existing modules; verify the group 1 scenarios pass through `bun run test`.
- [x] 1.3 Update the existing `Missing step start falls back` regression and retain the completed-step scenarios; verify no other step's attribution is borrowed and failed-step/compaction contracts still pass.
- [x] 1.4 Document live best-effort recovery and unavailable-source limits in README; verify the text matches the delta scenarios.

## 2. Persistent repair and redelivery

- [x] 2.1 Add name-matched store/backfill tests for startup repair, idempotency, retries, concurrent guards, batch failure and redelivery scenarios (red-step evidence and gaps below).
- [x] 2.2 Implement field-wise guarded step merges and bounded startup repair; verify group 2 tests preserve every non-attribution column and known field.
- [x] 2.3 Wire repair before RPC registration and revision changes only on actual repairs; verify initial summary attribution with existing store/summary interfaces and inspect startup ordering.
- [x] 2.4 Document startup retries and unchanged accounting in README; verify documentation against preservation and retry tests.

## 3. Bounded failure diagnostics

- [x] 3.1 Add failing name-matched integration tests for diagnostic content exclusion, deduplication and non-throwing behavior; verify failures before implementation.
- [x] 3.2 Wire categorical diagnostics through the existing stderr channel; verify group 3 tests and document their safe content and limits in README.

## 4. Integrated verification

- [x] 4.1 Run `bun run test`, `bun run lint` and `bun run build`; verify all exit successfully and scenario names map to the delta or existing main spec.
- [x] 4.2 Perform simplification self-review and mandatory code/domain reviews; verify every blocker is resolved and every warning has an explicit disposition.

## Workflow follow-up

Verification evidence: baseline 265 tests passed. Missing-start/no-inference and completed/failed recovery produced three assertion failures before recorder changes; exact-source and partial-field integration produced five failures before source wiring. Startup repair and redelivery preservation produced six failures before implementation. Diagnostics produced two assertion failures before wiring. Current full suite: 290 passing; lint and build passed.

Workflow deviation: dedicated concurrency, batch-failure, retry and source-lock/resource edge tests were added after their safeguards, rather than observed red first. This is a recorded test-first gap, not a TDD exemption. Those tests now pass, including a real locked synthetic source, a two-connection stale-candidate merge and a failing second repair batch. Observed-start authority and mismatch rejection are preservation/triangulation checks. README changes are documentation, not executable behavior.

Self-review: shared field-wise merge SQL avoids duplicated update rules; exact source access stays in the existing backfill module; no new schema, dependency or recovery timer. Guard comments document accounting and concurrency invariants, not change history. Existing startup fills intentionally keep their own behavior. Deprecated SQLite `exec` calls in touched files use the installed type declarations' documented equivalent `run`. Test LSP errors were corrected; the pre-existing await-on-rejection hint is intentional to retain asynchronous assertion sequencing. Targeted pre-commit hooks, secret scanning, strict spec validation, the 290-test suite, lint and build all pass. All delta scenario titles have name-matched tests; unchanged retention scenarios retain their existing tests.

User approved the retention-spec correction: existing steps preserve accounting on redelivery, including backfills; compactions retain replacement behavior. The matching retention delta retains all existing scenario titles.

Review: code-reviewer approved after a full diff/artifact review and targeted follow-up; agent-engineer domain review found no blockers or security findings. Accepted and fixed: empty startup summary noise, ledger-side failure categorization, overly broad insert conflict suppression, and preservation of the existing per-event ledger error log. Regression assertions failed before these fixes; the final suite passes 290 tests with 523 assertions, plus lint, build and pre-commit checks. A throwing log sink cannot stop the event loop.

Other warning dispositions: suspected stale comments rejected after confirming they describe current behavior; the 50 ms lock-wait versus total I/O latency trade-off is accepted and documented in the design; the retained history scenario title is intentional for archive matching; the approved backfilled-token-null window preserves accounting until existing fills run. Deprecated `exec` alias cleanup is intentional as documented above. The speculative missing busy-timeout warning is rejected: the source helper applies it explicitly. Optional extra ledger reads to skip recovery on redelivery are rejected as unnecessary scope; repeated scenario titles across different tested boundaries are intentional. The suggested missing-message test is already covered by the exact-ID mismatch integration case; no duplicate test was added.

- Commit the reviewed implementation and artifacts, then archive the change and commit archival separately.
- Push, open the task PR, verify remote state and clean up the worktree after successful delivery.
