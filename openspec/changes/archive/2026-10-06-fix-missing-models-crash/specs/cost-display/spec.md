## ADDED Requirements

### Requirement: Sidebar tolerates a summary without a model list

The sidebar SHALL show no breakdown lines, and SHALL NOT throw, when the by-model breakdown is selected and the received summary has no model list.

#### Scenario: Summary from an older server

- **GIVEN** a summary that has agents but no model list
- **WHEN** the by-model breakdown is selected
- **THEN** no lines are shown and nothing throws
