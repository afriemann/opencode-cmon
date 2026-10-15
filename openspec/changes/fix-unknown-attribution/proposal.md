# Proposal

## Why

Users need model, provider and agent totals to remain accurate when the recorder misses a step's start event. Recovery should correct missing attribution where persisted evidence exists, with minimal diagnostics when it does not.

## What Changes

- Recover missing-start step attribution from the exact persisted assistant message, verifying the session; never infer its model from another step.
- Repair missing agent, provider and model fields on existing step rows at startup, preserving known fields and all accounting data.
- Keep recording costs when source attribution cannot be recovered, using `unknown` for unavailable fields rather than another step's attribution; retry unresolved persisted rows on later startups.
- Use read-only, bounded source lookups and concurrency-safe, field-wise repair restricted to step rows.
- Log recovery failures with bounded diagnostic correlation identifiers and categorical reasons, excluding raw session IDs, paths, message content, prompts, credentials and raw database errors; deduplicate repeated failures.
- Document recovery limits and add regression coverage.

## Capabilities

### Modified Capabilities

- `cost-recording`: exact-message attribution recovery, safe repair of existing step rows, and minimal recovery diagnostics.

## Impact

Changes are confined to `src/recorder.ts`, `src/backfill.ts`, `src/store.ts`, `src/index.ts`, the recorder/backfill/store tests, README and this capability's OpenSpec artifacts. No dependency, database schema, public tool/RPC or TUI changes are planned. OpenCode's database remains read-only. Compaction attribution and plugin reload behavior remain unchanged.

The separately authorized local repair of two verified rows has been completed with a secure backup; automatic repair generalizes that correction only to missing fields supported by exact-message evidence.
