# cost-display Specification

## Purpose

TBD - created by archiving change add-monthly-cost-tracking. Update Purpose after archive.

## Requirements

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

### Requirement: Month is the local calendar month

The TUI SHALL request the range from local midnight on the first of the current month to local midnight on the first of the next month, and SHALL refresh on `changed` and at least every 60 seconds.

#### Scenario: Month range across DST

- **GIVEN** `TZ=Europe/Berlin` and a date in March
- **WHEN** the range is computed
- **THEN** it starts and ends at local midnight despite the DST shift

### Requirement: Cost block is collapsed by default

The TUI SHALL render in `sidebar.content` and `home.footer.status` a block that is wrapped by default and shows only "This month: $X.XX", with the glyph `▶` when wrapped and `▼` when opened.

#### Scenario: Default wrapped sidebar

- **WHEN** the sidebar renders for the first time
- **THEN** it shows `▶ This month: $12.34` and no agent lines

#### Scenario: Footer uses the same glyphs

- **WHEN** the footer renders wrapped and then opened
- **THEN** it starts with `▶` when wrapped and `▼` when opened

### Requirement: Opened block shows cost per agent

When opened, the sidebar block SHALL list each agent with its cost for the month, largest first, while the agent breakdown is selected, and the home footer SHALL stay on one line showing the top two agents and `+N` for the rest.

#### Scenario: Opened sidebar

- **WHEN** the block is opened
- **THEN** the agents are listed with amounts in descending order

#### Scenario: Opened footer stays one line

- **GIVEN** three agents have cost
- **WHEN** the footer is opened
- **THEN** it shows the total, the top two agents and `+1` on one line

### Requirement: Open state is shared and persisted

The TUI SHALL keep one open/closed state in persisted storage, shared by both slots and toggled by clicking the header.

#### Scenario: Toggle applies everywhere

- **WHEN** the header is clicked in the sidebar
- **THEN** the footer also switches state and the state survives a TUI restart

### Requirement: Loading and error states never break the host

The TUI SHALL show `…` while loading and the word `Error` in the theme's error colour when the RPC fails, without throwing, and SHALL show `$0.00` with an empty breakdown when no rows exist.

#### Scenario: RPC failure

- **WHEN** the RPC call rejects
- **THEN** the block shows `Error` in the error colour

### Requirement: Sidebar block is placed first

The TUI SHALL claim `sidebar.content` with `prepend` so the cost block renders above the other sidebar sections.

#### Scenario: Sidebar claim is a prepend

- **WHEN** the TUI plugin sets up
- **THEN** its sidebar slot claim uses `prepend: "sidebar.content"`

### Requirement: Totals include the cache-write add-on

The summary SHALL report totals and per-agent amounts as the sum of `cost_micros` and the cache-write add-on.

#### Scenario: Summary shows the corrected figure

- **GIVEN** a row with cost 100,000 and add-on 50,000 micro-USD
- **WHEN** the summary is requested
- **THEN** the total and the agent amount are 150,000 micro-USD

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

### Requirement: Sidebar tolerates a summary without a model list

The sidebar SHALL show no breakdown lines, and SHALL NOT throw, when the by-model breakdown is selected and the received summary has no model list.

#### Scenario: Summary from an older server

- **GIVEN** a summary that has agents but no model list
- **WHEN** the by-model breakdown is selected
- **THEN** no lines are shown and nothing throws
