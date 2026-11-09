## ADDED Requirements

### Requirement: Hotspots detect cache stalls

`cost_hotspots` SHALL report, per session, each run of at least `STALL_MIN_STEPS` consecutive steps with at least 20,000 uncached input tokens, a cache-read share below `LOW_CACHE_READ_RATIO` and a cache-read value equal to the run's first step or at most 2% of the step's input-side tokens above it, as a `cache_stall` finding with start time, stalled steps, ongoing flag, constant cache read, model, healthy-before flag, stalled cost and estimated savings. Steps without token counts SHALL be skipped.

#### Scenario: Healthy cache is not reported

- **GIVEN** a session whose cache-read tokens grow every step
- **WHEN** the hotspots are built
- **THEN** no `cache_stall` finding exists

#### Scenario: Stall from the first step is ongoing

- **GIVEN** a session of six steps with 36,655 cache-read tokens each and growing input
- **WHEN** the hotspots are built
- **THEN** a `cache_stall` finding reports six steps, ongoing, constant cache read 36,655 and no healthy period before

#### Scenario: Healthy then stalled

- **GIVEN** ten steps with growing cache reads followed by eight steps with a constant cache read
- **WHEN** the hotspots are built
- **THEN** a `cache_stall` finding starts at the eleventh step, reports eight steps, the summed cost of those steps and a healthy period before

#### Scenario: A model that never caches is not a stall

- **GIVEN** six steps with 100,000 input tokens and zero cache read
- **WHEN** the hotspots are built
- **THEN** no `cache_stall` finding exists

#### Scenario: Short run is not reported

- **GIVEN** four consecutive stalled steps
- **WHEN** the hotspots are built
- **THEN** no `cache_stall` finding exists

#### Scenario: Recovered stall is not ongoing

- **GIVEN** a stalled run followed by a step whose cache read grows again
- **WHEN** the hotspots are built
- **THEN** the finding reports the stall as not ongoing

#### Scenario: Unknown tokens are skipped and sessions are independent

- **GIVEN** a stalled session containing a step without token counts and a concurrent healthy session
- **WHEN** the hotspots are built
- **THEN** only the stalled session has a `cache_stall` finding, counting its steps with known tokens

#### Scenario: Savings are omitted without a cache-read price

- **GIVEN** a stall on a model with no catalog price
- **WHEN** the hotspots are built
- **THEN** the finding has no estimated savings

### Requirement: Report shows stalled steps

`cost_report` SHALL show, for each group with at least one, the number of steps that belong to a cache stall.

#### Scenario: Stalled steps are counted per model

- **GIVEN** a model whose session has a six-step cache stall
- **WHEN** the report is grouped by model
- **THEN** that model's line shows six stalled steps and a model without a stall shows none
