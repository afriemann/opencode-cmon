## MODIFIED Requirements

### Requirement: History is backfilled once from opencode.db

The plugin SHALL, until a backfill marker is set, import assistant and compaction messages from the last six months from `opencode.db` through a read-only connection, keyed by message ID, and then set the marker.

#### Scenario: First start imports history

- **GIVEN** `opencode.db` holds assistant and compaction messages within six months, one of them with a parent session
- **WHEN** the plugin starts with no marker
- **THEN** each message appears once with its agent, model, cost and parent session, and the marker is set

#### Scenario: Second start does not re-import

- **GIVEN** the marker is set
- **WHEN** startup considers the one-time history import
- **THEN** history is not re-imported; independent missing-field repair passes may still read the source

#### Scenario: Live data wins over backfilled data

- **GIVEN** a backfilled row for message `m1`
- **WHEN** a live event for `m1` is recorded
- **THEN** an existing step keeps its accounting, timestamps and known attribution and merges valid live attribution only into unknown fields; a compaction retains live-value replacement behavior

#### Scenario: Simultaneous starts import once

- **WHEN** two processes run the backfill at the same time
- **THEN** the row count equals the number of source messages

#### Scenario: Schema mismatch fails soft

- **GIVEN** `opencode.db` lacks the expected tables or columns
- **WHEN** the backfill runs
- **THEN** a warning is logged, the marker stays unset, nothing throws, and live recording continues
