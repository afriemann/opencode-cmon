## ADDED Requirements

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
