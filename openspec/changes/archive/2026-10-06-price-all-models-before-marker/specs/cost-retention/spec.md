## MODIFIED Requirements

### Requirement: Existing rows are corrected once

The plugin SHALL, whenever `opencode.db` is readable and the price catalog contains a priced `github-copilot` Claude model and until it is complete, set the add-on of existing rows whose add-on is 0 from the source message's model and tokens, for every row whose model is priced, and SHALL set a correction marker in the same transaction only when every `github-copilot` Claude model that has cache-write tokens in the source data has a priced catalog entry, running after backfill and before prune. A marker written by an earlier plugin version that corrected against an incomplete catalog MUST NOT suppress the correction. The correction SHALL log how many rows it priced, or which models remain unpriced, without repeating an unchanged message.

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

#### Scenario: An unpriced model does not block pricing the others

- **GIVEN** source messages of `claude-sonnet-4.6` and `claude-opus-9` with cache-write tokens and a catalog that prices only the first
- **WHEN** the correction runs
- **THEN** the `claude-sonnet-4.6` rows are corrected, the `claude-opus-9` rows keep add-on 0, the marker stays unset and the log names `claude-opus-9`

#### Scenario: A repeated deferral is logged once

- **WHEN** the correction runs again with the same unpriced models
- **THEN** the deferral message is not logged again

#### Scenario: A successful correction logs what it priced

- **WHEN** the correction completes
- **THEN** it logs the number of rows priced

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
