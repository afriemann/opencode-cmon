## ADDED Requirements

### Requirement: Sidebar controls and labels are not text-selectable

The sidebar block SHALL exclude the fold/unfold glyph, the `This month:` label and the whole `View` row from text selection while leaving the amount and the breakdown lines selectable.

#### Scenario: Chrome is not selectable

- **WHEN** the sidebar block is opened
- **THEN** the glyph, the `This month:` label, the `View` label and each tab are not selectable, and the amount and the breakdown lines are selectable

#### Scenario: Controls still work

- **WHEN** the header or a tab is clicked
- **THEN** the block opens or closes, or the breakdown switches, as before

#### Scenario: A drag across the block selects only the content

- **GIVEN** the sidebar block is opened
- **WHEN** a text selection is dragged across the header and the `View` row
- **THEN** the selected text contains the breakdown content and none of the glyph, `This month:` or `View` labels
