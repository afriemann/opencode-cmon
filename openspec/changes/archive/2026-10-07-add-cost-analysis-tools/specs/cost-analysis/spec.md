# Spec Delta

## Purpose

Lets agents read the recorded cost to find where money goes and what to look at to reduce it, through two bounded read-only tools over the local cost ledger.

## ADDED Requirements

### Requirement: Cost tools are registered only while tracking runs

The plugin SHALL register the tools `cost_report` and `cost_hotspots` as pinned Code Mode tools in namespace `cmon` after the store opened, and SHALL NOT register them when the store failed to open.

#### Scenario: Tools are registered

- **WHEN** the plugin starts with a working store
- **THEN** both tools are registered with namespace `cmon` and pinned

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

### Requirement: Period selects a half-open local-time range

The tools SHALL accept a `period` of `month` (default, the current local calendar month), `YYYY-MM`, `<N>d` (the last N×24 hours, 1 to 184) or `YYYY-MM-DD..YYYY-MM-DD` (inclusive local days), and SHALL evaluate it as `[from, to)`.

#### Scenario: Default is the current month

- **WHEN** a tool is called without a period
- **THEN** it reports the current local calendar month

#### Scenario: Day range is inclusive

- **WHEN** the period is `2026-10-01..2026-10-03`
- **THEN** rows from 1 October 00:00 up to but excluding 4 October 00:00 local time are included

#### Scenario: Invalid period is rejected

- **WHEN** the period is `0d` or `banana`
- **THEN** the tool fails with an error naming the accepted forms

#### Scenario: Retention truncation is stated

- **WHEN** the period starts before the retention cutoff
- **THEN** the notes say older data was pruned and give the effective start

### Requirement: Report totals equal the TUI totals

The `cost_report` total for a period without filters SHALL equal the TUI summary total for the same range, including the cache-write add-on.

#### Scenario: Same fixture, same total

- **GIVEN** rows with a Copilot Claude cache-write cost and a price catalog
- **WHEN** the month report and the TUI summary are built from them
- **THEN** both totals are equal

#### Scenario: Incomplete pricing is flagged

- **GIVEN** a Copilot Claude row with cache writes and no catalog price
- **WHEN** the report is built
- **THEN** `complete` is false and the notes name the number of affected rows

### Requirement: Report groups cost by one dimension

`cost_report` SHALL group the cost by `agent` (default), `model`, `provider`, `session` or `day` and SHALL return per group the cost, share of total, step count, average cost per step, token counts (input, output, reasoning, cache read, cache write), cache-read ratio and failed cost.

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

### Requirement: Report is sortable and filterable

`cost_report` SHALL sort groups by `cost` (default), `steps` or `avgCost`, and both tools SHALL narrow rows by exact `agent`, `model`, `provider`, `kind` (`step` or `compaction`) and `session`, where `session` includes all descendant sessions unless `includeSubagents` is false.

#### Scenario: Sort by average cost

- **WHEN** the report is sorted by `avgCost`
- **THEN** the group with the highest average cost per step is first

#### Scenario: Session filter includes sub-agent sessions

- **GIVEN** a session with a child and a grandchild session
- **WHEN** the report filters by that session
- **THEN** the rows of all three sessions are included

#### Scenario: Sub-agents can be excluded

- **WHEN** the same filter is given with `includeSubagents` false
- **THEN** only the session's own rows are included

#### Scenario: Kind filter

- **WHEN** the kind is `compaction`
- **THEN** only compaction rows are included

### Requirement: Project filter matches a directory and its descendants

The tools SHALL, when `project` is given, include only rows whose directory equals it or lies below it at a path boundary, SHALL resolve `current` to the calling session's directory, SHALL include all projects when it is omitted, and SHALL exclude rows with an unknown directory while reporting their count and cost.

#### Scenario: Descendants match at a path boundary

- **GIVEN** rows in `/work/app`, `/work/app/.worktrees/x` and `/work/application`
- **WHEN** the project is `/work/app`
- **THEN** the first two are included and `/work/application` is not

#### Scenario: Current resolves from the calling session

- **GIVEN** the calling session's directory is `/work/app`
- **WHEN** the project is `current`
- **THEN** rows below `/work/app` are included

#### Scenario: Unknown directories are excluded and counted

- **GIVEN** a row with an unknown directory
- **WHEN** a project filter is given
- **THEN** the row is excluded and the output reports one excluded row with its cost

#### Scenario: Default is all projects

- **WHEN** no project is given
- **THEN** rows of every directory, including unknown, are included

### Requirement: Output is bounded

The tools SHALL return at most `limit` groups or findings (default 10, at most 50 for `cost_report` and 30 for `cost_hotspots`), fold the remaining report groups into one `others` group, and cap the text content at 8 KB and 120 lines.

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

### Requirement: Results carry caveats

The tools SHALL return structured output and compact text with the same facts, and SHALL state in the notes that title-generation cost is not tracked.

#### Scenario: Notes always include the title-generation caveat

- **WHEN** any tool result is built
- **THEN** its notes say title-generation cost is not tracked

#### Scenario: Output and text agree

