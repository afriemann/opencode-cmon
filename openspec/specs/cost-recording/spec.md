# cost-recording Specification

## Purpose

TBD - created by archiving change add-monthly-cost-tracking. Update Purpose after archive.

## Requirements

### Requirement: Completed steps are recorded with attribution

The plugin SHALL record the cost of every completed model step in `cmon.db`, keyed by assistant message ID, with the agent and model of that step, the session ID, the parent session ID and a UTC epoch-millisecond timestamp.

#### Scenario: Records a completed step

- **GIVEN** a `session.step.started` for agent `build` and model `github-copilot/claude-sonnet-4.6`
- **WHEN** the matching `session.step.ended` arrives with cost 0.0123
- **THEN** one row exists with that message ID, agent `build`, that model and cost 12300 micro-USD

#### Scenario: Sub-agent cost is attributed to the sub-agent

- **GIVEN** a session whose parent session is `ses_parent` and whose step agent is `explore`
- **WHEN** its step ends with a cost
- **THEN** the row has agent `explore` and parent session `ses_parent`

#### Scenario: Redelivered event does not double count

- **GIVEN** a step row already recorded for a message ID
- **WHEN** the same `session.step.ended` is delivered again
- **THEN** the table still holds exactly one row for that message ID

#### Scenario: Missing step start falls back

- **GIVEN** no `session.step.started` was observed for a message
- **WHEN** its `session.step.ended` arrives
- **THEN** the row uses the session's last known agent, or `unknown` when none exists

### Requirement: Failed steps count only with cost and tokens

The plugin SHALL record a failed step only when both its cost and its tokens are present.

#### Scenario: Failed step with cost and tokens is recorded

- **WHEN** a `session.step.failed` carries cost and tokens
- **THEN** a row is stored with the failed flag set

#### Scenario: Failed step without cost is ignored

- **WHEN** a `session.step.failed` carries no cost or no tokens
- **THEN** no row is stored

### Requirement: Compactions are recorded

The plugin SHALL record the cost of every completed or failed (with cost and tokens) compaction, keyed by the compaction message ID and attributed to the session's last step agent, or `compaction` when none is known.

#### Scenario: Records a completed compaction

- **GIVEN** a `session.compaction.started` with `inputID` `msg_c1` in a session whose last agent is `build`
- **WHEN** `session.compaction.ended` arrives with a cost
- **THEN** a row with kind `compaction`, id `msg_c1` and agent `build` exists

### Requirement: Costs are stored as integer micro-USD

The plugin SHALL convert each USD cost to integer micro-USD once at ingest and sum only integers.

#### Scenario: Sums are exact

- **GIVEN** three rows each costing 0.1 USD
- **WHEN** the monthly total is computed
- **THEN** it equals exactly 300000 micro-USD

### Requirement: Concurrent server processes share one database safely

The plugin SHALL open `cmon.db` in WAL mode with a busy timeout so several opencode server processes can write concurrently without losing or duplicating rows.

#### Scenario: Two processes record the same event

- **WHEN** two store instances on one file record the same message ID
- **THEN** exactly one row exists

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

### Requirement: Rows store the token counts needed for pricing

The plugin SHALL store, per row, the input, cache-read and cache-write token counts alongside opencode's own cost, storing NULL for all three only when the event carries no token data.

#### Scenario: Step tokens are stored

- **WHEN** a completed or failed step with tokens is recorded
- **THEN** the row carries its input, cache-read and cache-write counts and `cost_micros` keeps opencode's own cost

#### Scenario: Compaction without tokens stores NULL

- **WHEN** a completed compaction arrives without token data
- **THEN** its token columns are NULL

#### Scenario: A malformed token object stores zeros

- **WHEN** an event carries a token object with a missing sub-field
- **THEN** the missing counts are stored as 0

#### Scenario: A redelivery keeps stored tokens

- **GIVEN** a row with stored tokens
- **WHEN** the same message is recorded again without token data
- **THEN** the stored tokens are kept

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
