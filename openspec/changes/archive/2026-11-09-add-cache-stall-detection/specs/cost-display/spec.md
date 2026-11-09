## ADDED Requirements

### Requirement: Ongoing cache stalls are carried by the summary

The plugin SHALL include in `summary` the ongoing cache stalls whose last step is at most 30 minutes old (at most three, highest stalled cost first) with session, stalled steps, wasted cost and start time.

#### Scenario: Late-connecting TUI sees an ongoing stall

- **GIVEN** a session with an ongoing cache stall
- **WHEN** summary is requested
- **THEN** it lists that stall

#### Scenario: Idle stalls are not listed, and the list is capped by cost

- **GIVEN** four ongoing stalls, or a stall whose last step is over 30 minutes old
- **WHEN** summary is requested
- **THEN** at most the three costliest recent stalls are listed and an idle one is not

#### Scenario: Recovered stall is not listed

- **GIVEN** a stall followed by a step whose cache read grows
- **WHEN** summary is requested
- **THEN** no stall is listed for that session

### Requirement: A new cache stall is announced once

The plugin SHALL emit one `cacheStall` event when the steps it just recorded complete a cache stall in a session, and SHALL NOT emit again for the same stall until the cache has recovered.

#### Scenario: Stall announced once

- **GIVEN** a session reaching its fifth stalled step and then a sixth
- **WHEN** both steps are recorded
- **THEN** one `cacheStall` event is emitted

#### Scenario: Stall after recovery is announced again

- **GIVEN** an announced stall, a step whose cache read grows, and a new stall
- **WHEN** the new stall reaches its minimum length
- **THEN** a second `cacheStall` event is emitted

### Requirement: The TUI warns about cache stalls

The TUI SHALL show a warning toast for each `cacheStall` event and SHALL show a one-line warning "cache stalled N steps, ~$X wasted since HH:MM" in the cost block while the summary lists an ongoing stall.

#### Scenario: Toast on event

- **GIVEN** a `cacheStall` event
- **WHEN** the TUI receives it
- **THEN** a warning toast with the step count and wasted cost is shown

#### Scenario: Warning line without stalls

- **GIVEN** a summary without ongoing stalls, or from a server that omits the field
- **WHEN** the cost block renders
- **THEN** no warning line is shown
