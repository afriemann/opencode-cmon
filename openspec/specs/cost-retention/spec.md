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
