# cost-display Specification

## Purpose

Display monthly dollar costs and token usage in the sidebar and home footer, with comparable breakdowns and explicit data availability.

## Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total and the per-agent, per-model and per-provider micro-USD sums for `[from,to)`, each list sorted by amount descending then name, with a model named by its model id and a provider by its provider id, plus a `complete` flag, and SHALL emit `changed` after every write or prune.

RPC id `cmon`, method `summary`, numeric UTC epoch-millisecond inputs `from` and `to`, and event `changed({revision: number})` SHALL remain unchanged. Existing response fields, dollar values, ordering and pricing completeness SHALL retain their meanings. The top-level required fields SHALL remain `revision`, `totalMicros`, `agents` and `complete`; `models` and `providers` SHALL remain optional. Existing dollar entries SHALL retain their required string name (`agent`, `model` or `provider`) and numeric `micros` fields.

New servers SHALL always include an additive `tokens` object, but `tokens` SHALL remain optional in the RPC schema and consumer type to accept older servers. Within a present object, all five fields SHALL be required:

| Field | Shape |
| --- | --- |
| `tokens.totalTokens` | Number or `null` |
| `tokens.complete` | Boolean |
| `tokens.agents` | Array of `{agent: string, totalTokens: number or null, complete: boolean}` |
| `tokens.models` | Array of `{model: string, totalTokens: number or null, complete: boolean}` |
| `tokens.providers` | Array of `{provider: string, totalTokens: number or null, complete: boolean}` |

All token entry fields SHALL be required. Numeric token totals SHALL be exact nonnegative whole counts, not rounded or scaled display values; the RPC numeric shape SHALL remain `number` or `null`. No token-category drilldown SHALL be exposed.

Token totals SHALL cover the same retained range rows and attribution as dollars, summing each stored disjoint input, cache-read, cache-write, output and reasoning component once. Stored zero SHALL be known; stored NULL SHALL be unknown. For the total and independently for each group, known components SHALL contribute even if other components are NULL. `complete` SHALL be true exactly when every component of every included row is known, including an empty row set. Existing rows with no known components SHALL yield `totalTokens: null` and `complete: false`; any known component, including zero, SHALL yield a numeric subtotal. An empty range SHALL yield `totalTokens: 0`, `complete: true` and empty token arrays. Token completeness SHALL be independent of pricing completeness. A complete token total SHALL NOT have a NULL total or incomplete entries; a NULL group subtotal SHALL require `complete: false`.

Token arrays SHALL be separate from and SHALL NOT mutate dollar arrays. Each SHALL include every represented group, including zero and unavailable groups, with models merged across providers. Each grouping's known subtotals SHALL sum to the known range total, treating unavailable entries as adding no known amount; if the range total is unavailable, all groups SHALL be unavailable. Token arrays SHALL sort by numeric known subtotal descending, then unavailable entries, with binary ascending name order for ties, including ties between unavailable entries. Completeness SHALL NOT be a tie-breaker.

Absent `tokens` SHALL NOT cause an RPC failure or imply zero usage, even for an empty dollar list or zero dollar total. Token mode SHALL remain ready with `Tokens unavailable` and the sidebar coverage explanation; dollars SHALL remain usable. Existing dollar-list names MAY supply unavailable token rows in their supplied order, without invented counts, names or token ranking. Missing legacy model/provider lists SHALL yield no rows; the footer SHALL retain its existing agent order and top-two limit. Old clients SHALL remain able to ignore `tokens`; unchanged old inputs SHALL remain accepted.

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

#### Scenario: Token projection is additive

- **GIVEN** unchanged summary inputs and the same retained rows and pricing catalog
- **WHEN** a new server returns the summary
- **THEN** it includes `tokens` without changing dollar fields, their ordering or pricing completeness, and the RPC schema still accepts a dollar-only response with only the existing required top-level fields

#### Scenario: Present token objects require every nested field

- **WHEN** a response containing `tokens` is checked against the RPC schema
- **THEN** its five token fields are required, every entry requires its string `agent`, `model` or `provider` name, nullable numeric `totalTokens` and boolean `complete`, and omission of any of those required fields is rejected

