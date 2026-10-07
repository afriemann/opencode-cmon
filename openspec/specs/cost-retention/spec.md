# cost-retention Specification

## Purpose

TBD - created by archiving change add-monthly-cost-tracking. Update Purpose after archive.

## Requirements

### Requirement: Rows older than six months are pruned

The plugin SHALL delete rows whose timestamp is older than six calendar months in local time, on startup and every 24 hours.

#### Scenario: Old rows are removed at startup

- **GIVEN** a row dated seven months ago and a row dated yesterday
- **WHEN** the plugin starts
- **THEN** only the row from yesterday remains

#### Scenario: Pruning repeats daily

- **WHEN** 24 hours elapse while the plugin runs
- **THEN** the prune runs again

### Requirement: History is backfilled once from opencode.db

The plugin SHALL, until a backfill marker is set, import assistant and compaction messages from the last six months from `opencode.db` through a read-only connection, keyed by message ID, and then set the marker.

#### Scenario: First start imports history

- **GIVEN** `opencode.db` holds assistant and compaction messages within six months, one of them with a parent session
- **WHEN** the plugin starts with no marker
- **THEN** each message appears once with its agent, model, cost and parent session, and the marker is set

#### Scenario: Second start does not re-import

- **GIVEN** the marker is set
- **WHEN** the plugin starts again
- **THEN** `opencode.db` is not read

#### Scenario: Live data wins over backfilled data

- **GIVEN** a backfilled row for message `m1`
- **WHEN** a live event for `m1` is recorded
- **THEN** the row reflects the live values

#### Scenario: Simultaneous starts import once

- **WHEN** two processes run the backfill at the same time
- **THEN** the row count equals the number of source messages

#### Scenario: Schema mismatch fails soft

- **GIVEN** `opencode.db` lacks the expected tables or columns
- **WHEN** the backfill runs
- **THEN** a warning is logged, the marker stays unset, nothing throws, and live recording continues

### Requirement: opencode.db is never modified

The plugin MUST NOT write to `opencode.db`.

#### Scenario: Source opened read-only

- **WHEN** the backfill opens `opencode.db`
- **THEN** the connection is read-only

### Requirement: Backfilled rows carry token counts

The plugin SHALL store the input, cache-read and cache-write token counts of backfilled messages.

#### Scenario: Backfill stores tokens

- **GIVEN** a source assistant message with token counts
- **WHEN** the backfill runs
- **THEN** the imported row carries those counts

### Requirement: Missing token counts are filled from opencode.db

The plugin SHALL, on every start while rows without token counts exist, read their messages from `opencode.db` by id through a read-only connection and set the counts of rows that still have none, writing zeros only for messages confirmed absent or without token data by a successful read.

#### Scenario: Fill sets tokens

- **GIVEN** rows with NULL token counts whose source messages have tokens
- **WHEN** the plugin starts
- **THEN** the counts are set

#### Scenario: Fill is idempotent without a marker

- **WHEN** the fill runs again
- **THEN** no row changes and the source is not opened when no row lacks tokens

#### Scenario: Unavailable source writes nothing

- **WHEN** `opencode.db` is missing, locked or malformed
- **THEN** a warning is logged, no counts are written and the next start retries

#### Scenario: A confirmed-absent message gets zero tokens

- **GIVEN** a row whose id is absent from a successfully read source
- **WHEN** the fill runs
- **THEN** its counts are set to 0

#### Scenario: Concurrent fills apply once

- **WHEN** two processes run the fill simultaneously
- **THEN** each row is updated once

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
