## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Copilot Claude cache writes are priced as an add-on

**Reason**: Persisting a catalog-derived add-on failed repeatedly because the catalog is incomplete at startup; the add-on is now computed at read time.
**Migration**: Token counts are stored instead (see "Rows store the token counts needed for pricing"); pricing rules move to cost-display.
