# Monthly usage selector — UX reference

- **Parent / behavior authority:** [Proposal](proposal.md), [product delta](specs/cost-display/spec.md).
- **Scope:** Existing terminal sidebar and home footer only; retain host theme, dollar formatting, recording, tools, refresh/retry and persisted open/closed behavior. This is the change-local UX reference; the design contract links here rather than duplicating it.
- **Read next:** [Design contract](design.md) for token semantics and summary behavior. No formula is defined here.
- **Inputs:** [Terminal UI](../../../../src/tui.tsx), [UI tests](../../../../src/tui.test.ts), [click tests](../../../../src/tui.click.test.tsx).

## Layout and hierarchy

Keep the block first in the sidebar. Header remains `▶ This month: $12.34` when collapsed, `▼` when opened. Only the amount changes units. Keep the current two-column indent beneath the header.

In the opened, ready sidebar, put **View** and **Unit** on separate rows at every width, View first. Example at 45 available container columns:

```text
▼ This month: 1.58B tokens
  View  [Agents]  Models  Providers
  Unit  $  [Tokens]
  build                          1.58B tokens
  explore                          1M tokens
```

- Use two spaces between control segments; no blank row between groups, surrounding panel, icons or new decorative treatment. Preserve existing `View` labels verbatim.
- Active choice is bracketed **and bold**: `[$]` or `[Tokens]`. Inactive choice is bare `$` or `Tokens`. Reuse existing action text styling for controls, base text for header amounts and muted text for breakdowns. Selection must remain clear in monochrome.
- Both groups precede any coverage explanation, then breakdown rows. No selector in the footer or collapsed block.
- Keep complete amounts right-aligned, with at least one blank cell separating name and amount. Names may truncate with `…`; amounts, markers and unit labels may not. Keep `tokens` on every token amount, as required by the product delta.

## Width adaptation (actual container character cells)

- **Measure the sidebar, not the terminal:** width means the panel's available content cells after host sidebar padding/borders, before this panel's two-cell indent. Header, controls and breakdowns must all respond to that same actual container width, including when the terminal is much wider or the sidebar resizes independently.
- **Atomic controls:** each label (`View`, `Unit`) and each complete choice, including selected brackets, is nonshrinking and non-word-wrapping. Never split `Agents`, `Providers` or `Tokens` into letters, clip a bracket, overlap controls, or shrink controls to fit. Extra rows occur only between whole segments; keep every rendered choice clickable on its displayed row.
- **Stable packing:** reserve each choice's bracketed width even when inactive; reserved blank cells are not click targets. Pack each group in order with two-cell gaps, moving a whole segment to the next two-cell-indented row if needed. Never share a View row with Unit. This reserves 37 cells for View and 19 for Unit, plus the two-cell indent, so both groups individually fit at 45 and 40 columns regardless of selection.
- **At 22 columns:** View continues over three rows under this packing rule; Unit still fits on one. Example (reserved blank cells may add spacing):

  ```text
  ▼ This month:
    1.58B tokens
    View  [Agents]
    Models
    Providers
    Unit  $  [Tokens]
    build   1.58B tokens
  ```

- **At 40 columns:** same two control rows as the 45-column example, not a combined row. `▼ This month: 1.58B tokens` fits on one line; names receive less space, but amounts remain complete. These are container widths even on a 120-column terminal.
- **Header amount does not fit:** retain glyph and `This month:` on the first line; move the complete amount to a two-cell-indented continuation line. Applies when open or collapsed. Keep the existing single-line dollar header at 22 columns when it fits.
- **Long breakdown names:** allocate the intact amount first, then one separating cell, then the name. Truncate only the name with `…` if necessary. If fewer than four name cells remain, show the name on its own two-cell-indented line (truncate to that width), then the complete amount on the following two-cell-indented line. Never let name wrapping consume amount or control space. `Tokens unavailable` is also an intact amount. Coverage explanation wraps at word boundaries below all controls.
- At the specified 45/40/22 widths, every control and the compact million/billion examples fit intact. If an exceptional amount cannot fit even alone (for example an unusually large dollar value), preserve its complete text on a dedicated overflow line rather than character-wrap or abbreviate dollars; document any host clipping limitation. Below 22 columns is not a new guaranteed layout target.
- Footer retains its existing **single line with trailing truncation** at its own available host width; do not enlarge it. Format compact token amounts before clipping, total first. Sidebar amounts must not inherit footer truncation.

