## MODIFIED Requirements

### Requirement: Existing rows are corrected once

The plugin SHALL, once per database and only when the price catalog contains a priced `github-copilot` Claude model and `opencode.db` is readable, set the add-on of existing rows whose add-on is 0 from the source message's model and tokens, then set a correction marker in the same transaction, running after backfill and before prune. A marker written by an earlier plugin version that corrected against an incomplete catalog MUST NOT suppress the correction.

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

#### Scenario: A catalog with Copilot but no Claude prices defers the correction

- **WHEN** the catalog has priced `github-copilot` models but none of them is Claude
- **THEN** nothing changes and the marker stays unset

#### Scenario: A premature earlier marker does not suppress the correction

- **GIVEN** a database whose only marker is the one set by the earlier plugin version
- **WHEN** the correction runs with a catalog containing a priced Copilot Claude model
- **THEN** the add-ons are set and the new marker is set

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
