## ADDED Requirements

### Requirement: Tool calls keep the server responsive

Cost tools SHALL NOT block the server's event loop for the duration of a call; other work scheduled on the server MUST be able to run while a call loads its data.

#### Scenario: Other work runs during a call over many sessions

- **WHEN** a tool call loads gaps for rows from many sessions
- **THEN** work scheduled on the event loop runs before the call completes

#### Scenario: Gap lookup stays fast with a large ledger

- **WHEN** the ledger holds thousands of sessions and a gap lookup runs
- **THEN** each session's step times are found through an index, not a full table scan