#### Scenario: Completeness belongs to each total and group

- **GIVEN** one agent has all five components known and another has known input of 5 with its other components NULL, while pricing is incomplete
- **WHEN** summary is requested
- **THEN** the first agent is token-complete, the second has subtotal 5 and is token-incomplete, the range is token-incomplete, and each grouping's known subtotals reconcile to the range subtotal independently of pricing

#### Scenario: NULL and known zero remain distinct

- **GIVEN** one group has only NULL components and another has one known zero with all other components NULL
- **WHEN** summary is serialized
- **THEN** the first group's `totalTokens` is `null`, the second's is `0`, both have `complete: false`, and the range has numeric subtotal `0` with `complete: false`

#### Scenario: Empty range is complete zero

- **GIVEN** no retained rows in the requested range
- **WHEN** summary is requested
- **THEN** `tokens` contains `totalTokens: 0`, `complete: true` and empty `agents`, `models` and `providers` arrays

#### Scenario: Token ordering preserves zero and unavailable groups

- **GIVEN** groups with positive, zero and unavailable token subtotals, including equal numeric subtotals with differing completeness
- **WHEN** summary is requested
- **THEN** all groups appear, numeric subtotals sort descending before unavailable values, ties use binary ascending names without a completeness tie-breaker, and dollar ordering remains unchanged

#### Scenario: Older server has no token projection

- **GIVEN** a valid legacy summary without `tokens`, including one with zero dollars or no dollar entries
- **WHEN** Tokens is selected
- **THEN** the ready view shows `Tokens unavailable` and the sidebar coverage explanation rather than zero or an RPC error, missing model/provider lists yield no rows, any fallback names retain supplied dollar order with unavailable amounts, and switching to dollars remains usable

### Requirement: Month is the local calendar month

The TUI SHALL request the range from local midnight on the first of the current month to local midnight on the first of the next month, and SHALL refresh on `changed` and at least every 60 seconds.

#### Scenario: Month range across DST

- **GIVEN** `TZ=Europe/Berlin` and a date in March
- **WHEN** the range is computed
- **THEN** it starts and ends at local midnight despite the DST shift

### Requirement: Cost block is collapsed by default

The TUI SHALL render in `sidebar.content` and `home.footer.status` a block that is wrapped by default, with glyph `▶` when wrapped and `▼` when opened. The collapsed block SHALL show the monthly total in the selected unit; dollars SHALL be the default unit.

#### Scenario: Default wrapped sidebar

- **WHEN** a new TUI session renders with a monthly dollar total of 12.34
- **THEN** the sidebar shows `▶ This month: $12.34` and no breakdown lines

#### Scenario: Footer uses the same glyphs

- **WHEN** the footer renders wrapped and then opened in either unit
- **THEN** it starts with `▶` when wrapped and `▼` when opened

### Requirement: Opened block shows cost per agent

When opened, the sidebar SHALL list each agent with its monthly amount in the selected unit while the agent breakdown is selected. Entries SHALL be ordered by that unit's amount descending, then name for ties. The home footer SHALL stay on one line showing the selected-unit total, the top two agents by that unit and `+N` for the rest.

#### Scenario: Opened sidebar

- **WHEN** the block is opened with the agent breakdown selected
- **THEN** agents are listed by the selected unit's amount descending, then name

#### Scenario: Opened footer stays one line

- **GIVEN** three agents with available usage in the selected unit
- **WHEN** the footer is opened
- **THEN** it shows the total, the top two agents and `+1` on one line

### Requirement: Open state is shared and persisted

The TUI SHALL keep one open/closed state in persisted storage, shared by both slots and toggled by clicking the header.

#### Scenario: Toggle applies everywhere

- **WHEN** the header is clicked in the sidebar
- **THEN** the footer also switches state and the state survives a TUI restart

### Requirement: Loading and error states never break the host

The TUI SHALL show `…` while loading and `Error` in the theme's error colour when the summary request fails, without throwing. With no rows, it SHALL show `$0.00` in dollars or `0 tokens` in tokens, with an empty breakdown. Missing token information SHALL be an unavailable-data state, not a request error.

