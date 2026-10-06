# cost-display Specification

## Purpose

TBD - created by archiving change add-monthly-cost-tracking. Update Purpose after archive.

## Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total and the per-agent, per-model and per-provider micro-USD sums for `[from,to)`, each list sorted by amount descending then name, with a model named by its model id and a provider by its provider id, plus a `complete` flag, and SHALL emit `changed` after every write or prune.

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

The summary SHALL compute, per row at read time, a cache-write add-on of cache-write tokens times 1.25 times the selected catalog tier's input price, rounded once per row, for `github-copilot` Claude models whose selected tier prices cache writes at zero, and SHALL add it to the total, the row's agent amount and the row's model amount.

#### Scenario: Summary shows the corrected figure

- **GIVEN** a row with cost 100,000 micro-USD and cache-write tokens priced to 50,000 micro-USD
- **WHEN** the summary is requested
- **THEN** the total, the agent amount and the model amount are 150,000 micro-USD

#### Scenario: Sonnet cache writes are priced

- **GIVEN** a `github-copilot` `claude-sonnet-5.5` row with 1,725,111 cache-write tokens and an input price of $2 per million
- **WHEN** the summary is built
- **THEN** the add-on is 4,312,778 micro-USD

#### Scenario: No add-on outside the rule

- **WHEN** the model is not Copilot Claude, the selected tier already prices cache writes above zero, or there are no cache-write tokens
- **THEN** the add-on is 0

#### Scenario: Tier selection matches opencode

- **GIVEN** a cost table with a context tier above 200,000 tokens
- **WHEN** input plus cache-read plus cache-write tokens exceed that tier size
- **THEN** that tier's input price is used, otherwise the untiered entry's

#### Scenario: The add-on follows the catalog

- **GIVEN** a summary built with an empty catalog and then with a priced catalog
- **WHEN** both are compared
- **THEN** the second includes the add-on and the stored rows are unchanged

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

### Requirement: Incomplete pricing is flagged

The summary SHALL report `complete: false` when a row that could carry a cache-write cost has unknown token counts or no priced catalog entry, SHALL reload the catalog (at most once per minute) when such a model is missing, and the TUI SHALL prefix the total with `~` when the summary is incomplete.

#### Scenario: NULL tokens mark the summary incomplete

- **GIVEN** a Copilot Claude row with NULL token counts
- **WHEN** the summary is built
- **THEN** `complete` is false and the row adds no cache-write cost

#### Scenario: An unpriced model marks the summary incomplete

- **GIVEN** a Copilot Claude row with cache-write tokens whose model has no priced catalog entry
- **WHEN** the summary is built
- **THEN** `complete` is false and a catalog reload is requested

#### Scenario: Reloads are rate-limited

- **WHEN** summaries keep finding an unpriced model
- **THEN** the catalog is reloaded at most once per minute

#### Scenario: A hanging catalog never stalls the summary

- **WHEN** the catalog load does not finish
- **THEN** the summary is served from the cached catalog without waiting

#### Scenario: Incomplete total is marked

- **WHEN** the TUI renders an incomplete summary
- **THEN** the total is shown as `~$12.34` and agent and model lines carry no marker

#### Scenario: Complete total is unmarked

- **WHEN** the TUI renders a complete summary
- **THEN** the total has no `~`

#### Scenario: Change notifications are debounced

- **WHEN** several changes occur within 500 ms
- **THEN** one `changed` event is emitted
