## ADDED Requirements

### Requirement: Copilot response observation is explicitly enabled

The plugin SHALL leave response observation unregistered unless `copilotUsageProbe` is boolean `true`, and then sample only positively identified GitHub Copilot chat-completions or responses traffic with supported bodies.

#### Scenario: Disabled probe does not intercept responses

- **WHEN** the option is absent, false or not boolean true
- **THEN** no response hook or probe timer is registered

#### Scenario: Enabled probe selects supported Copilot responses

- **WHEN** the enabled probe sees Copilot chat-completions or responses JSON/SSE traffic, or unrelated provider, endpoint, bodyless, locked or unsupported traffic
- **THEN** only eligible Copilot responses are observed and other responses remain untouched

### Requirement: Observation preserves consumer delivery

The plugin SHALL preserve response status, headers, byte sequence, source errors and consumer cancellation without independent reads, additional provider requests or changes to requests, retries, usage flags or accounting.

#### Scenario: Forwarding follows consumer demand

- **WHEN** a consumer reads an observed response incrementally or slowly
- **THEN** original chunks arrive in order without waiting for observation completion and no independent observer drains the source

#### Scenario: Cancellation and source failures propagate

- **WHEN** the consumer cancels or the source fails
- **THEN** cancellation reaches the source with its original reason or the original error reaches the consumer, while the observation is incomplete

### Requirement: Observation has finite resource and lifecycle limits

The plugin SHALL admit at most two samples per endpoint class per instance, counting failed samples, and inspect at most 1 MiB per response, 64 KiB per SSE event and 30 seconds from response-hook entry, without retaining unbounded queues or buffers.

#### Scenario: Concurrent samples consume reservations once

- **WHEN** more than two eligible responses for either endpoint arrive concurrently
- **THEN** only the first two are sampled, including failed attempts, and later responses pass through unchanged

#### Scenario: Limits and disposal stop inspection only

- **WHEN** response bytes, an SSE event, an unterminated event, duration or plugin disposal stops observation
- **THEN** buffers and timers are released, a categorical incomplete result is produced once, and downstream delivery remains usable without observer cancellation of the source

### Requirement: Usage observations distinguish evidence from absence

The plugin SHALL project fixed allowlisted numeric usage paths from JSON and SSE observations without adding independent snapshots, distinguishing zero, invalid values, absent usage and incomplete inspection; field names alone SHALL NOT establish billing meaning.

#### Scenario: Standard usage is projected without summing snapshots

- **WHEN** chat-completions or responses payloads contain standard usage, including zero and multiple usage snapshots
- **THEN** diagnostics contain validated nonnegative finite numeric fields from the latest usage snapshot and its snapshot count, not a sum of unproven increments

#### Scenario: Missing malformed and incomplete usage remain distinguishable

- **WHEN** usage is absent, a recognized field is invalid, an event is malformed, or observation ends before a complete payload
- **THEN** the result distinguishes those states and incomplete inspection never claims a field was absent from the complete response

### Requirement: Probe output excludes content and identifying data

The plugin SHALL emit only fixed diagnostic keys, categorical endpoint/outcome values, numeric usage and field-presence indicators plus syntax- and length-validated host model IDs to structured stderr, without plugin persistence or export; diagnostic failures SHALL NOT interrupt delivery or cost recording.

#### Scenario: Sensitive and unknown content is excluded

- **WHEN** payloads, headers, URLs, identifiers, unknown keys, model metadata or errors contain sensitive strings
- **THEN** diagnostics omit bodies, prompts, generated text, raw IDs, arbitrary keys, URLs, credentials and raw errors, and omit invalid host model IDs

#### Scenario: Observation and sink failures leave delivery usable

- **WHEN** inspection or the diagnostic sink fails
- **THEN** response delivery and existing recording continue without a propagated diagnostic exception