#### Scenario: Request failure

- **WHEN** the summary request fails in either unit
- **THEN** the block shows `Error` in the error colour without crashing the host

### Requirement: Sidebar block is placed first

The TUI SHALL claim `sidebar.content` with `prepend` so the cost block renders above the other sidebar sections.

#### Scenario: Sidebar claim is a prepend

- **WHEN** the TUI plugin sets up
- **THEN** its sidebar slot claim uses `prepend: "sidebar.content"`

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

The summary SHALL report `complete: false` when a row that could carry a cache-write cost has unknown token counts or no priced catalog entry, SHALL reload the catalog (at most once per minute) when such a model is missing, and the TUI SHALL prefix the dollar-mode total with `~` when pricing is incomplete. Token-mode completeness SHALL instead follow token availability.

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

#### Scenario: Incomplete dollar total is marked

- **WHEN** the TUI renders an incomplete pricing summary in dollar mode
- **THEN** the total is shown as `~$12.34` and agent and model lines carry no marker

#### Scenario: Complete dollar total is unmarked

- **WHEN** the TUI renders a complete pricing summary in dollar mode
- **THEN** the total has no `~`

#### Scenario: Change notifications are debounced

- **WHEN** several changes occur within 500 ms
- **THEN** one `changed` event is emitted

### Requirement: Sidebar controls and labels are not text-selectable

The sidebar block SHALL exclude the fold/unfold glyph, the `This month:` label and the whole `View` row from text selection while leaving the amount and the breakdown lines selectable.

#### Scenario: Chrome is not selectable

- **WHEN** the sidebar block is opened
- **THEN** the glyph, the `This month:` label, the `View` label and each tab are not selectable, and the amount and the breakdown lines are selectable

#### Scenario: Controls still work

- **WHEN** the header or a tab is clicked
- **THEN** the block opens or closes, or the breakdown switches, as before

#### Scenario: A drag across the block selects only the content

- **GIVEN** the sidebar block is opened
- **WHEN** a text selection is dragged across the header and the `View` row
- **THEN** the selected text contains the breakdown content and none of the glyph, `This month:` or `View` labels

### Requirement: Feed retries after an RPC failure

The TUI SHALL retry the summary request every 5 seconds while the feed is in the error state, without waiting for the 60-second safety-net poll, and SHALL keep no retry timer once a request has succeeded or the feed is torn down.

#### Scenario: Recovers after a transient failure

- **GIVEN** the first request fails and the next one succeeds
- **WHEN** 5 seconds pass
- **THEN** the block shows the summary instead of `Error`

#### Scenario: Keeps retrying while the RPC is down

- **GIVEN** every request fails
- **WHEN** 15 seconds pass
- **THEN** one request was made per 5 seconds and no requests overlap

#### Scenario: No retry once ready

- **WHEN** a retry succeeds
- **THEN** no further retry request is made

#### Scenario: No retry once torn down

- **WHEN** the feed is disposed while in the error state
- **THEN** no further retry request is made

#### Scenario: No retry when torn down during a request

- **GIVEN** a request is in flight
- **WHEN** the feed is disposed and the request then fails
- **THEN** no retry request is made

### Requirement: Clickable unit selection retains both views

The opened, ready sidebar SHALL offer separate clickable `$` and `Tokens` choices. The selected choice SHALL be bracketed and bold, so it is distinguishable without colour. These controls SHALL be non-text-selectable; amounts and breakdown content SHALL remain selectable. The unit selector SHALL be absent when collapsed, loading or in error.

#### Scenario: Switch both directions without other state changes

- **GIVEN** an opened sidebar with Models selected and dollars active
- **WHEN** Tokens is clicked and then $ is clicked
- **THEN** the total and model amounts switch to tokens and back to the original dollar values, while Models stays selected and the block remains open

#### Scenario: Active selection and non-control clicks

- **WHEN** the active unit choice, selector label or spacing is clicked
- **THEN** neither the unit nor the open/closed state changes

