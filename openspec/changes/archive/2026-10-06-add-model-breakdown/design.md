# Design: per-model breakdown in the opened sidebar

Mode: design. Domain: TUI (opentui/solid), single surface `CostSidebar` in `src/tui.tsx`. Existing design system = the host theme (`context.theme`). Given constraints from the user: toggle visually distinct from the lines; default by-agent; not persisted (local signal in `CostSidebar`); footer unchanged; summary gains `models: {model, micros}[]` sorted by micros desc then name; model label = `providerId/modelId`.

## Theme tokens (verified)

Verified against the opencode v2 theme source (`packages/theme/src/tui/schema.ts`, `CompleteThemeTokensDefinition`; `@opencode/plugin` is not installed in this worktree, so the plugin-types check could not be run — implementer re-confirms by type-check). Tokens in use or chosen:

| Role | Token | Status |
|---|---|---|
| Header, total | `theme.text.base` | in use |
| Breakdown lines | `theme.text.muted` | in use |
| Error word | `theme.text.feedback.error.base` | in use |
| **Toggle row (new)** | `theme.text.action.primary.base` | exists, always defined (complete schema) |

No new colour beyond that one token. `$hovered` etc. exist on the action token but hover styling is rejected (YAGNI; mouse-only terminal feedback is the mode change itself).

## Wireframe (representative sidebar width 40 columns)

Region notes: header row = existing, unchanged, click toggles open/closed. Toggle row = new, own row, `paddingLeft={2}` like the lines, click toggles mode. Lines = label `flexGrow`+`truncate`, amount fixed-width right column (never truncated), `gap={1}`, `paddingLeft={2}`.

Opened, by-agent (default):

```
▼ This month: $12.34
  View  [Agents]  Models
  build                         $8.10
  plan                          $3.00
  explore                       $1.24
```

Opened, by-model:

```
▼ This month: $12.34
  View   Agents  [Models]
  anthropic/claude-sonnet-4-5   $9.00
  openai/gpt-5-mini             $2.10
  anthropic/claude-haiku-4-5…   $1.24
```

(Long label: truncated at the end by the `…` of `truncate`; amount column stays visible. Re-sort is by the RPC; the UI does not sort.)

States (toggle row shown only when `ready`; header always shown):

```
loading:  ▼ This month: …            error:  ▼ This month: Error      (Error in feedback.error.base)
empty (ready, no rows, either mode):
          ▼ This month: $0.00
            View  [Agents]  Models
```

Wrapped: unchanged, `▶ This month: $12.34`, no toggle row.

Resize: header and toggle row are fixed-content; if narrower than ~22 columns the toggle row truncates at the end (drop-priority: nothing; it is never wrapped). Label column flexes and truncates; amount column fixed.

## Toggle styling and active-mode indication

- Row text uses `theme.text.action.primary.base` — a different colour role from the muted lines and the base header, signalling "interactive".
- Non-colour signals (floor: never colour alone, and `NO_COLOR` safe): the label `View`, brackets `[ ]` around the **active** mode only, and bold on the active mode. Inactive mode is plain, unbracketed. State therefore reads correctly in monochrome.
- The two-state control toggles on a click anywhere on the row (single `onMouseDown`), so there is no per-word hit-target ambiguity.
- Contrast: `text.action.primary.base` vs the sidebar background is theme-dependent and not verifiable from this repo; accepted as the host's own interactive token (same trade-off as the existing tokens).

## Behaviour scenarios (for the engineer to transcribe into the delta spec)

- GIVEN the block is opened for the first time WHEN it renders THEN the by-agent list and `[Agents]` active are shown.
- WHEN the toggle row is clicked THEN the list switches to models, `[Models]` becomes active, and the open/closed state, the footer, and storage are untouched.
- WHEN the TUI restarts THEN the mode is by-agent again.
- GIVEN the summary is refreshed (`changed`/interval) WHEN the mode is models THEN the mode stays and the list updates.
- GIVEN no rows WHEN opened THEN `$0.00`, the toggle row, and no lines are shown.

## Verification approach

In-repo snapshot/golden tests (extend `src/tui.test.ts`; no vision MCP). Pure helpers, in the style of the existing `agentLines`/`footerLine`, make this cheap: a `breakdownLines(state, mode)` and a toggle-row text helper returning plain-text for assertion. Cases: both modes, long label, loading, error, empty, footer text unchanged with models present. Before accepting goldens, diff the captured plain-text render structurally against the wireframes above (region order: header, toggle row, lines). Also assert the toggle row is absent when wrapped, loading, and error.

## Implementation breakdown (kinds and done-criteria; not a task list)

- Backend data: summary query + `Summary` type gain `models`, same ordering and cache-write add-on as agents. Done: store tests cover ordering, tie-break by name, add-on included, and sum of models = total.
- TUI front-end: local mode signal, toggle row, list switch. Done: snapshots above pass, footer snapshot unchanged.
- Spec: MODIFIED delta for "Opened block shows cost per agent" and the summary requirement. Done: `openspec validate` clean.

## Concerns about the proposal's scope

1. **Spec deltas are larger than "Modified: cost-display" suggests.** The existing requirement "Opened block shows cost per agent" bundles the footer clause; a MODIFIED delta must restate it whole and keep the footer scenarios verbatim. The summary requirement and the add-on requirement ("per-agent amounts") also need `models`.
2. **Truncation hides the distinguishing part.** `providerId/modelId` truncated at the end keeps the provider and cuts the model id. Acceptable per the user's constraint; if it proves poor, middle/left truncation or dropping the provider prefix is a follow-up, not in scope.
3. **Missing or empty `provider_id`/`model_id`.** Not stated in the proposal. Needs a decision (e.g. label `unknown`) before implementing so rows are not dropped and sum(models) = total.
4. **Keyboard/gamepad reachability.** The toggle (like the existing header) is mouse-only (`onMouseDown`), below the floor of keyboard reachability. Kept for consistency with the existing block; flagged as a known gap.
5. **Mode lost on remount.** A component-local signal resets if the host remounts the sidebar slot; matches "not persisted" but is stricter than "per TUI start". Acceptable.
6. **Hover/pressed feedback not designed**; terminal re-render on click is the feedback.

Boundary: this design covers the interface; `code-reviewer` reviews the resulting code.
