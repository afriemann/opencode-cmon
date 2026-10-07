# Spec Delta

## MODIFIED Requirements

### Requirement: Schema upgrade is additive and concurrency-safe

The plugin SHALL upgrade `cmon.db` stepwise from any earlier schema version to 3 by adding columns only, under an immediate write transaction that re-reads the schema version, keeping existing rows and refusing any newer version.

#### Scenario: Version 1 database is upgraded

- **GIVEN** a version 1 database with rows
- **WHEN** the store opens
- **THEN** the rows remain with NULL token counts and the version is 3

#### Scenario: Version 2 database is upgraded

- **GIVEN** a version 2 database with rows
- **WHEN** the store opens
- **THEN** the rows remain, the token columns are added with NULL, and the old add-on column is left in place

#### Scenario: Concurrent upgrades both succeed

- **WHEN** two processes open the same version 2 file simultaneously
- **THEN** both succeed and each column exists once

#### Scenario: Newer schema is refused

- **GIVEN** a database with a version above 3
- **WHEN** the store opens
- **THEN** it throws

## ADDED Requirements

### Requirement: Detail columns are added without a version bump

The plugin SHALL add the nullable columns `tokens_output`, `tokens_reasoning`, `finish`, `directory` and `details_checked` to a version 3 `cost_entry` table that lacks them, without changing the schema version.

#### Scenario: Version 3 database gains the detail columns

- **GIVEN** a version 3 database with rows and without the detail columns
- **WHEN** the store opens
- **THEN** the rows remain, the detail columns exist with NULL, and the version is still 3

#### Scenario: Concurrent opens add each detail column once

- **WHEN** two processes open the same version 3 file without detail columns simultaneously
- **THEN** both succeed and each detail column exists once

#### Scenario: An older plugin version still opens the upgraded file

- **GIVEN** a database upgraded with the detail columns
- **WHEN** a store that only knows the version 3 columns opens it and records a row
- **THEN** it succeeds and the row's detail columns are NULL

### Requirement: Rows store output and reasoning tokens

The plugin SHALL store, per row, the output and reasoning token counts when the event carries token data, and NULL when it does not.

#### Scenario: Step output and reasoning tokens are stored

- **WHEN** a completed step with output 225 and reasoning 25 tokens is recorded
- **THEN** the row has output 225 and reasoning 25

#### Scenario: Missing token data stores NULL

- **WHEN** a compaction without token data is recorded
- **THEN** its output and reasoning columns are NULL

#### Scenario: A redelivery keeps stored details

- **GIVEN** a row with stored output, reasoning, finish and directory
- **WHEN** the same message is recorded again without them
- **THEN** the stored values are kept

### Requirement: Completed steps store their finish reason

The plugin SHALL store the finish reason of a step from its `session.step.ended` event, and NULL for failed steps and compactions.

#### Scenario: Ended step stores its finish reason

- **WHEN** a `session.step.ended` with finish `length` is recorded
- **THEN** the row's finish is `length`

#### Scenario: Failed step and compaction have no finish reason

- **WHEN** a failed step and a completed compaction are recorded
- **THEN** their finish columns are NULL

### Requirement: Rows store the project directory

The plugin SHALL store the directory of each row, taken from the event's location when present, otherwise from the session's location, otherwise NULL.

#### Scenario: Event location wins

- **GIVEN** an event with location directory `/work/a` and a session whose location is `/work/b`
- **WHEN** the step is recorded
- **THEN** the row's directory is `/work/a`

#### Scenario: Session location is the fallback

- **GIVEN** an event without a location and a session whose location is `/work/b`
- **WHEN** the step is recorded
- **THEN** the row's directory is `/work/b`

#### Scenario: Unknown directory stays NULL

- **GIVEN** an event without a location and a failing session lookup
- **WHEN** the step is recorded
- **THEN** the row is recorded with a NULL directory