### Requirement: Narrow-sidebar controls remain readable

At an available sidebar content width of 45 character cells, the opened, ready panel SHALL keep every unit and breakdown choice readable, identifiable and clickable in both dollar and token modes. Control labels and individual choices SHALL NOT break midword, overlap or interleave with other controls. Selected-state brackets SHALL stay with their choice. Breakdown names and amounts SHALL remain visually distinct without overlap; each amount SHALL remain intact. The [UI specification](../../changes/archive/2026-10-24-toggle-token-display/ux.md) defines the exact layout and treatment of long names, rather than preserving a layout that fragments labels.

#### Scenario: Readable controls and amounts in a narrow sidebar

- **GIVEN** a ready sidebar with 45 character cells of content width and token amounts in the millions and billions
- **WHEN** the user opens the panel and switches between dollar/token units and agent/model/provider breakdowns
- **THEN** all choices remain readable and operable, no control word splits across lines, selected choices remain identifiable, and each displayed amount stays intact and separate from its name

### Requirement: Unit choice is shared for the current TUI session

The unit SHALL default to dollars on every TUI restart, without altering persisted open/closed state. A unit change SHALL apply to both sidebar and footer, survive refresh, navigation and collapse/reopen within the session, and leave breakdown selection independent.

Unit retention includes actual plugin replacement within the same running TUI and plugin identity, not merely a configuration refresh. Breakdown independence means unit clicks do not change the selected breakdown; ordinary summary refresh and collapse/reopen also leave that selection unchanged. It does not introduce breakdown retention across disposal and reconstruction of the sidebar during plugin replacement: returning to the existing Agents default there is acceptable, provided Tokens remains selected in both slots and the persisted open/closed state is retained.

#### Scenario: Retain the choice until restart

- **GIVEN** Tokens is selected
- **WHEN** the panel refreshes, collapses, reopens or the user navigates to the home view
- **THEN** its available total and breakdown values remain in tokens

#### Scenario: Restart restores dollar mode

- **GIVEN** Tokens was selected before restarting the TUI
- **WHEN** the TUI restarts
- **THEN** dollars are selected and the existing persisted open/closed preference is retained

### Requirement: Token mode measures usage without double counting

Tokens SHALL represent recorded prompt usage, including cached prompt usage, plus generated usage, including reasoning, with overlapping categories counted only once. Counts SHALL NOT be inferred from prices or dollar amounts. The field-level formula SHALL be grounded in supported source evidence; this requirement does not assume cache categories or reasoning are additive to input or output.

The token view SHALL cover the same monthly rows and attribution as the dollar view, including recorded sub-agent, failed-step and compaction usage. Each agent/model/provider grouping SHALL sum the same known usage, with each grouping's amounts summing to the known monthly total. Models SHALL retain existing merging across providers. Each breakdown SHALL sort by token amount descending, then name, independently of dollar order. Existing cost-labelled breakdown behavior SHALL apply to dollars; in token mode the same breakdown controls SHALL show token amounts and ordering instead.

#### Scenario: Token ranking differs from dollar ranking

- **GIVEN** agent A has more dollars but fewer tokens than agent B
- **WHEN** Tokens is selected
- **THEN** B precedes A in the sidebar and footer ranking; selecting $ restores dollar ranking

#### Scenario: All breakdowns reconcile

- **GIVEN** complete token counts for the month's rows
- **WHEN** Agents, Models and Providers are selected in turn
- **THEN** each list sums to the same token total with no repeated cache or reasoning usage

### Requirement: Token formatting and incomplete history are explicit

All token amounts in the sidebar and home footer, including collapsed totals and every breakdown, SHALL use the same compact decimal formatting with no dollar sign. Counts below 1,000 SHALL remain exact whole numbers. Larger counts SHALL use `k` for thousands (1,000), `M` for millions (1,000,000) and `B` for billions (1,000,000,000); `B` means billion, not million. Choose the largest applicable suffix, round its scaled value to at most two fractional digits (nearest, halfway rounded up), and remove trailing fractional zeroes and any trailing decimal point. If rounding produces `1000k` or `1000M`, promote to the next suffix and round there instead. `B` is the highest suffix; larger amounts remain expressed in billions. Use a decimal point, no digit-grouping separators, and a space before the unit label: `1 token` for exactly one, otherwise `tokens` (including abbreviated amounts).

