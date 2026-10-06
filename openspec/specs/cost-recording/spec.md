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

### Requirement: Copilot Claude cache writes are priced as an add-on

The plugin SHALL store, per row, a separate integer micro-USD cache-write add-on equal to the cache-write tokens times 1.25 times the selected tier's input price, rounded once, for `github-copilot` Claude models whose selected catalog tier prices cache writes at zero.

#### Scenario: Sonnet cache writes are priced

- **GIVEN** a `github-copilot` `claude-sonnet-5.5` step with 1,725,111 cache-write tokens and an input price of $2 per million
- **WHEN** the step is recorded
- **THEN** the row's add-on is 4,312,778 micro-USD and `cost_micros` keeps opencode's own cost

#### Scenario: No add-on outside the rule

- **WHEN** the model is not Copilot Claude, the selected tier already prices cache writes above zero, there are no cache-write tokens, the price is unknown, or attribution is `unknown`
- **THEN** the add-on is 0

#### Scenario: Tier selection matches opencode

- **GIVEN** a cost table with a context tier above 200,000 tokens
- **WHEN** input plus cache-read plus cache-write tokens exceed that tier size
- **THEN** the tier's input price is used, otherwise the untiered entry's

#### Scenario: Failed steps get the add-on

- **WHEN** a failed step with cost and tokens is recorded
- **THEN** its add-on is computed by the same rule

#### Scenario: Empty catalog records zero and later recovers

- **GIVEN** the price catalog is empty when a step ends
- **WHEN** the step is recorded
- **THEN** its add-on is 0 and a later correction can fill it

#### Scenario: A hanging catalog load does not stall recording

- **WHEN** the catalog load does not finish within 5 seconds
- **THEN** the load yields no prices and steps are recorded with add-on 0

#### Scenario: A redelivery with zero add-on keeps the stored add-on

- **GIVEN** a row with a non-zero add-on
- **WHEN** the same message is recorded again with add-on 0
- **THEN** the stored add-on is kept

### Requirement: Schema upgrade is additive and concurrency-safe

The plugin SHALL upgrade `cmon.db` from schema version 1 to 2 by adding the add-on column under an immediate write transaction that re-reads the schema version, keeping existing rows with add-on 0 and refusing any newer version.

#### Scenario: Version 1 database is upgraded

- **GIVEN** a version 1 database with rows
- **WHEN** the store opens
- **THEN** the rows remain with add-on 0 and the version is 2

#### Scenario: Concurrent upgrades both succeed

- **WHEN** two processes open the same version 1 file simultaneously
- **THEN** both succeed and the column exists once

#### Scenario: Newer schema is refused

- **GIVEN** a database with a version above 2
- **WHEN** the store opens
- **THEN** it throws