- **WHEN** a report is built
- **THEN** the total shown in the text equals the structured total

### Requirement: Hotspots are evidence-based findings

`cost_hotspots` SHALL return findings ranked by attributable cost, each with a type, scope, evidence (metric, value, threshold), attributable cost, share of the period total, a suggestion or null, and the formula or assumption behind it, and SHALL state that attributable costs overlap and must not be summed.

#### Scenario: Findings are ranked

- **GIVEN** two findings with different attributable costs
- **WHEN** the hotspots are built
- **THEN** the larger attributable cost comes first

#### Scenario: Facts rank after recommendations

- **GIVEN** an agent model mix fact with a larger cost than a failed-steps finding
- **WHEN** the hotspots are built
- **THEN** the failed-steps finding ranks before the model mix

#### Scenario: Overlap is stated

- **WHEN** the hotspots are built
- **THEN** the notes say the attributable costs overlap

#### Scenario: No data gives no findings

- **GIVEN** no rows in the period
- **WHEN** the hotspots are built
- **THEN** the findings are empty and the total is zero

### Requirement: Hotspots detect expensive sessions and steps

`cost_hotspots` SHALL report the most expensive sessions, with their sub-agent sessions included, and the most expensive single steps.

#### Scenario: Top session includes its sub-agents

- **GIVEN** a session costing 1 USD with a child session costing 2 USD
- **WHEN** the hotspots are built
- **THEN** a `top_session` finding for the session has attributable cost 3 USD

#### Scenario: Top step

- **GIVEN** one step costing 5 USD among cheaper ones
- **WHEN** the hotspots are built
- **THEN** a `top_step` finding names that step first

### Requirement: Hotspots detect cache inefficiency

`cost_hotspots` SHALL report a session whose cache-read ratio is below `LOW_CACHE_READ_RATIO` with at least `MIN_CACHE_TOKENS` input and cache-read tokens, only for provider and model pairs that report any cache read in the period, and SHALL report the cache-write spend.

#### Scenario: Low cache reads are reported

- **GIVEN** a session on a provider that reports cache reads elsewhere, with a cache-read ratio below the threshold
- **WHEN** the hotspots are built
- **THEN** a `low_cache_read` finding names the session

#### Scenario: Providers without cache reporting are skipped

- **GIVEN** a session on a provider that never reports cache reads
- **WHEN** the hotspots are built
- **THEN** no `low_cache_read` finding names it

#### Scenario: Cache-write spend

- **GIVEN** rows with cache writes
- **WHEN** the hotspots are built
- **THEN** a `cache_write_spend` finding reports the cache-write add-on cost and the written tokens

### Requirement: Hotspots detect wasted and structural spend

`cost_hotspots` SHALL report the cost of failed steps, of steps that finished with `length`, of compactions, and of root sessions with at least `FANOUT_MIN_CHILDREN` descendant sessions.

#### Scenario: Failed steps

- **GIVEN** failed steps costing 2 USD in total
- **WHEN** the hotspots are built
- **THEN** a `failed_steps` finding has attributable cost 2 USD

#### Scenario: Truncated steps

- **GIVEN** steps with finish `length`
- **WHEN** the hotspots are built
- **THEN** a `truncated_steps` finding sums their cost

#### Scenario: Compaction spend

- **GIVEN** compaction rows
- **WHEN** the hotspots are built
- **THEN** a `compaction_spend` finding sums their cost

#### Scenario: Sub-agent fan-out

- **GIVEN** a root session with `FANOUT_MIN_CHILDREN` descendant sessions
- **WHEN** the hotspots are built
- **THEN** a `subagent_fanout` finding reports the descendants' cost

### Requirement: Hotspots detect context growth

`cost_hotspots` SHALL report a session with at least `GROWTH_MIN_STEPS` steps whose last step's input plus cache-read tokens are at least `GROWTH_RATIO` times those of its first step, the first step counting as at least `GROWTH_BASELINE_TOKENS`.

#### Scenario: Growing context is reported

- **GIVEN** a session whose step input grows from 10k to 100k tokens over `GROWTH_MIN_STEPS` steps
- **WHEN** the hotspots are built
- **THEN** an `input_growth` finding names the session with the growth factor as evidence

#### Scenario: A tiny first step does not inflate the growth ratio

- **GIVEN** a session whose first step has 10 input tokens and whose last step has 12k, below `GROWTH_RATIO` times `GROWTH_BASELINE_TOKENS`
- **WHEN** the hotspots are built
- **THEN** no `input_growth` finding names it

#### Scenario: Short sessions are ignored

- **GIVEN** a session with fewer than `GROWTH_MIN_STEPS` steps
- **WHEN** the hotspots are built
- **THEN** no `input_growth` finding names it

### Requirement: Hotspots show the model mix as a fact

`cost_hotspots` SHALL report per agent the share of its cost per model and the average output tokens per step, without a suggestion.

#### Scenario: Agent model mix

- **GIVEN** an agent with steps on two models
- **WHEN** the hotspots are built
- **THEN** an `agent_model_mix` finding lists each model's share and average output tokens, and its suggestion is null
