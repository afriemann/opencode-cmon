## MODIFIED Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total, per-agent and per-model micro-USD sums for `[from,to)`, each list sorted by amount descending then name, with a model named `providerId/modelId`, and SHALL emit `changed` after every write or prune.

#### Scenario: Range bounds are half-open

- **GIVEN** rows at exactly `from` and exactly `to`
- **WHEN** summary is requested
- **THEN** the row at `from` is included and the row at `to` is not

#### Scenario: Models are grouped by provider and model

- **GIVEN** rows for `a/m1` twice, `a/m2` and `b/m1`
- **WHEN** summary is requested
- **THEN** three models are returned, ordered by amount descending then name, and their amounts sum to the total

### Requirement: Opened block shows cost per agent

When opened, the sidebar block SHALL list each agent with its cost for the month, largest first, while the agent breakdown is selected, and the home footer SHALL stay on one line showing the top two agents and `+N` for the rest.

#### Scenario: Opened sidebar

- **WHEN** the block is opened
- **THEN** the agents are listed with amounts in descending order

#### Scenario: Opened footer stays one line

- **GIVEN** three agents have cost
- **WHEN** the footer is opened
- **THEN** it shows the total, the top two agents and `+1` on one line

## ADDED Requirements

### Requirement: Opened sidebar can switch between agent and model breakdown

The opened sidebar block SHALL show a toggle row, distinct in colour from the breakdown lines, that marks the active breakdown with brackets and bold and switches between by-agent and by-model on click, defaulting to by-agent whenever the TUI starts.

#### Scenario: Default breakdown is by agent

- **WHEN** the block is opened for the first time
- **THEN** the toggle row shows `View  [Agents]  Models` above the agent lines

#### Scenario: Clicking the toggle shows models

- **GIVEN** the block is opened by agent
- **WHEN** the toggle row is clicked
- **THEN** it shows `View  Agents  [Models]` and the lines list each `providerId/modelId` with its cost, largest first

#### Scenario: Toggle is absent when not ready or wrapped

- **WHEN** the block is wrapped, loading, or in the error state
- **THEN** no toggle row is shown

#### Scenario: Breakdown choice does not leak into other state

- **WHEN** the breakdown is switched to models
- **THEN** the open/closed state and the home footer are unchanged and the choice is not persisted