### Container-width validation

Validate control packing, header fit and breakdown fit in a narrow container inside a wider terminal. Full-terminal-width rendering and width arithmetic tests alone do not establish correct nested-container behavior. Protect control text against shrinking.

## Interaction and session state

1. Start each TUI session in dollars; existing stored open/closed state remains unchanged. On an opened ready sidebar, show `Unit  [$]  Tokens`.
2. Clicking an inactive unit updates the header, current breakdown and footer immediately from available summary data. Keep the block open and the current Agents/Models/Providers choice unchanged. Selecting Tokens also applies token ordering; selecting dollars restores dollar ordering and values.
3. Keep one shared unit choice for both slots throughout refresh, navigation and collapse/reopen, including if a slot remounts. Do not store this preference across restart. Breakdown choice remains independent and does not change footer grouping.
4. Clicking the active unit, `Unit`, `View`, or control-row whitespace does nothing. Consume control-group mouse events so they cannot trigger collapse or any ancestor action. Only each choice's rendered text, including active brackets, is its click target; gaps are not targets. One click produces at most one change.
5. Header and footer retain their current collapse interaction. Unit changes do not create a notification, confirmation, spinner or extra request requirement.
6. Selector chrome is not text-selectable, like existing View controls. Amounts, breakdown names and coverage explanation remain selectable; dragging over them must not select selector text or change the unit.

## Values and feedback states

| State | Sidebar and footer amount | Opened sidebar detail |
|---|---|---|
| Loading | `…`, same glyph/open state | Hide both control groups and breakdowns. Retain the session unit internally. |
| Request error | `Error`, existing error text colour | Hide both control groups and breakdowns. Existing automatic retries remain; no new retry control. Recovery restores selected unit and breakdown. |
| Ready, complete tokens | `1.23k tokens` | Unit selector available; every breakdown includes the unit: `1 token` for exactly one, otherwise `tokens`. |
| Ready, partially known tokens | `~1.23k tokens` | Show `Partial: some token counts unavailable` immediately below controls. Prefix only affected breakdown subtotals with `~`; unaffected entries stay unmarked. |
| Existing usage, no available counts | `Tokens unavailable` | Keep selector available so dollars remain reachable. Affected breakdown values use `Tokens unavailable`, never `0 tokens`. Show the same partial-coverage explanation; no request-error styling. |
| Older server without token summary | `Tokens unavailable` | Same unavailable treatment. Do not invent missing breakdown entries or throw; returning to dollars restores existing usable content. |
| Empty month, first run or after retention/month rollover | `$0.00` or `0 tokens` | Empty breakdown, selectors available, no partial warning. Normal model activity populates first-run usage through the existing recording and refresh path; no setup form or disabled primary action. |
| Dollar mode | Existing dollar values and total-only pricing `~` | No token-coverage warning or token markers. Unknown pricing alone must not mark complete token counts partial. |

Unavailable/partial token history is a ready state, not a failed request. All sidebar/footer token amounts follow the product delta: exact integers below 1,000; decimal `k`/`M`/`B` thereafter, nearest rounding (half up) to at most two decimals, trimmed zeroes, no grouping commas. Promote rounded `1000k` to `1M` and `1000M` to `1B`; `B` is the highest suffix. Examples: `999 tokens`, `1k tokens`, `1.2k tokens`, `590.98M tokens`, `1.58B tokens`. Keep `~` attached before the number only for missing coverage, not rounding. Ranking and reconciliation use underlying counts, not rounded text; displayed subtotals need not sum exactly. No success toast: updated amounts, order and selected brackets provide feedback.

## Footer

- Closed example: `▶ 1.23k tokens this month`.
- Open example: `▼ 1.23k tokens · build 1k tokens · explore 200 tokens · +1`.
- Always use the selected unit for total and agent amounts, and that unit's top two agents, regardless of sidebar breakdown choice. Retain existing separators, `+N`, glyph and open-state sharing. Apply partial/unavailable formatting per value; keep the explanatory sentence in the sidebar only.

