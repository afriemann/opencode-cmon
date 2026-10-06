# cost-display Specification

## Purpose

TBD - created by archiving change add-monthly-cost-tracking. Update Purpose after archive.

## Requirements

### Requirement: Summary is served over RPC for a caller-supplied range

The plugin SHALL expose `summary({from,to})` returning the total and per-agent micro-USD sums for `[from,to)`, sorted by amount descending then agent name, and SHALL emit `changed` after every write or prune.

#### Scenario: Range bounds are half-open

- **GIVEN** rows at exactly `from` and exactly `to`
- **WHEN** summary is requested
- **THEN** the row at `from` is included and the row at `to` is not

### Requirement: Month is the local calendar month

The TUI SHALL request the range from local midnight on the first of the current month to local midnight on the first of the next month, and SHALL refresh on `changed` and at least every 60 seconds.

#### Scenario: Month range across DST

- **GIVEN** `TZ=Europe/Berlin` and a date in March
- **WHEN** the range is computed
- **THEN** it starts and ends at local midnight despite the DST shift

### Requirement: Cost block is collapsed by default

The TUI SHALL render in `sidebar.content` and `home.footer.status` a block that is wrapped by default and shows only "This month: $X.XX".

#### Scenario: Default wrapped sidebar

- **WHEN** the sidebar renders for the first time
- **THEN** it shows `▸ This month: $12.34` and no agent lines

### Requirement: Opened block shows cost per agent

When opened, the sidebar block SHALL list each agent with its cost for the month, largest first, and the home footer SHALL stay on one line showing the top two agents and `+N` for the rest.

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

The TUI SHALL show `…` while loading and `—` when the RPC fails, without throwing, and SHALL show `$0.00` with an empty breakdown when no rows exist.

#### Scenario: RPC failure

- **WHEN** the RPC call rejects
- **THEN** the block shows `—`
