# Proposal

## Why

The one-time cache-write correction ran at startup against a partly loaded model catalog (Copilot models present, Claude models not yet), priced nothing, and still set its done marker. Existing rows therefore kept a zero add-on and the monthly total did not rise. Observed live: 1,095 month messages with cache-write tokens, only rows recorded after the restart carried an add-on.

## What Changes

- The correction waits until the catalog contains at least one priced `github-copilot` Claude model (the models it can price), not merely any priced Copilot model.
- The correction marker gets a new name so installs that already set the premature marker run the correction once more.

Out of scope: live-row pricing, schema, display, any other behaviour.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cost-retention`: the correction's catalog precondition and marker.

## Impact

- `src/pricing.ts` (predicate), `src/backfill.ts`, `src/store.ts` (marker name), tests. No schema change.
- Follow-up: bump the pinned SHA in ai-dotfiles.

design.md skipped: pure bug fix, one precondition and one constant, no API/data-model/component-boundary change, no infrastructure, no new dependencies.
