# Decisions

## Integration boundary

Use the provider-scoped `http.response` hook established by official OpenCode v2.2.5 evidence. SDK 2.0.24 supplies the mutable response contract. Classify endpoints from the request URL without inspecting request bodies. Registration-order composition does not establish final-attempt identity, so diagnostics describe observations, not uniquely correlated billable calls. Disabled configuration leaves interception unregistered.

## Consumer-driven forwarding

Select a demand-driven forwarding observer with no prefetch queue. Each downstream demand reads from the source; inspection uses only the chunk being forwarded, preserving its bytes and order. The hook returns without awaiting observation completion. Preserve source status and headers; bypass bodyless responses. Forward consumer cancellation and source errors without substitution. Observation exceptions disable inspection, not delivery.

Reject cloned-response draining and tee-based observation because independent consumption can outlive consumer demand or accumulate queued content. Bounded inline inspection trades small parsing overhead for avoiding independent reads; exact timing equivalence is not claimed. If supported-runtime stream semantics cannot preserve cancellation, errors and bytes, stop rather than introduce another transport strategy.

## Observation lifetime and parsing

Keep endpoint reservations and observation state instance-local. Consume reservations on admission, including failed observations, to bound concurrency and repeated failures. Start the deadline at hook entry. Limits, output fields and completeness semantics belong to the `cost-recording` delta spec.

Use bounded incremental decoding and SSE framing, or bounded JSON accumulation. Oversized chunks/events terminate inspection without slicing or suppressing forwarded chunks. Terminal paths clear timers and parser buffers; disposal detaches inspection while forwarding remains usable.

Project only fixed allowlisted usage paths. Treat snapshots independently rather than summing unproven increments. Separate zero, invalid values, absent usage and incomplete inspection. Actual billed/cache-write fields remain unverified; no billing interpretation follows from their names.

## Diagnostics and isolation

Emit structured stderr JSON under normal host log retention, with no plugin persistence or export. Discard transient content after parsing; never emit unknown paths, payloads, URLs or raw errors. Model identity comes only from validated host metadata. Keep diagnostics failure-isolated from forwarding and recording. Leave requests, retries, usage flags and accounting untouched; additional storage and pricing machinery are unjustified.
