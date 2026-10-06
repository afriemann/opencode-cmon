# Design: provider breakdown and three-way tab row

Mode: design. Domain: TUI (opentui/solid), surface `CostSidebar` in `src/tui.tsx`. Builds on the archived `add-model-breakdown` design; only deltas are stated. Unchanged: theme tokens (`text.base` header, `text.muted` lines, `feedback.error.base` error, `text.action.primary.base` for the tab row), header click toggles open/closed, default tab Agents, not persisted (local signal), footer unchanged, loading/error show no tab row, wrapped shows no tab row, mouse-only (known gap, as before).

## What changes

1. Tab row: three click targets, one per word. Replaces click-anywhere-flips (the single `onMouseDown` on the row is removed).
2. Model lines: label is the bare model id (`e.model`), no `providerId/` prefix.
3. New Providers tab, same line shape (label flexGrow+truncate, fixed amount column).
4. Lists come from the RPC already sorted (micros desc, name); the UI does not sort.

## Tab row

Row: `paddingLeft={2}`, `gap={2}`, fixed content, action colour token on every word. Each of `Agents`, `Models`, `Providers` is its own `<text>` with its own `onMouseDown` that sets the tab to that value (idempotent: clicking the active tab changes nothing). `View` is a label, not a target.

Non-colour signals (unchanged rule): active tab bracketed AND bold; inactive plain. Brackets add 2 columns only to the active word, so the row width varies by tab (33 to 35 columns incl. indent). Targets are the rendered word including its brackets.

Clicks that hit no target: on `View` or in the gaps/indent/empty remainder of the row, nothing happens (no flip, no open/close, no bubbling to the header). Gaps are not part of any word's box, so this follows from per-word handlers; the row container has no handler.

```
Agents                          Models                          Providers
▼ This month: $12.34            ▼ This month: $12.34            ▼ This month: $12.34
  View  [Agents]  Models  Providers   View   Agents  [Models]  Providers   View   Agents   Models  [Providers]
```

Full wireframes at 40 columns:

```
Agents (default)                   Models                             Providers
▼ This month: $12.34               ▼ This month: $12.34               ▼ This month: $12.34
  View  [Agents]  Models  Providers  View  Agents  [Models]  Providers  View  Agents  Models  [Providers]
  build                   $8.10      claude-sonnet-4-5       $9.00      anthropic               $9.00
  plan                    $3.00      gpt-5-mini              $2.10      openai                  $2.10
  explore                 $1.24      claude-haiku-4-5        $1.24      github-copilot          $1.24
```

(Columns above are illustrative side-by-side; in the sidebar each is a single column. Each tab is one view of the same total: rows sum to the header amount.)

States (tab row only when `ready`; header always):

```
loading: ▼ This month: …      error: ▼ This month: Error (feedback.error.base)
empty (ready, no rows, any tab):
         ▼ This month: $0.00
           View  [Providers]  ...  (tab row shown, active tab bracketed, no lines)
wrapped: ▶ This month: $12.34   (no tab row)
```

Same-id merge: one model id served by two providers appears as one Models line with the summed amount (done in the RPC).

## Narrow width

Region notes: indent fixed 2; `View`, each tab word fixed-width, never wrapped. Row is ~34 cols; sidebar may be narrower.

- Drop-priority when the row does not fit: truncate from the end (rightmost clipped first: `Providers`, then `Models`). Nothing reflows to a second line.
- Consequence: a clipped tab may be unreachable by mouse at very narrow widths. Accepted floor: below ~34 columns the rightmost tab can be partly or wholly hidden; the active-tab bracket may also clip. Alternative considered and rejected (YAGNI): dropping `View` first (saves 6 cols) or wrapping the row. If narrow sidebars are common, dropping the `View` label first is the recommended follow-up; not in scope. Flag to the user as a decision: ship clip-only, or drop `View` below a threshold.
- Lines keep the existing rule: label flexes and truncates with `…`, amount column never truncated. Bare model ids are shorter, so truncation is rarer.

## Behaviour scenarios (for the engineer to transcribe)

- GIVEN the block opens for the first time THEN the Agents list and `[Agents]` are shown.
- WHEN `Models` is clicked THEN the list shows bare model ids, `[Models]` is active, and open/closed state, footer, and storage are untouched.
- WHEN `Providers` is clicked THEN the list shows one line per provider id and `[Providers]` is active.
- WHEN the active tab word is clicked THEN nothing changes.
- WHEN `View`, a gap, or the empty part of the row is clicked THEN nothing changes and the block stays open.
- WHEN the TUI restarts THEN the tab is Agents.
- GIVEN the summary refreshes WHEN a tab is active THEN the tab stays and the list updates.
- GIVEN the summary lacks `models` or `providers` (older server) WHEN that tab is active THEN the list is empty, no error, the tab row stays.
- GIVEN two providers serve the same model id THEN Models shows one line with the combined amount.

## Verification approach

Pure helpers (extend the existing style): `breakdownLines(state, tab)` for all three tabs (including undefined `models`/`providers`), and `toggleSegments(active)` returning the ordered segments (`View`, then three tab words with bracket/bold on the active one) for plain-text assertion. Snapshot/golden cases in `src/tui.test.ts`: three tabs, long label, loading, error, empty, wrapped, footer unchanged. Diff goldens structurally against the wireframes (region order: header, tab row, lines) before accepting.

Click routing must be tested through real input, not helper-only: use opentui `testRender` with `mockMouse.click(x, y)` (already used for the repro). Cases: click each word's column range selects that tab; click on `View`, in a gap, and at the row's right remainder leaves the tab unchanged and the block open; clicking the active word is a no-op; header click still toggles open/closed; click position is computed from the rendered row (indent 2, gap 2) not hard-coded per tab, since active-bracketing shifts later words by 1 column on each side. Add a narrow-width render asserting the row clips at the end without wrapping.

## Implementation breakdown (kinds and done-criteria)

- Backend data: `Summary` gains `providers: {provider, micros}[]`; `models` keyed by model id only (merge across providers); same ordering and cache-write add-on. Done: store tests cover merge, ordering, tie-break, sum of each list = total. Decision needed: missing/empty `provider_id` or `model_id` label (`unknown`) so sums stay equal to total.
- TUI front-end: three-value tab signal, per-word targets, helper changes. Done: goldens and mockMouse click tests pass; footer snapshot unchanged.
- Spec: MODIFIED deltas must restate the whole requirements touched (opened block, summary shape, older-server tolerance) including footer scenarios verbatim. Done: `openspec validate` clean.

Boundary: this covers the interface; `code-reviewer` reviews the resulting code.
