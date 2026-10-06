## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Backfilled rows carry the cache-write add-on

**Reason**: The add-on is no longer stored; it is computed at read time from token counts.
**Migration**: See "Backfilled rows carry token counts".

### Requirement: Existing rows are corrected once

**Reason**: The one-time catalog-dependent correction is replaced by a marker-less token fill, because tokens are facts and do not depend on the catalog.
**Migration**: See "Missing token counts are filled from opencode.db".
