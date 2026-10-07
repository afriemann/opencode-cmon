# Spec Delta

## MODIFIED Requirements

### Requirement: Report groups cost by one dimension

`cost_report` SHALL group the cost by `agent` (default), `model`, `provider`, `session`, `day` or `gap` (time since the previous step of the same session) and SHALL return per group the cost, share of total, step count, average cost per step, token counts (input, output, reasoning, cache read, cache write), cache-read ratio and failed cost.

#### Scenario: Group by model

- **GIVEN** rows for two models
- **WHEN** the report is grouped by model
- **THEN** each group's cost, share and token sums are the sums of its rows and the shares add up to 100%

#### Scenario: Group by day uses local dates

- **GIVEN** a row at 23:30 local time and one at 00:30 the next local day
- **WHEN** the report is grouped by day
- **THEN** they fall into two different days

#### Scenario: Cache-read ratio is unknown without cache data

- **GIVEN** a group whose rows have no cache tokens
- **WHEN** the report is built
- **THEN** its cache-read ratio is null

#### Scenario: Failed cost is separate

- **GIVEN** a group with one failed step costing 0.5 USD
- **WHEN** the report is built
- **THEN** its failed cost is 0.5 USD and it is included in the group's cost

#### Scenario: Rows with unknown token details

- **GIVEN** a row whose output tokens are NULL
- **WHEN** the report is built
- **THEN** the row counts toward cost and steps and adds nothing to the output token sum

#### Scenario: Group by gap uses fixed ordered buckets

- **GIVEN** steps of one session at 0, 30 seconds, 3 minutes and 10 minutes after each other
- **WHEN** the report is grouped by gap
- **THEN** the groups are `first`, `<1m`, `1-5m` and `>5m` in that order, one step each

#### Scenario: Gaps ignore filters

- **GIVEN** a session whose steps alternate between two agents one minute apart
- **WHEN** the report is filtered by one agent and grouped by gap
- **THEN** its steps fall into `1-5m`, not into a longer gap caused by the filter

#### Scenario: Compactions do not reset the gap

- **GIVEN** two steps ten minutes apart with a compaction between them
- **WHEN** the report is grouped by gap
- **THEN** the second step is in `>5m`

#### Scenario: Gaps stay within a session

- **GIVEN** the first steps of two different sessions recorded seconds apart
- **WHEN** the report is grouped by gap
- **THEN** both are in `first`

#### Scenario: A step without a known predecessor is first

- **GIVEN** a step with no earlier step in its session
- **WHEN** the report is grouped by gap
- **THEN** it is in `first`

## ADDED Requirements

### Requirement: Hotspots detect idle cache rewrites

`cost_hotspots` SHALL report the steps that follow a gap above `CACHE_TTL_MS` in their session and read less than `IDLE_REWRITE_MAX_READ_SHARE` of their input-side tokens from cache, with their cost, count and average cache-write tokens.

#### Scenario: Idle rewrite is reported

- **GIVEN** a step ten minutes after the previous one that wrote 200k tokens and read almost none
- **WHEN** the hotspots are built
- **THEN** an `idle_cache_rewrite` finding reports its cost, one step and 200k average written tokens

#### Scenario: Short gaps are not reported

- **GIVEN** steps one minute apart with low cache reads
- **WHEN** the hotspots are built
- **THEN** no `idle_cache_rewrite` finding exists

#### Scenario: Warm steps after a long gap are not reported

- **GIVEN** a step ten minutes after the previous one that read most of its input from cache
- **WHEN** the hotspots are built
- **THEN** no `idle_cache_rewrite` finding exists