Formatting SHALL NOT change recorded counts, computed totals, aggregation, ranking, dollar values or reporting tools. Reconciliation and ranking SHALL use underlying counts, not rounded display strings; independently rounded displayed breakdown amounts need not sum exactly to the displayed total. Rounding alone SHALL NOT add a partial-coverage marker.

Available non-overlapping counts SHALL contribute to a known subtotal even when other counts are missing. If any counts needed for a full total are unknown, the total SHALL have a `~` prefix and the opened sidebar SHALL explain `Partial: some token counts unavailable`. Affected breakdown amounts SHALL also carry `~`.

If no token counts are available for existing rows, the affected total or breakdown amount SHALL instead say `Tokens unavailable`, not zero. An older server with no token summary SHALL receive the same unavailable treatment without throwing. Completeness SHALL follow token availability, not pricing availability: existing pricing-completeness indicators SHALL continue unchanged in dollar mode and SHALL NOT alone mark token mode incomplete. Token mode SHALL NOT write guessed counts into historical rows.

#### Scenario: Partially known history

- **GIVEN** some monthly usage is known and some required counts are unknown
- **WHEN** Tokens is selected
- **THEN** the known subtotal and affected breakdown subtotals have `~`, and the opened sidebar explains the missing counts

#### Scenario: Compact formatting is consistent across panel locations

- **WHEN** available counts are displayed in a sidebar or footer total or breakdown
- **THEN** they follow these examples:

| Recorded count | Display |
| --- | --- |
| 0 | `0 tokens` |
| 1 | `1 token` |
| 999 | `999 tokens` |
| 1,000 | `1k tokens` |
| 1,234 | `1.23k tokens` |
| 1,235 | `1.24k tokens` |
| 1,200 | `1.2k tokens` |
| 999,994 | `999.99k tokens` |
| 999,995 | `1M tokens` |
| 999,995,000 | `1B tokens` |
| 590,977,798 | `590.98M tokens` |
| 1,578,717,226 | `1.58B tokens` |

#### Scenario: Rounding does not change ranking or imply missing history

- **GIVEN** complete counts of 1,234 and 1,233 for two breakdown entries
- **WHEN** Tokens is selected
- **THEN** both display `1.23k tokens` without `~`, but the entry with 1,234 ranks first regardless of name

#### Scenario: Compact partial subtotal retains its marker

- **GIVEN** a known subtotal of 1,578,717,226 with some required counts unknown
- **WHEN** Tokens is selected
- **THEN** the total displays `~1.58B tokens`, affected breakdown amounts retain `~`, and the partial-history explanation remains visible

#### Scenario: All counts unavailable or older server

- **GIVEN** existing monthly rows but no available token counts, or a server without token summary support
- **WHEN** Tokens is selected
- **THEN** the total says `Tokens unavailable`, the host does not crash, and switching to $ still shows the unchanged dollar amounts

#### Scenario: Unknown prices do not imply unknown tokens

- **GIVEN** all token counts are known but the dollar total is marked incomplete for missing pricing
- **WHEN** Tokens is selected
- **THEN** the token total is unmarked; switching to $ restores its existing pricing marker

### Requirement: First useful usage requires no manual setup

On a clean installation with no recorded or imported history, the existing supported recording path SHALL suffice to populate both views. Switching units SHALL neither create nor delete accounting rows. Existing retention and historical repair policies SHALL remain unchanged.

#### Scenario: First usage from an empty installation

- **GIVEN** a clean installation with no history
- **WHEN** the user opens the panel, selects Tokens, then completes normal model activity carrying token counts
- **THEN** the panel initially shows `0 tokens` with no breakdown and no missing-data warning, then shows the recorded usage on the normal refresh path; selecting $ shows that activity's unchanged cost
