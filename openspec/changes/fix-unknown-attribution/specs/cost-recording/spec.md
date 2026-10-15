# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
