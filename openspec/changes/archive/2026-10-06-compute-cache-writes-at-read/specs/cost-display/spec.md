## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total, per-agent and per-model micro-USD sums for `[from,to)`, each list sorted by amount descending then name, with a model named `providerId/modelId`, plus a `complete` flag, and SHALL emit `changed` after every write or prune.

#### Scenario: Range bounds are half-open

- **GIVEN** rows at exactly `from` and exactly `to`
- **WHEN** summary is requested
- **THEN** the row at `from` is included and the row at `to` is not

#### Scenario: Models are grouped by provider and model

- **GIVEN** rows for `a/m1` twice, `a/m2` and `b/m1`
- **WHEN** summary is requested
- **THEN** three models are returned, ordered by amount descending then name, and their amounts sum to the total

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
