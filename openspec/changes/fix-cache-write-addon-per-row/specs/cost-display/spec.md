## MODIFIED Requirements

### Requirement: Totals include the cache-write add-on

The summary SHALL compute, per row at read time, a cache-write add-on of cache-write tokens times 1.25 times the selected catalog tier's input price, rounded once per row, for `github-copilot` Claude rows whose recorded cost lacks the cache-write charge, and SHALL add it to the total, the row's agent amount and the row's model amount. A row's recorded cost lacks the charge when it is below the expected cost without cache writes (input, cache-read, output and reasoning tokens at the selected tier's prices) plus half the add-on; when output tokens, reasoning tokens or the tier's output price are unknown, the row lacks the charge when the selected tier prices cache writes at zero.

#### Scenario: Summary shows the corrected figure

- **GIVEN** a `github-copilot` `claude-sonnet-5.5` row with cost 10,000 micro-USD, 1,000 output tokens, no other tokens except 40,000 cache-write tokens, at $2 input and $10 output per million
- **WHEN** the summary is requested
- **THEN** the total, the agent amount and the model amount are 110,000 micro-USD

#### Scenario: Sonnet cache writes are priced

- **GIVEN** a `github-copilot` `claude-sonnet-5.5` row with 1,725,111 cache-write tokens, an input price of $2 per million, and a recorded cost that excludes cache writes
- **WHEN** the summary is built
- **THEN** the add-on is 4,312,778 micro-USD

#### Scenario: No add-on outside the rule

- **WHEN** the model is not Copilot Claude, there are no cache-write tokens, or the recorded cost already includes the cache-write charge
- **THEN** the add-on is 0

#### Scenario: Tier selection matches opencode

- **GIVEN** a cost table with a context tier above 200,000 tokens
- **WHEN** input plus cache-read plus cache-write tokens exceed that tier size
- **THEN** that tier's input and output prices are used, otherwise the untiered entry's

#### Scenario: The add-on follows the catalog

- **GIVEN** a summary built with an empty catalog and then with a priced catalog
- **WHEN** both are compared
- **THEN** the second includes the add-on and the stored rows are unchanged

#### Scenario: A non-zero catalog cache-write price does not drop the add-on

- **GIVEN** a Copilot Claude row recorded at 1,238 micro-USD whose cache-write charge would be 123,430 micro-USD, and a catalog pricing cache writes above zero
- **WHEN** the summary is built
- **THEN** the add-on is 123,430 micro-USD

#### Scenario: A row that already includes cache writes gets no add-on

- **GIVEN** a Copilot Claude row whose recorded cost equals the expected cost plus the full cache-write charge
- **WHEN** the summary is built
- **THEN** the add-on is 0

#### Scenario: Unknown output tokens fall back to the catalog price

- **GIVEN** a Copilot Claude row with cache-write tokens and unknown output or reasoning tokens
- **WHEN** the selected tier prices cache writes at zero, the add-on applies; when it prices them above zero, the add-on is 0
- **THEN** the summary is not marked incomplete because of this fallback

#### Scenario: Sidebar and cost report agree

- **GIVEN** the same rows and catalog
- **WHEN** the sidebar summary and `cost_report` are computed
- **THEN** their totals are equal
