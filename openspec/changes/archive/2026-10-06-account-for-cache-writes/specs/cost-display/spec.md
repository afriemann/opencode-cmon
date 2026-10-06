## ADDED Requirements

### Requirement: Totals include the cache-write add-on

The summary SHALL report totals and per-agent amounts as the sum of `cost_micros` and the cache-write add-on.

#### Scenario: Summary shows the corrected figure

- **GIVEN** a row with cost 100,000 and add-on 50,000 micro-USD
- **WHEN** the summary is requested
- **THEN** the total and the agent amount are 150,000 micro-USD
