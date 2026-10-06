# Proposal

## Why

After `fix-correction-marker` the one-time correction still priced nothing on the user's database (1,140 Copilot Claude messages with cache-write tokens, none corrected) yet set its marker. The correction's precondition only checks that some priced Copilot Claude model exists, not that the models present in the data are priced, and nothing is logged, so the runtime catalog state is invisible.

## What Changes

- Each correction run corrects every row whose model is priced (idempotent: only rows with add-on 0). It sets its marker only when every `github-copilot` Claude model with cache-write tokens in the source data is priced; models missing from the catalog (for example retired ones in history) keep opencode's figure and leave the marker unset, so the correction reruns on each start and on `model.updated`.
- The correction logs one line either way: rows priced and models involved on success, or the unpriced models and catalog size when deferring (logged once per distinct situation, not on every retry).
- The correction marker is renamed again so the already-marked database reruns it once.

Out of scope: live-row pricing, schema, display.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cost-retention`: the correction's completeness precondition, logging and marker.

## Impact

- `src/backfill.ts`, `src/store.ts` (marker name), tests. No schema change.
- Follow-up: bump the pinned SHA in ai-dotfiles.

design.md skipped: bug fix confined to one function and one constant, no API/data-model/component-boundary change, no infrastructure, no new dependencies.
