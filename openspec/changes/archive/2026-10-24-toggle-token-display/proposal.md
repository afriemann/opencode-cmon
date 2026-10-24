# Toggle token display

Keep monthly dollar reporting and let users inspect token usage in the same panel.

- **Parent:** [Current cost-display capability](../../../specs/cost-display/spec.md).
- **Covered outcomes:** Switch units without losing dollar reporting; honest historical token coverage; compact amounts and readable narrow controls.
- **Read next:** [Product behavior delta](specs/cost-display/spec.md).

## Why

Dollars describe spend, but users also need to compare monthly token usage across agents, models and providers without leaving the usage panel or losing the existing cost view.

## Direction Check

- **Subject:** The onscreen usage panel; **desired outcome:** readable compact token amounts and intact controls in a narrow sidebar, retaining both units.
- **Problem:** Long exact counts crowd names and selector labels fragment midword. Compact formatting and readable controls address that display problem without changing accounting or reporting tools.

## What Changes

- Add a clickable unit selector to the opened, ready sidebar. Its selection applies to the sidebar and home footer totals and breakdown amounts, including when collapsed.
- Start each TUI session in dollars. Keep the selection during refresh, collapse/reopen and navigation within that session; do not persist it across restart. This matches the existing session-only breakdown choice and avoids introducing a saved preference.
- Show clearly labelled compact token amounts using decimal `k` (thousand), `M` (million) and `B` (billion), at most two fractional digits, trimmed trailing zeroes and unit promotion at rounding boundaries. Counts below 1,000 remain exact.
- Keep controls readable at a sidebar content width of 45 character cells: no midword control-label breaks, jumbled choices or overlap between names and amounts. Layout details are defined in the [UI specification](ux.md).
- Preserve underlying counts, aggregation and ranking; mark incomplete historical coverage separately from incomplete pricing.
- Preserve historical rows and all existing dollar results. A new installation can start at zero and acquire usage through normal recorded model activity, without manual data setup.

## User Stories

- As a plugin user, I want to switch between dollars and tokens, so that I can compare spend and usage without losing either view.
- As a user with older history, I want unavailable token counts distinguished from zero, so that I do not mistake missing data for low usage.
- As a user with a narrow sidebar, I want compact usage amounts and intact selector labels, so that I can read usage and switch views without deciphering fragmented text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cost-display`: unit selection, token totals and existing agent/model/provider breakdowns, formatting and coverage feedback.

## Impact and Non-goals

- No changes to `cost_report`, `cost_hotspots`, dollar calculation/pricing, recording policy, retention, historical repair policy or unrelated refactors. No token-type drilldown, new reporting filters or user-managed data setup.
- Existing monthly range, attribution, refresh, retry, collapse behavior and footer's one-line/top-two-agent layout remain in force.

## Technical Dependencies

- The token-counting formula must be grounded in supported OpenCode source semantics for live and historical records, including whether cached input overlaps input and reasoning overlaps output. Existing ledger field names alone do not establish those semantics. The [design contract](design.md) defines the non-double-counting formula and missing-field rules.

## Related Artifacts

- [Product acceptance criteria](specs/cost-display/spec.md)
- [Existing token recording behavior](../../../specs/cost-recording/spec.md)
- [Existing history/retention behavior](../../../specs/cost-retention/spec.md)
- Relevant source: `src/tui.tsx`, `src/types.ts`, `src/summary.ts`, `src/rpc.ts`, `src/store.ts`.
