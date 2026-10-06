## ADDED Requirements

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
