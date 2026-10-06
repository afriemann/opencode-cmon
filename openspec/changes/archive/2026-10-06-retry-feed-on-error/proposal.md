# Proposal

## Why

After an opencode server restart the cost block's first request can fail before the plugin's RPC is registered; the TUI then shows `Error` until the 60-second safety-net poll, even though the server is ready seconds later.

## What Changes

- While the feed is in the `error` state it retries every 5 seconds until a request succeeds, then returns to the existing `changed` refresh and 60-second safety-net poll.
- At most one retry timer exists at a time; it is cancelled on success and on teardown.
- Out of scope: backoff, the footer rendering, `Error` text and colour, the RPC and server.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cost-display`: adds a requirement that the feed recovers from errors by retrying.

## Impact

- `src/tui.tsx` (`createCostFeed`), `src/tui.test.ts`, `cost-display` spec. Design skipped: single function, no contracts, infrastructure or dependencies, no UI change.
