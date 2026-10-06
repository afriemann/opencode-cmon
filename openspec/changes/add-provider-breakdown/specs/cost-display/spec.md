## MODIFIED Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total and the per-agent, per-model and per-provider micro-USD sums for `[from,to)`, each list sorted by amount descending then name, with a model named by its model id and a provider by its provider id, and SHALL emit `changed` after every write or prune.

#### Scenario: Range bounds are half-open

- **GIVEN** rows at exactly `from` and exactly `to`
- **WHEN** summary is requested
- **THEN** the row at `from` is included and the row at `to` is not

#### Scenario: Models are grouped by provider and model

- **GIVEN** rows for model `m1` from providers `a` and `b`, and model `m2` from provider `a`
- **WHEN** summary is requested
- **THEN** two models `m1` and `m2` are returned, ordered by amount descending then name, with `m1` summing both providers, and their amounts sum to the total

#### Scenario: Providers are grouped by provider id

- **GIVEN** rows from providers `a` twice and `b` once
- **WHEN** summary is requested
- **THEN** two providers are returned, ordered by amount descending then name, and their amounts sum to the total

### Requirement: Opened sidebar can switch between agent and model breakdown

The opened sidebar block SHALL show a toggle row, distinct in colour from the breakdown lines, with a clickable tab per breakdown (agents, models, providers) that marks the active tab with brackets and bold and selects that breakdown when clicked, defaulting to agents whenever the TUI starts.

#### Scenario: Default breakdown is by agent

- **WHEN** the block is opened for the first time
- **THEN** the toggle row shows `View  [Agents]  Models  Providers` above the agent lines

#### Scenario: Clicking the toggle shows models

- **GIVEN** the block is opened by agent
- **WHEN** the `Models` tab is clicked
- **THEN** it shows `View  Agents  [Models]  Providers` and the lines list each model id with its cost, largest first

#### Scenario: Clicking the Providers tab shows providers

- **GIVEN** the block is opened by agent
- **WHEN** the `Providers` tab is clicked
- **THEN** it shows `View  Agents  Models  [Providers]` and the lines list each provider id with its cost, largest first

#### Scenario: Clicks outside the tabs do nothing

- **WHEN** the `View` label, the gap between tabs, or the active tab is clicked
- **THEN** the selected breakdown and the open/closed state are unchanged

#### Scenario: Toggle is absent when not ready or wrapped

- **WHEN** the block is wrapped, loading, or in the error state
- **THEN** no toggle row is shown

#### Scenario: Breakdown choice does not leak into other state

- **WHEN** the breakdown is switched to models
- **THEN** the open/closed state and the home footer are unchanged and the choice is not persisted

### Requirement: Sidebar tolerates a summary without a model list

The sidebar SHALL show no breakdown lines, and SHALL NOT throw, when the models or providers breakdown is selected and the received summary has no list for it.

#### Scenario: Summary from an older server

- **GIVEN** a summary that has agents but no model or provider list
- **WHEN** the models or providers breakdown is selected
- **THEN** no lines are shown and nothing throws
