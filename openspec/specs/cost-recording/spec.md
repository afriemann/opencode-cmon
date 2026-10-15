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

- **GIVEN** no matching `session.step.started` was observed and no valid exact-message source attribution is available
- **WHEN** its `session.step.ended` arrives, even if another step's attribution is known in that session
- **THEN** the row uses `unknown` for each unavailable attribution field, not another step's agent, provider or model

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

### Requirement: Missing-start step attribution uses exact persisted evidence

The plugin SHALL recover missing-start attribution independently per field from the persisted assistant message matching both message and session ID for completed and eligible failed steps.

#### Scenario: Recovers a completed step without its start

- **GIVEN** no matching observed start and a matching persisted assistant message with valid agent, provider and model
- **WHEN** the completed step arrives
- **THEN** its row uses those three source fields while retaining the event's accounting and existing timestamp-selection behavior

#### Scenario: Recovers an eligible failed step without its start

- **GIVEN** no matching observed start and matching persisted assistant attribution
- **WHEN** a failed step arrives with cost and tokens
- **THEN** it is recorded with recovered attribution and its failed flag set

#### Scenario: Observed matching start remains authoritative

- **GIVEN** a matching observed start and different persisted attribution
- **WHEN** the step ends
- **THEN** the observed start supplies its attribution without a source lookup

#### Scenario: Rejects source identity or type mismatch

- **GIVEN** a source record with a different message ID, different session ID or a type other than assistant
- **WHEN** missing-start recovery runs
- **THEN** no attribution from that record is used and the event is still recorded

#### Scenario: Recovers only valid source fields

- **GIVEN** a matching assistant with a valid provider but absent, non-string, whitespace-only or `unknown` agent and model fields
- **WHEN** missing-start recovery runs
- **THEN** the provider is recovered and the other fields remain `unknown`

### Requirement: Source attribution failures do not interrupt recording

The plugin SHALL record eligible step accounting when attribution evidence is unavailable, using read-only source access with bounded lock waiting and releasing source resources after use.

#### Scenario: Source failures preserve step accounting

- **GIVEN** the source database is absent, unreadable, locked or malformed, or the exact assistant message is not yet persisted
- **WHEN** an eligible step without its start arrives
- **THEN** recording succeeds with unavailable fields `unknown`, unchanged event accounting, no source writes and released source resources

### Requirement: Startup repairs missing step attribution only

The plugin SHALL fill only `unknown` agent, provider and model fields on retained step rows at startup from matching persisted assistant evidence before exposing summaries.

#### Scenario: Startup repairs missing fields without changing accounting

- **GIVEN** retained step rows with missing attribution and exact assistant evidence
- **WHEN** startup repair runs
- **THEN** valid source fields replace only their `unknown` counterparts, all other columns remain unchanged, and initial summaries use repaired attribution

#### Scenario: Startup repair is idempotent and excludes compactions

- **GIVEN** repaired steps, fully attributed steps and unknown compaction rows
- **WHEN** startup repair runs again
- **THEN** those rows remain unchanged and compaction attribution retains its existing behavior

#### Scenario: Unresolved startup candidates remain retryable

- **GIVEN** a retained unknown step whose source is unavailable on one startup and available on a later startup
- **WHEN** those startups run
- **THEN** the first leaves accounting and missing fields intact and the later startup repairs the available attribution without a permanent skip marker

#### Scenario: Concurrent attribution writes preserve known values

- **GIVEN** a repair candidate whose attribution becomes known through another writer after selection
- **WHEN** the repair commits
- **THEN** only fields still `unknown` are filled and every known field and non-attribution column is preserved

#### Scenario: A failed repair batch preserves completed work

- **GIVEN** multiple repair batches with an earlier successful batch and a later source or ledger failure
- **WHEN** startup repair stops
- **THEN** prior repairs remain committed, unresolved rows remain retryable, and plugin startup continues

### Requirement: Step redelivery merges attribution without replacing accounting

The plugin SHALL merge valid incoming attribution into only `unknown` fields of an existing step row on redelivery while preserving every non-attribution column.

#### Scenario: Redelivery fills provider or model independently

- **GIVEN** an existing step with a known agent, unknown provider or model, and stored accounting
- **WHEN** redelivery supplies valid attribution and different accounting or timestamps
- **THEN** only the missing attribution is filled, no second row is created, and stored accounting, timestamps and known fields remain unchanged

#### Scenario: Incomplete redelivery never degrades a step

- **GIVEN** an existing recovered step or a backfilled step
- **WHEN** a redelivery supplies unknown or conflicting attribution
- **THEN** all known attribution and non-attribution columns remain unchanged

### Requirement: Attribution failure diagnostics are bounded and content-free

The plugin SHALL emit only categorical reasons, counts and setup-local correlation tokens in new attribution failure diagnostics, deduplicating live failures per category per setup and aggregating startup results.

#### Scenario: Failure diagnostics exclude source and identifying content

- **GIVEN** failing recovery with source content, raw IDs, paths and error text containing sensitive strings
- **WHEN** a diagnostic is emitted
- **THEN** it contains only an allow-listed category, counts and a setup-local correlation token, with no raw message or session IDs, prompts, content, credentials, paths or raw errors

#### Scenario: Repeated failures do not flood diagnostics

- **WHEN** many live attribution failures repeat within one setup and a startup repair pass encounters failures
- **THEN** at most one live entry per category and one aggregate startup summary are emitted, and a diagnostic failure never prevents recording or startup
