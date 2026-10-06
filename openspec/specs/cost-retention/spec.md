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

### Requirement: Backfilled rows carry the cache-write add-on

The plugin SHALL compute the add-on for backfilled messages from their stored token counts using the same rule as live recording.

#### Scenario: Backfill computes the add-on

- **GIVEN** a source assistant message of a Copilot Claude model with cache-write tokens
- **WHEN** the backfill runs with a loaded catalog
- **THEN** the imported row carries the add-on

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
