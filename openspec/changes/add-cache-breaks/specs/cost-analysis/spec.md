## MODIFIED Requirements

### Requirement: Cost tools are registered only while tracking runs

The plugin SHALL register the tools `cost_report`, `cost_hotspots` and `cache_breaks` as pinned Code Mode tools in namespace `cmon` after the store opened, and SHALL NOT register them when the store failed to open.

#### Scenario: Tools are registered

- **WHEN** the plugin starts with a working store
- **THEN** all three tools are registered with namespace `cmon` and pinned

#### Scenario: No tools without a store

- **WHEN** the store fails to open
- **THEN** no tool is registered

#### Scenario: Registration is replay-safe

- **WHEN** the registration callback runs twice
- **THEN** it does not throw and each tool exists once

#### Scenario: Calls after shutdown fail cleanly

- **GIVEN** the plugin has shut down
- **WHEN** a stale `cost_report` call executes
- **THEN** it fails with the error "cost tracking stopped"

### Requirement: Output is bounded

The tools SHALL return at most `limit` groups, findings or sessions (default 10, at most 50 for `cost_report` and 30 for `cost_hotspots` and `cache_breaks`), fold the remaining report groups into one `others` group, and cap the text content at 8 KB and 120 lines.

#### Scenario: Remaining groups fold into others

- **GIVEN** 15 groups and a limit of 10
- **WHEN** the report is built
- **THEN** 10 groups and an `others` group are returned and the shares add up to 100%

#### Scenario: Limit above the maximum is rejected

- **WHEN** `limit` is 51 for `cost_report`
- **THEN** the tool fails with an error naming the maximum

#### Scenario: Text is capped

- **GIVEN** a result whose text exceeds 120 lines
- **WHEN** the text is rendered
- **THEN** it is cut to the cap and ends with a truncation marker

## ADDED Requirements

### Requirement: Report groups cost by two dimensions

`cost_report` SHALL accept `groupBy` as one dimension or as an array of exactly two distinct dimensions and, for two, SHALL return one group per combination with the same columns as a single dimension.

#### Scenario: Group by day and model

- **GIVEN** rows on two days for two models
- **WHEN** the report is grouped by `["day","model"]`
- **THEN** one group exists per day and model combination, each carrying both keys, and the shares add up to 100%

#### Scenario: A single dimension is unchanged

- **GIVEN** a fixed set of rows
- **WHEN** the report is grouped by the string `model`
- **THEN** the result is identical to the result before two-dimension grouping existed

#### Scenario: Duplicate dimensions are rejected

- **WHEN** `groupBy` is `["day","day"]`
- **THEN** the tool fails with an error saying the two dimensions must differ

#### Scenario: Three dimensions are rejected

- **WHEN** `groupBy` has three elements
- **THEN** the tool fails with an error saying exactly two dimensions are allowed

#### Scenario: Limit applies to combinations

- **GIVEN** more combinations than the limit
- **WHEN** the report is grouped by two dimensions
- **THEN** the combinations beyond the limit fold into `others`

### Requirement: Cache breaks examine long sessions

`cache_breaks` SHALL examine only steps with known token counts, only sessions with at least 20 such steps, and SHALL accept the filters `period`, `model`, `provider`, `agent`, `session`, `project` and `includeSubagents` and a `limit` (default 10, at most 30).

#### Scenario: Short sessions are ignored

- **GIVEN** a session with 19 steps that all miss the cache
- **WHEN** `cache_breaks` runs
- **THEN** the session is not examined and not flagged

#### Scenario: Healthy session is not flagged

- **GIVEN** a session of 30 steps whose cache-read ratio stays above 0.9
- **WHEN** `cache_breaks` runs
- **THEN** the session is examined and not flagged

#### Scenario: Steps without token counts are skipped and counted

- **GIVEN** steps with unknown token counts
- **WHEN** `cache_breaks` runs
- **THEN** they are not examined and the notes state how many were skipped

### Requirement: Cache breaks report frozen cache runs

`cache_breaks` SHALL flag a session containing a run of at least 15 consecutive steps with an identical cache read above 0 and uncached input above 0, and SHALL report the run length, the frozen value, the start step and time, and the uncached input at the run's start and end.

#### Scenario: Frozen cache is flagged

- **GIVEN** 30 steps with cache read 45274 and growing uncached input
- **WHEN** `cache_breaks` runs
- **THEN** the session is flagged with a run of 30 steps and frozen value 45274

#### Scenario: Short frozen run is not a frozen finding

- **GIVEN** a run of 14 steps with an identical cache read
- **WHEN** `cache_breaks` runs
- **THEN** no frozen run is reported

### Requirement: Cache breaks report full misses

`cache_breaks` SHALL report each step with a cache read of 0 that follows a step with a cache read above 0, excluding a session's first step and the step directly after a compaction, with the count and at most 10 entries showing step, time and uncached input.

#### Scenario: Alternating cache reads

- **GIVEN** steps alternating between cache read 0 and 100000
- **WHEN** `cache_breaks` runs
- **THEN** every zero step after a non-zero step is a full miss

#### Scenario: First and post-compaction steps are excluded

- **GIVEN** a first step with cache read 0 and a step with cache read 0 right after a compaction that follows a step with cache read above 0
- **WHEN** `cache_breaks` runs
- **THEN** neither is reported as a full miss

### Requirement: Cache breaks report ratio change-points

`cache_breaks` SHALL compute the cache ratio cache read / (cache read + uncached input) over a rolling window of the last 10 steps and SHALL report each step where it falls below 0.5 or returns to at least 0.5, at most 10 per session.

#### Scenario: Fall and recovery

- **GIVEN** a ratio that falls from 0.9 to 0.3 and recovers
- **WHEN** `cache_breaks` runs
- **THEN** exactly two change-points are reported, one downward and one upward

### Requirement: Cache breaks estimate the waste

`cache_breaks` SHALL estimate the waste of the flagged steps in dollars as their uncached input billed at the catalog input price instead of the median catalog cache-read price of the session, and SHALL omit the estimate and state why when any flagged step cannot be priced.

#### Scenario: Waste is estimated

- **GIVEN** a flagged session on a model with catalog prices
- **WHEN** `cache_breaks` runs
- **THEN** the session carries an estimated waste

#### Scenario: Unknown price omits the estimate

- **GIVEN** a flagged session on a model without a catalog price
- **WHEN** `cache_breaks` runs
- **THEN** no waste is given and the notes say the price is unknown

### Requirement: Cache breaks list flagged sessions and a model summary

`cache_breaks` SHALL list at most `limit` flagged sessions by total cost descending with session, agent, provider, model, step count, overall cache ratio and total cost, SHALL give per provider and model the flagged and examined session counts, and SHALL NOT output prompts or message content.

#### Scenario: Flagged sessions are sorted by cost

- **GIVEN** two flagged sessions
- **WHEN** `cache_breaks` runs
- **THEN** the more expensive one is listed first

#### Scenario: Model summary shows a provider-wide regression

- **GIVEN** three examined sessions of one model of which two are flagged
- **WHEN** `cache_breaks` runs
- **THEN** the summary for that model shows 2 flagged of 3 examined, even when `limit` is 1
