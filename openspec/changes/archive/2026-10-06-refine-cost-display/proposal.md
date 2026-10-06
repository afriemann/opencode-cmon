# Proposal

## Why

After first live use the cost block is easy to miss and inconsistent with its neighbours: a failure shows only a dim `—`, the block sits last in the sidebar under Todos, and its toggle glyph is smaller than the MCP/Todos ones.

## What Changes

- A failed fetch shows the word `Error` in the theme's error colour (sidebar header and footer) instead of `—`.
- The sidebar block is placed first in `sidebar.content` (prepend), above Context.
- Toggle glyphs become `▶` (wrapped) / `▼` (opened), in both the sidebar and the home footer, and the sidebar header title is bold like MCP and Todos.

Out of scope: any change to recording, retention, RPC, or the `…` loading placeholder.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cost-display`: collapsed-by-default glyph, error state presentation, and sidebar placement.

## Impact

- `src/tui.tsx` and `src/tui.test.ts` only. No dependency or schema change.
- Follow-up: bump the pinned SHA in `ai-dotfiles`.

design.md skipped: pure presentation tweak, one module, no API/data/component-boundary change, no infrastructure, no new dependencies.
