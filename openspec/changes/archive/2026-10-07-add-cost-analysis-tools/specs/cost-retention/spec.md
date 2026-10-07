# Spec Delta

## ADDED Requirements

### Requirement: Backfill maps detail fields and failure from opencode.db

The plugin SHALL import output tokens, reasoning tokens, directory and, for steps without an error, the finish reason from opencode.db, and SHALL mark a step as failed when its source message has an error.

#### Scenario: Imported step carries details

- **GIVEN** a source step with output 225, reasoning 25, finish `stop` and a session directory `/work/a`
- **WHEN** the history is imported
- **THEN** the row carries those values

#### Scenario: Errored source step is imported as failed

- **GIVEN** a source step message with an error and token data
- **WHEN** the history is imported
- **THEN** the row is failed and its finish is NULL

### Requirement: Missing details are filled once from opencode.db

The plugin SHALL fill the detail columns of rows not yet checked from opencode.db, mark each row checked even when its source message is absent, and write NULL rather than zero for data the source lacks.

#### Scenario: Fill sets details

- **GIVEN** a row recorded without details whose source message has output, reasoning, finish and a session directory
- **WHEN** the fill runs
- **THEN** the row carries them and is marked checked

#### Scenario: An absent source message is not queried again

- **GIVEN** an unchecked row whose message is absent from the source
- **WHEN** the fill runs twice
- **THEN** its detail columns stay NULL, it is marked checked, and the second run reads nothing for it

#### Scenario: Fill corrects the failed flag of imported steps

- **GIVEN** an imported step stored as not failed whose source message has an error
- **WHEN** the fill runs
- **THEN** the row is failed

#### Scenario: Unavailable source writes nothing

- **GIVEN** unchecked rows and an unreadable source
- **WHEN** the fill runs
- **THEN** no row changes and the next start retries

#### Scenario: Concurrent fills apply once

- **WHEN** two processes fill the same unchecked rows simultaneously
- **THEN** each row is filled once and no stored value is overwritten
