## MODIFIED Requirements

### Requirement: Cost block is collapsed by default

The TUI SHALL render in `sidebar.content` and `home.footer.status` a block that is wrapped by default and shows only "This month: $X.XX", with the glyph `▶` when wrapped and `▼` when opened.

#### Scenario: Default wrapped sidebar

- **WHEN** the sidebar renders for the first time
- **THEN** it shows `▶ This month: $12.34` and no agent lines

#### Scenario: Footer uses the same glyphs

- **WHEN** the footer renders wrapped and then opened
- **THEN** it starts with `▶` when wrapped and `▼` when opened

### Requirement: Loading and error states never break the host

The TUI SHALL show `…` while loading and the word `Error` in the theme's error colour when the RPC fails, without throwing, and SHALL show `$0.00` with an empty breakdown when no rows exist.

#### Scenario: RPC failure

- **WHEN** the RPC call rejects
- **THEN** the block shows `Error` in the error colour

## ADDED Requirements

### Requirement: Sidebar block is placed first

The TUI SHALL claim `sidebar.content` with `prepend` so the cost block renders above the other sidebar sections.

#### Scenario: Sidebar claim is a prepend

- **WHEN** the TUI plugin sets up
- **THEN** its sidebar slot claim uses `prepend: "sidebar.content"`
