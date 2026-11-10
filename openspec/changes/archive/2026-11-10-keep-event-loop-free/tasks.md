# Tasks

## 1. Responsive gap lookup

- [x] 1.1 Add the `(session_id, kind, created_at)` index to the schema and ensure it on existing databases; "Gap lookup stays fast with a large ledger" passes
- [x] 1.2 Make `stepGaps` asynchronous, yielding between batches of sessions, and await it in `loadInput`; "Other work runs during a call over many sessions" passes