## Terminal accessibility and control states

- Preserve readable plain-text labels and selectable displayed amounts. Brackets/bold convey selection without colour; `Error`, `~` and the coverage sentence carry status without colour. Use host theme roles, not hard-coded colours; verify text contrast against the host background (AA target 4.5:1). No animation or hover-only information.
- **Hover / pressed:** retain the existing View controls' stable text styling; no layout shift or transient unit change. **Selected:** bracketed/bold. **Unavailable controls:** omitted during loading/error rather than misleadingly disabled; available in empty/partial/unavailable ready states.
- Current supplied controls are mouse-driven terminal text, not native focusable widgets: no plugin tab stops, keyboard shortcut, browser ARIA or live-region mechanism is evidenced in the inspected UI. Preserve host keyboard handling; do not hijack Tab or typing or claim screen-reader/keyboard compliance. Reading order is header → View choices → Unit choices → coverage → breakdowns.
- If a supported native host focus path is available, reuse it: follow that reading order, show a visible focus indicator distinct from selection, activate choices with Enter/Space, and retain focus on the activated choice. Do not silently introduce a new navigation system. Document any remaining keyboard/screen-reader limitation; full WCAG compliance is not established by this mouse-only change. Terminal cell targets cannot promise a 44px touch target; touch-browser affordances are outside this scope.

## Validation criteria and verified coverage

- Preserve established token semantics and dollar/tool contracts alongside compact formatting and actual-container fit. Document host measurement/overflow and keyboard/screen-reader limitations, not a terminal-full-width assumption.
- Use rendered frame and coordinate-click checks at actual panel widths 45, 40 and 22 inside a wider terminal (for example 120 columns), plus resize at fixed terminal width. Cover all six unit/breakdown combinations; complete control words/brackets, nonoverlap, intact amounts and long-name truncation/stacking. Click each choice after reflow, including selected brackets; labels/gaps/active clicks must not collapse or trigger ancestors. Test dragging/selectability and unchanged keyboard handling.
- Verify compact-format boundaries and promotion against the product table, singular/plural, partial/unavailable/empty states, long names, differing rankings that round to the same string, footer one-line truncation, both switch directions, shared mode/navigation, restart defaults and recovery. All existing dollar/tool behavior remains unchanged. Frame/click proof is required; pure formatting/packing assertions alone do not prove sidebar readability.

### Completed verification

The [verification record](tasks.md#verification-result) confirms these UI criteria pass for candidate `abc25236cd1f1532704654b7881ed1d05052a977`:

- **Nested renderer:** actual 45/40/22-cell parents inside a 120-cell terminal, independent parent resize, rendered frames and coordinate clicks establish container adaptation, intact controls/amounts and all six unit/breakdown combinations. This is renderer proof, not a claim that the installed host allocates those three sidebar widths.
- **Installed host:** the supported OpenCode 2.0.24 sidebar was measured at **37 available cells**. Real RPC, shared footer, plugin replacement, collapse/reopen and unchanged inputs pass at that host geometry. The 37-cell result complements rather than replaces the 45/40/22-cell renderer coverage; no host geometry was altered to simulate those allocations. Retained host checks also cover restart and compatibility replies.
- **Provider-backed first use:** the accepted Windows OpenCode 2.1.4 variant uses existing authentication with an empty isolated ledger. Normal activity refreshes both rendered unit views to nine recorded tokens; switching leaves settled accounting, revision and dollar summary unchanged. This is not new-authentication onboarding, an entirely empty global installation or provider execution on Linux 2.0.24.

These checks are complete, not outstanding acceptance tasks. Exceptional amounts wider than their dedicated line, hidden/zero-width host layout behavior and keyboard/screen-reader access remain limitations, not passed assertions. The supported host's settled padding/available width is measured; arbitrary host allocations are not promised. See the linked verification record for evidence scope and reuse; no deployment or release execution is claimed.

**Accessibility limitation:** the inspected plugin provides no keyboard/focus or screen-reader contract; do not represent this reference as proof of AA conformance.
