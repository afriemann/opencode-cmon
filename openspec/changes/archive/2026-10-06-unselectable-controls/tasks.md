# Tasks

## 1. Unselectable chrome

- [x] 1.1 Add failing tests in `src/tui.click.test.tsx` ("Chrome is not selectable": glyph, `This month:`, `View`, tabs not selectable; amount and lines selectable; header text unchanged; "Controls still work": header and tab clicks); verify they fail first
- [x] 1.2 Add `selectable={false}` to the glyph, a split `This month:` text and the four toggle-row texts in `CostSidebar`; verify suite, tsc, lint, build pass and a drag selection skips the chrome
