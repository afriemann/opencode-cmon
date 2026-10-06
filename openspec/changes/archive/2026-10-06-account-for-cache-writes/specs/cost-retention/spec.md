## ADDED Requirements

### Requirement: Backfilled rows carry the cache-write add-on

The plugin SHALL compute the add-on for backfilled messages from their stored token counts using the same rule as live recording.

#### Scenario: Backfill computes the add-on

- **GIVEN** a source assistant message of a Copilot Claude model with cache-write tokens
- **WHEN** the backfill runs with a loaded catalog
- **THEN** the imported row carries the add-on

### Requirement: Existing rows are corrected once

The plugin SHALL, once per database and only when the price catalog contains priced `github-copilot` models and `opencode.db` is readable, set the add-on of existing rows whose add-on is 0 from the source message's model and tokens, then set a correction marker in the same transaction, running after backfill and before prune.

#### Scenario: Existing rows are corrected

- **GIVEN** live and backfilled rows with add-on 0 that have source messages
- **WHEN** the correction runs with a loaded catalog
- **THEN** their add-ons are set, the marker is set and `changed` is emitted

#### Scenario: Correction is idempotent

- **WHEN** the correction runs a second time
- **THEN** no row changes

#### Scenario: Empty catalog defers the correction

- **WHEN** the catalog is empty
- **THEN** nothing changes and the marker stays unset

#### Scenario: A catalog without Copilot prices defers the correction

- **WHEN** the catalog has models but none from `github-copilot` with a cost entry
- **THEN** nothing changes and the marker stays unset

#### Scenario: Missing source fails soft

- **WHEN** `opencode.db` is missing or malformed
- **THEN** a warning is logged, the marker stays unset and nothing throws

#### Scenario: Rows without a source message keep zero

- **GIVEN** a row with no matching source message
- **WHEN** the correction runs
- **THEN** its add-on stays 0

#### Scenario: Concurrent corrections apply once

- **WHEN** two processes run the correction simultaneously
- **THEN** each row is updated once and the marker is set

#### Scenario: Catalog refresh triggers a deferred correction

- **GIVEN** the catalog was empty at startup
- **WHEN** a `model.updated` event arrives with a full catalog
- **THEN** the correction runs and `changed` is emitted
