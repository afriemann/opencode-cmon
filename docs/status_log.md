# Code changes

## Dollar and token display

- Clickable `$` and `Tokens` controls switch the monthly total and agent, model and provider breakdowns.
- Dollars are the default; the selected unit is shared by the sidebar and footer for the current session.
- Token totals include input, output, reasoning, cached reads and cached writes without double counting.
- Compact decimal suffixes `k`, `M` and `B` use up to two fractional digits; exact counts and sorting remain unchanged internally.
- Partial token coverage is marked explicitly; unavailable counts are not presented as zero.

## Responsive panel

- Breakdown and unit controls use separate rows and wrap only between complete choices.
- Layout follows the panel's available width rather than the terminal's full width.
- Long breakdown names truncate before numeric amounts.

## Installation

- Local directory configuration points to the built `dist` directory, which contains server, TUI and RPC entrypoints.
- [Installation and update instructions](../README.md) cover Windows, macOS and Linux.

Dollar calculations, reporting tools, recording, retention and historical repair behavior are unaffected by display-unit selection.

## Specifications and validation

- [Display requirements](../openspec/specs/cost-display/spec.md) cover both units, compatibility, formatting and incomplete data.
- [Change record](../openspec/changes/archive/2026-10-24-toggle-token-display/proposal.md) includes the display design, layout and executable coverage.
- Validation covers rendered controls, real RPC compatibility, reload and a zero-to-recorded-usage workflow with disposable data and existing authentication. New-account authentication onboarding is not covered.
- Implementation, baseline reconciliation and the archived change record are reviewed together in [PR #1](https://github.com/renl/opencode-cmon-tokens/pull/1).
