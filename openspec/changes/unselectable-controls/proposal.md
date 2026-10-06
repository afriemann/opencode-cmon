# Proposal

## Why

Dragging a text selection across the sidebar picks up the cost block's controls and labels (fold glyph, `This month:`, the `View` row), which are interface chrome, not content.

## What Changes

- In the sidebar block the fold/unfold glyph, the `This month:` label, and the whole `View` row (label and tabs) are not text-selectable.
- The amount and the breakdown lines remain selectable.
- Header is split into a non-selectable label text and a selectable amount text; visible layout is unchanged.
- Out of scope: the footer, behaviour of clicks, any data change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cost-display`: adds a requirement that the block's controls and labels are not selectable.

## Impact

- `src/tui.tsx` (`CostSidebar`), `src/tui.click.test.tsx`, `cost-display` spec. Design skipped: single component, one existing opentui prop (`selectable`), no contracts, infrastructure or dependency changes, no new visual design (layout unchanged).
