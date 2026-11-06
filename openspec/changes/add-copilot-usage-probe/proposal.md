# Proposal

## Why

Copilot billing exceeds cmon estimates, but normalized OpenCode usage omits information needed to identify an automatic correction. Observe a bounded sample of actual usage responses without collecting conversation content or changing accounting.

## What Changes

- Add a disabled-by-default Copilot usage probe for existing chat-completions and responses traffic.
- Expose only allowlisted numeric usage and field-presence diagnostics, explicitly distinguishing incomplete observations from absent fields.
- Preserve response delivery and stop observation on sampling, size, duration or lifecycle limits.

## Capabilities

### Modified Capabilities

- `cost-recording`: opt-in, content-free observation alongside existing recording.

## Impact

Implementation is limited to `src/index.ts`, `src/copilot-usage-probe.ts`, their colocated tests and `README.md`. No dependencies, database changes, pricing corrections, new provider requests, tools, TUI changes or live activation are included. Implementation is verified against OpenCode 2.2.5 hook and adapter contracts.
