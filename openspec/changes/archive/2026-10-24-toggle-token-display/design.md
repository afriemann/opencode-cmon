# Monthly token display — architecture contract

Add a read-only token projection to the existing summary and a session-only unit choice, without changing dollar accounting.

- **Parents:** [Proposal](proposal.md), [product delta](specs/cost-display/spec.md), [current capability](../../../specs/cost-display/spec.md).
- **UI authority:** [UX reference](ux.md). Layout, wrapping, control hit targets and accessibility limitations remain defined there.
- **Related:** [Tasks and verification evidence](tasks.md).

## Verification decision

Integrated candidate `abc25236cd1f1532704654b7881ed1d05052a977` is feature-verified under the explicitly accepted Windows native, existing-authentication / empty-isolated-ledger exception. The [final integrated-candidate decision](tasks.md#verification-result) records 383 controlled Linux tests, lint/build/format, real-host geometry/RPC/plugin-replacement checks, retained restart/compatibility evidence and provider-backed recording through both unit views. Assertion and disposable-resource cleanup status are independently PASS. Retained provider evidence is reused through documented input equivalence, not a new provider execution.

The accepted workflow uses a private Windows OpenCode 2.1.4 runtime with existing opaque authentication, an empty candidate ledger and absent import source. It does not prove new-authentication onboarding, an entirely empty global installation or provider execution on Linux 2.0.24. Those boundaries remain uncovered, not additional prerequisites for this accepted variant. Verification is not deployment or release execution. The technical contracts below remain unchanged; earlier preflight conditions are resolved as recorded in the linked evidence.

## Boundaries and compatibility

| Boundary | Contract |
|---|---|
| Ledger → summary | Read the five nullable token columns for every row in the requested range, preserving each component's availability. Aggregate in the same database read snapshot as dollar summary inputs. |
| Summary builder → RPC | Compute token totals independently of prices and cache-write dollar adjustments; attach the additive `tokens` object below. |
| RPC → TUI | One summary response supplies both units. Switching units changes local presentation only; no request, write, catalog load or change event is required. |
| TUI slots → shared state | Sidebar and footer share one session unit; persisted open state and sidebar breakdown choice remain independent. |

The system shall retain RPC id `cmon`, method `summary`, input `{from: number, to: number}` (UTC epoch milliseconds, half-open `[from,to)`), and event `changed({revision: number})`. It shall retain all existing response fields, dollar values, dollar ordering, pricing completeness and refresh/retry/debounce semantics. There is no new route, RPC method, event or tool.

Neither `cost_report` nor `cost_hotspots`, their schemas, outputs or token interpretations shall change. Database/schema version, recording behavior, historical interpretation, retention and repair policy shall remain unchanged.

## Verified token meaning

The five **stored** fields are disjoint categories, not the provider's inclusive raw input/output totals:

| Ledger column | OpenCode normalized field | Meaning |
|---|---|---|
| `tokens_input` | `tokens.input` | Non-cached prompt tokens |
| `tokens_cache_read` | `tokens.cache.read` | Cached prompt tokens read |
| `tokens_cache_write` | `tokens.cache.write` | Prompt tokens written to cache |
| `tokens_output` | `tokens.output` | Visible, non-reasoning generated tokens |
| `tokens_reasoning` | `tokens.reasoning` | Reasoning generated tokens |

For a complete row, token usage shall equal the sum of these five columns once each. Do not subtract cache tokens from stored input or reasoning from stored output, or add an upstream `totalTokens` to that sum. Example: input 100, cache-read 200, cache-write 300, output 40, reasoning 60 yields **700 tokens**. Cache-write dollar surcharges add no tokens.

### Source evidence

Token semantics are grounded in the following sources for the lock-resolved OpenCode packages at **2.0.24**:

1. [Core `SessionUsage.tokens`, `record`, `add`](https://cdn.jsdelivr.net/npm/@opencode/core@2.0.24/dist/chunks/repository-tdstcens.js): input maps from `nonCachedInputTokens`, output from `visibleOutputTokens`, reasoning and both cache fields map separately through `safe`; `safe` normalizes missing/nonfinite/negative values to zero. `add` accumulates each normalized category separately.
2. [Schema `TokenUsage.total`](https://cdn.jsdelivr.net/npm/@opencode/schema@2.0.24/dist/token-usage.js): explicitly sums input, output, reasoning, cache-read and cache-write.
3. [AI `Usage.visibleOutputTokens`](https://cdn.jsdelivr.net/npm/@opencode/ai@2.0.24/dist/schema/events.js): computes `max(0, outputTokens - reasoningTokens)` upstream, before core stores normalized output. This subtraction must not be repeated over the ledger.
4. [V2 CLI plugin API](https://opencode.ai/v2/docs/build/plugins/cli): documents shared memory storage that survives plugin reload and is discarded on TUI exit, versus durable storage that survives restart. [V2 RPC API](https://opencode.ai/v2/docs/build/plugins/rpc) documents additive JSON Schema definitions and existing registration/client/event mechanisms. [Plugin overview](https://opencode.ai/v2/docs/build/plugins) confirms server/CLI separation and lifecycle.

Local reference paths inspected: `src/recorder.ts` copies normalized event tokens; `src/backfill.ts` reads the same normalized `session_message.data.tokens` fields; `src/store.ts` persists their columns. Existing `src/index.ts` + `src/rpc.ts` + `src/tui.tsx` demonstrate the server/client pattern; `src/tui.click.test.tsx` demonstrates real renderer mouse and selection tests. These are existing integration patterns, not new host interfaces.

**Evidence limit:** completeness means availability in the retained ledger, not independent proof of provider billing accuracy. Core normalization and existing ingestion/repair can already have zero-filled missing data. In particular, `runTokenFill` can write input/cache zeros after successful source reads find no message or token object; imports also default missing input/cache fields to zero. Such zeros cannot now be distinguished from measured zero. The new read shall treat stored zero as known, shall not claim to recover that lost provenance, and shall not change those writers. Source evidence establishes the supported normalized shape; it does not prove every historical row originated under 2.0.24.

## Availability and aggregation invariants

For each row and independently for every total/group:

- A non-NULL component, including zero, is known. A NULL component is unknown, not zero for availability purposes.
- The known subtotal sums only non-NULL components. A row with some known components contributes those components even if another component is NULL.
- `complete` is true exactly when every component of every included row is known. For an empty row set it is true.
- A nonempty row set with no known components has `totalTokens: null` and `complete: false`. Any known component, including a known zero, yields a numeric subtotal. Thus a partially known zero is `0` with `complete: false`, not unavailable.
- An empty month has numeric `0`, `complete: true`, and empty breakdown arrays. It is distinct from existing rows with no counts.

The token projection shall read raw nullable columns or an equivalent lossless aggregate. It shall **not** reuse the pricing candidate subset (Copilot/cache-write only), or a row mapper that turns NULL input/cache into zero or discards known components when cache-write is NULL. Existing `summaryInputs` and `toCostRow` contain such pricing-oriented transformations; leave their dollar/tool behavior intact while supplying lossless token inputs.

Include exactly the same retained range rows as dollar aggregation, regardless of cost, provider, kind, failed status, parent session or pricing availability. Include recorded sub-agents, failed steps, compactions, zero-cost rows and `unknown` attribution; do not manufacture unrecorded activity. Group once by `agent`, once by `model_id` (merged across providers), and once by `provider_id`, using the ledger's existing names without re-attribution.

Each grouping shall contain one entry for every distinct group represented by rows, including zero and unavailable groups. Each list's numeric known subtotals, treating unavailable entries as adding no known amount, shall sum to the monthly numeric known subtotal. If the monthly total is unavailable, every group is unavailable. Compute group completeness from that group's rows, not the monthly flag. Pricing completeness shall never determine token completeness.

## Additive summary / RPC schema

The existing response fields `revision`, `totalMicros`, `agents`, `models`, `providers` and `complete` keep their meanings and existing required/optional status. New servers shall always include `tokens`; its top-level RPC schema property and consumer type shall be **optional** so older servers remain accepted. Within a present `tokens` object all fields below are required:

| Field | Shape / meaning |
|---|---|
| `tokens.totalTokens` | Nonnegative whole-number count or `null`; known subtotal or entirely unavailable, per rules above |
| `tokens.complete` | Boolean; token availability only |
| `tokens.agents` | Array of `{agent: string, totalTokens: number or null, complete: boolean}` |
| `tokens.models` | Array of `{model: string, totalTokens: number or null, complete: boolean}` |
| `tokens.providers` | Array of `{provider: string, totalTokens: number or null, complete: boolean}` |

All entry fields are required. Counts shall remain exact whole counts in storage, summary and serialization; presentation alone shall use the compact formatting below. No rounded/scaled values shall enter accounting, aggregation, RPC or ranking. This extends the existing numeric transport; no token-category drilldown is exposed. `tokens.complete: true` forbids a NULL total or incomplete entries. A group's NULL subtotal requires its `complete: false`.

The summary shall return token arrays separately from dollar arrays; it shall not reorder/mutate dollar arrays or add markers into monetary fields. Sort token lists by numeric known subtotal descending, unavailable after all numeric values (including zero), then **binary ascending name order** for equal values or two unavailable values, matching existing dollar name comparison. Completeness is not an additional tie-breaker. Footer ranking shall use `tokens.agents`, never dollar order, for its top two and `+N`.

### Legacy response handling

If `tokens` is absent, token mode remains ready: total is `Tokens unavailable`, the sidebar shows the coverage explanation, and existing dollar values stay usable. For the selected breakdown, existing dollar-list names may be displayed with unavailable token amounts in their supplied order; no token counts or extra names shall be invented. A missing legacy models/providers list yields no rows. The footer similarly uses existing agent names/order with unavailable amounts and its usual top-two limit. No token ranking can be inferred in this case. An empty dollar list or zero dollars does **not** establish an empty month without the new token projection; legacy absence remains unavailable.

No stricter top-level required fields or rejection of legacy dollar-only replies shall be introduced. Missing token support is not an RPC failure. New servers keep accepting unchanged old inputs; old clients can continue ignoring the additive object.

## TUI state and presentation

The system shall use plugin-scoped session memory under key `unit` with state `{unit: "dollars" | "tokens"}`, initially `"dollars"`, shared by both slots. This shall use the documented memory-storage lifetime, not durable storage or slot-local state. Slot remount, navigation, refresh, collapse and plugin reload shall not reset the unit within a running TUI; a new TUI starts in dollars. Existing durable key `view` and its `{open}` state shall remain untouched. Unit clicks, ordinary summary refresh and collapse/reopen shall preserve the selected breakdown. Full sidebar disposal and reconstruction during plugin replacement may reset the breakdown to its existing Agents default; this change introduces no breakdown persistence. Tokens shall still remain selected in both slots and the persisted open/closed state shall be retained across that replacement.

Both slots shall project their current ready summary using that shared unit. The unit selector remains available in every ready state, including empty/partial/unavailable data; loading/error hides controls without resetting the unit. A click shall select the requested inactive unit once, not toggle blindly. Active-choice/label/gap clicks shall do nothing; control-group events must not bubble into collapse. Dollar formatting and total-only pricing marker stay unchanged.

| Token value state | Display |
|---|---|
| Numeric, complete | Compact decimal count plus ` token` for exactly one, otherwise ` tokens`, including `0 tokens` and `1 token` |
| Numeric, incomplete | Same, prefixed `~`, including `~0 tokens` |
| NULL or absent token support | `Tokens unavailable` (no `~` prefix) |

Apply this per total and per breakdown entry, in both slots and open/collapsed states. Counts below 1,000 shall remain exact integers. Otherwise choose the largest applicable decimal suffix: `k` = 1,000, `M` = 1,000,000, `B` = 1,000,000,000. Round the scaled value to at most two decimal places, nearest with halfway rounded up; trim trailing fractional zeroes and the trailing decimal point. If rounding reaches `1000k` or `1000M`, promote and round the original count in the next unit. `B` is the highest suffix, including for larger counts. Use a decimal point, no grouping separators, and one space before the unit label, independently of host locale. The [product examples](specs/cost-display/spec.md#requirement-token-formatting-and-incomplete-history-are-explicit) govern boundaries, including `999,994` → `999.99k tokens`, `999,995` → `1M tokens` and `999,995,000` → `1B tokens`.

Formatting shall not alter numeric ranking or group reconciliation; independently rounded displayed subtotals need not sum to the displayed total. Rounding alone shall never add `~`. In token mode, any incomplete/unavailable monthly total shall show `Partial: some token counts unavailable` in the opened sidebar; never show it in dollar mode or the one-line footer. Empty complete summaries have no warning. Unavailable values and legacy fallback remain unchanged.

### Container layout contract

Follow [UX](ux.md#width-adaptation-actual-container-character-cells) for exact packing, spacing, selectable values and footer trailing truncation. View and Unit shall occupy separate rows at every width, View first. Each label and complete choice, including brackets, shall remain an atomic, nonshrinking, non-word-wrapping segment. Reflow shall occur only between segments, with stable reserved selected-choice widths and hit targets limited to rendered choice text. Header/footer collapse behavior remains independent of unit controls.

Header fit, control reflow and breakdown fit shall respond to the **actual sidebar content width**, after host padding/borders and before the panel's two-cell indent, not the full terminal column count. Actual container measurement or intrinsic container-constrained layout is acceptable; this contract prescribes neither a production helper nor a host API. At 45/40/22 available cells, including inside a wider terminal and after independent sidebar resize, controls and the specified compact amounts shall remain intact and nonoverlapping. Header amounts move intact to a continuation line when necessary. Breakdown amounts retain their marker/unit and separation from names; only names may truncate or move to a separate line under UX rules. Footer remains one line with its existing trailing truncation at its own available width; that truncation shall not apply to sidebar amounts.

The locked renderer exposes `RenderableOptions.onSizeChange?: (this: T) => void` and measured `width`; its Solid box supports `ref`. Core layout assigns measured width before invoking the visible resize callback (`Renderable.d.ts:31,65,86`; `chunk-node-wp7ct2m6.js:1113–1131,1163–1165`; Solid `elements.d.ts:7–9,24–26,38–40`). These interfaces support an optional measurement strategy, not a required private implementation structure. Container behavior requires rendered frames and coordinate clicks inside a narrower parent at fixed terminal width, including independent parent resize; terminal dimensions or helper-only width assertions do not establish it.

### Footer available-space invariant

The footer contribution shall fit the space actually available to it in the host row, respecting host padding, gaps and sibling contributions. It shall remain one line and preserve the existing total-first, trailing-truncation behavior. When that space permits the complete total, its marker, number and unit label shall remain visible, including `0 tokens`; an earlier narrow allocation shall not leave the footer stuck at `▼0` after space becomes available. Repeated layout passes with unchanged data and host space shall produce stable text, not progressively shorter text. Unit changes, remounts and host/sibling resizing shall recover the full fitting text without requiring new summary data.

The contribution's own intrinsic or resolved width shall not be treated as an independent measure of available parent space when that width depends on the text already clipped to it. Such self-clipping feedback can turn an initial allocation into a permanent truncation limit. Layout shall neither wrap the footer nor claim the whole parent width at the expense of host siblings. Measurement or intrinsic constrained layout remains a private implementation choice; no new host sizing API is required by this contract.

**Source evidence:** OpenCode **2.0.24** [home footer `View`](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/feature-plugins/home/footer.tsx) defines a full-width padded row with gaps, nonshrinking MCP/plugin/version siblings, the `home.footer.status` slot and a following growing spacer. [Slot rendering](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/plugin/render.tsx) emits contributions through fragments/providers, not a dedicated available-width layout box. Thus the contribution participates directly in the row's flex allocation; its measured width alone does not establish the remaining host capacity. The locked [OpenTUI core 0.5.14 declarations](https://cdn.jsdelivr.net/npm/@opentui/core@0.5.14/Renderable.d.ts) expose numeric/auto/percentage width, flex growth/shrinkage, minimum/maximum sizing, `onSizeChange(this: T)` and the numeric `width` getter; these are sizing primitives, not a guaranteed available-space query.

**Accessibility limit:** existing mouse-driven text controls provide no evidenced native focus/screen-reader contract. This change shall preserve host keyboard handling and shall not add guessed focus APIs, claim WCAG conformance, or invent shortcuts. Brackets/bold and explicit status text provide non-colour cues; terminal keyboard/screen-reader access remains unproven.

## Technical verification coverage

1. **Ledger → summary:** full five-component vector above; all 32 nullable vectors (especially cache-write NULL with known input/cache-read); all-NULL, known-zero partial, empty, multiple providers, failed/sub-agent/compaction and zero-cost rows; `[from,to)` edges; group reconciliation, group-specific completeness, deterministic ties and unavailable-last ordering. Summary reads must not write rows or change revision.
2. **Summary → RPC → UI:** optional top-level `tokens`, required nested fields and exact agent/model/provider keys; nullable numeric totals and boolean completeness; old replies and distinct NULL/zero serialization. Dollar outputs/order/pricing markers and both cost-tool outputs remain unchanged for identical rows/catalog. Unknown prices with known tokens must not mark token mode partial.
3. **Interaction:** rendered clicks both directions, no-op active/label/gap clicks, selection drag, breakdown retention across unit clicks/ordinary summary refresh/collapse-reopen, independent open state, shared footer unit/ranking after navigation/remount, actual plugin-replacement unit/open retention as specified below, restart default with persisted open preference retained, loading/error recovery and all coverage states. Layout coverage includes 45-/40-/22-cell containers inside a wider terminal, independent sidebar resize, all six unit/breakdown selections, intact amounts, long-name truncation/stacking and footer clipping. Formatting coverage includes compact boundaries, half-up rounding, promotion, trimmed zeroes, singular/plural, large B values and equal formatted strings with different numeric ranks.
4. **Recording integration:** clean isolated installation → open zero token view → normal supported model activity → existing recorder/store/notification/RPC refresh populates both views → return to identical dollars. Injected summary fixtures alone do not prove this path. The database remains intact and unit switching causes no accounting mutations.

Footer regression coverage shall use rendered frames in a host-shaped padded flex row, including nonshrinking siblings and the following growing spacer, not only an explicitly sized standalone contribution or clipping helper. Assert: (a) `0 tokens` and a representative nonzero compact total retain their complete unit text whenever space permits, across repeated settled frames and both unit-switch directions; (b) reducing then restoring row space, changing sibling occupancy at fixed terminal width, and remounting restore the full fitting text without a summary refresh; (c) genuine space shortage truncates only the trailing text, stays one line and does not overlap or displace host siblings. The supported real-host empty-token and normal-activity recording checks now pass under the accepted variant; renderer fixtures alone do not replace them. The clean, verified-candidate prerequisite for reconciliation and archive is satisfied by the linked final decision.

### Supported-host geometry versus container proof

The 45/40/22-cell acceptance targets remain mandatory and unchanged. They describe the panel's available container width, not configurable sidebar sizes promised by OpenCode. Verification shall distinguish these layers:

| Layer | Required proof |
|---|---|
| Production panel in the real renderer | Nested 45/40/22-cell parents inside a wider terminal, independent parent resize, rendered frames and coordinate clicks, with all UX amount/control assertions. Pure packing arithmetic is insufficient. These scenarios remain required even when the supported host cannot allocate those widths. |
| Supported OpenCode host | Measure the unmodified `sidebar.content` allocation and verify intact amounts, control reflow and coordinate clicks there, plus the real footer allocation and shared-state lifecycle. Generic-container results do not establish host padding, slot integration or lifecycle. |

OpenCode **2.0.24**, tag source identified as commit `e7a34f09`, fixes `SESSION_SIDEBAR_WIDTH` at **42** in [layout.ts](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/ui/layout.ts). [Sidebar](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/routes/session/sidebar.tsx) applies two cells of padding on each side, leaving 38, then a one-cell content gutter: **37 available cells**, confirmed by the settled real-host verification. Terminal resizing does not provide an arbitrary sidebar-width control. Verification shall not mutate host styles, replace the slot, or substitute terminal columns to claim actual-host 45/40/22 allocations. Host frames at the measured supported allocation and nested-renderer frames at all three acceptance widths are complementary required evidence, not interchangeable claims. No product width, amount-integrity or interaction criterion is removed or rebased to 37 cells.

### Plugin-generation reload proof

The unit-retention invariant includes an actual replacement of the candidate TUI plugin activation within the same TUI process and plugin id. A configuration reload with unchanged plugin inputs is not that event. In the pinned [CLI reload handler](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/cli/src/commands/handlers/reload.ts), `opencode reload` calls `location.reload` for configuration reload. [Plugin reconciliation](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/plugin/context.tsx) watches local sources, compares source versions/options, leaves unchanged generations untouched, and rebuilds all registrations when plugin membership/order changes.

The credential-free lifecycle test shall use an isolated copy of the test observer wrapper and the supported local-source watcher. Introduce that copy with a distinct test-only plugin id into an already watched local discovery directory, causing a real membership change and thus reconstruction of both the candidate and observer activations. Keep the candidate plugin id and built production bytes unchanged. Merely editing an independently registered observer may reload only that observer and does not prove candidate reload.

Before the trigger, select Tokens and record activation identity, process identity and the open/closed preference. Within bounded deadlines, capture old activation disposal, a distinct observer generation and evidence of candidate reconstruction, then assert Tokens remains selected in both real slots and the persisted open/closed preference is retained. A reconstructed sidebar may return to Agents; retaining Models across this disposal/reconstruction is not an assertion. Separately assert that unit clicks, ordinary summary refresh and collapse/reopen preserve a selected Models breakdown. Keep the TUI process running throughout replacement. Exit/restart remains a separate dollars-default/durable-open assertion. Retain input hashes, frames, assertion results and fixture/process cleanup; no production edits, provider calls or new application API are needed.

[Storage](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/context/storage.tsx) memoizes memory above plugin lifecycles until TUI exit; [plugin API adaptation](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.24/packages/tui/src/plugin/api.tsx) namespaces the key by plugin id. This source establishes the expected lifetime, not a runtime pass by itself. Failure to reconstruct on unchanged configuration is a harness expectation mismatch, not evidence of a unit-retention defect. Actual replacement retention and measured-slot assertions now pass; independently authorized normal-provider first use also passes under the accepted variant. The linked task evidence distinguishes executed and retained checks.

### Accepted native exception: existing authentication, isolated ledger

**Decision:** the Windows native environment exception is accepted and its first-use assertions and cleanup pass. Existing authentication is reused through a private standalone runtime, not a shared-service TUI connection. The Linux container evidence remains separately required and passes. Neither result proves a separate empty global OpenCode installation or authorizes another provider request.

The existing Windows OpenCode **2.1.4** installation holds opaque authentication. Reusing supported authentication in the private runtime avoids credential copying; moving that connection into the otherwise suitable Docker host would require forbidden copying or separate login authorization. This exception covers only the real-provider recording boundary on that Windows runtime. Linux **2.0.24** retains its separate credential-free 383-test and real-host evidence, including the affected 45-assertion run; the native provider run has 30 assertions. These results do not prove provider-backed first use on Linux, another host version, macOS or a fresh authentication/install workflow.

**Exact variant:** fresh disposable location, fresh session, initially empty candidate ledger and absent history-source file, using a private standalone runtime with existing opaque authentication. Shared service history is not empty and shall not be inspected, cleared or represented as isolated. Ordinary new usage rows in the normal installation are permitted; existing history, rows, authentication and global settings shall remain untouched. The adapter's admitted-session event filter is test isolation, not a new production ingestion policy. Its fixed small outgoing request is a bounded provider smoke, not proof of arbitrary General conversations, tools or auxiliary generation. Production recording, storage, RPC and rendering must remain real and unchanged.

#### Execution contract and resolved preflight gates

Source/procedure authority: [authenticated-runtime feasibility](../../../../docs/operations/authenticated-runtime-feasibility.md), its versioned 2.1.4 interface/driver and official pricing links, and the inspected `prepare-authenticated.ps1` / `authenticated-candidate.mjs` reference implementations. Its matching-host implementation review establishes rejection propagation and physical-dispatch interception; public hook types alone would not prove that boundary. [Private-host readiness](../../../../docs/operations/standalone-readiness.md) supersedes its historical shared-service launch. The final task decision supersedes the earlier readiness blockers in both procedure records and records the executed bounded runner, safety checks and sustained cleanup.

| Gate | Required contract |
|---|---|
| Immutable inputs | Production input baseline `9a55b54b0db1ea9546811aed55da1a54c95baf89`; record exact server/TUI/lock hashes matching the operations table, host version, runner, observer, adapter and effective disposable configuration hashes. The active adapter must match the reviewed redirect-rejecting source; the retained earlier generation is not eligible. Production shall not depend on the adapter. Final candidate `abc25236cd1f1532704654b7881ed1d05052a977` retains those production hashes; task evidence records the harness equivalence and affected revalidation. |
| Finite native harness | One independent Windows PTY runner owns terminal-query handling, rendered cells, coordinate clicks, observer, deadlines and child-process-tree teardown. Readiness ≤120 seconds, each assertion ≤30 seconds, one prompt completion ≤60 seconds, overall lifecycle ≤10 minutes, cleanup ≤60 seconds. On failure/timeout disarm and interrupt only the admitted session, then clean up; no automatic prompt retry. A missing runner or unenforceable deadline blocks execution. |
| Request admission | Exactly one fresh General session with explicit `deepseek/deepseek-flash`, fixed title and deny-all permissions. One harmless prompt, no attachments/skills/mentions. At most three physical provider attempts total, including auxiliary attempts; USD 0.05 hard ceiling. Durable reservation before every dispatch, no retry/reset on reload, auxiliary generation disabled or locally resolved, redirects/WebSocket bypass forbidden. Confirm the fixed-body/output cap, conservative input reservation and current peak pricing bound in the operations procedure; any unverifiable ceiling blocks arming. This is a ceiling, not authorization for extra model calls. |
| Safe lifecycle | Before arming, prove a scoped, sustainable disposal path for scratch activations without global changes. A single `disposed` record is insufficient when discovery reactivates the location. This gate is resolved: private-runtime Job Object containment, empty membership and a 30-second no-process/no-write observation pass. |

Preparation and build retain their 30-/120-second bounds. The executed continuation used `prepare-authenticated.ps1 -MaxRequests 1`, preserving the cumulative authorization rather than renewing it. The PTY child is `opencode --standalone` with working directory exactly `<run>/project` and child-only `OPENCODE_CLI_CONFIG_CONTENT` containing `<run>/cli-inline.json`; it inherits supported authentication without reading/copying credentials. The task evidence records `python -B src/test-support/authenticated-terminal.py --first-use`, its 480-second outer bound, 300-second owned job, bounded UI waits and 30-second cleanup observation. The earlier shared-service launch is superseded, not an alternative verification command. These records establish the completed run, not permission to arm or repeat it.

#### Required first-use evidence

1. Before admission, show candidate subscription ready, empty disposable ledger, absent source database, zero request reservations, real scoped `cmon.summary({from,to})` with numeric complete zero/empty groups, and rendered `0 tokens` in the actual candidate panel. Use one fixed UTC month range throughout; crossing its boundary invalidates reconciliation. No fixtures, seeded rows or seeded backfill-completion state.
2. In the same terminal/location/ledger, submit the single authorized prompt. Capture redacted normalized admitted-session step evidence and reservation counts. Let production recorder → store → notification → real RPC → ordinary UI refresh populate the display; no injected summary, manual ledger write or forced substitute refresh. Require a real recorded step and measured nonzero token usage; a successful request or reservation alone is insufficient. Zero dollar cost is acceptable.
3. Reconcile all five disjoint normalized components with retained rows and exact RPC totals/groups, then with their specified compact rendered amounts in sidebar and footer. Record dollars from that same settled activity. If provider counts are incomplete, preserve the availability semantics and report the first-use proof blocked rather than fabricating counts.
4. After request completion and accounting/repair settlement, take read-only row, revision, exact dollar/token summary snapshots. Click both units and return to dollars; retain selected Models across ordinary refresh and collapse/reopen. Repeat the same snapshots: no accounting-row, revision or dollar changes attributable to those interactions. Normal activity may append before settlement; zero-to-activity growth is required, not an invariance violation. This assertion concerns the isolated candidate ledger, not unrelated shared-service usage; do not inspect normal history to prove it.
5. Record assertion status and cleanup status independently. Disarm, interrupt only any still-active admitted session, close the owned terminal/process tree, dispose observer/subscriptions/store and verify no live scratch references or reactivated generations. Retain normal appended usage/history. Delete only owned scratch after proving sustained disposal and removing its dependency junction without following it; otherwise preserve scratch unarmed and mark cleanup blocked. No repeated eviction workaround, service restart, shared resource pruning or history deletion.

Executed assertions and independently verified cleanup satisfy this variant: one successful step records input 7, output 2 and zero reasoning/cache components; retained rows, real RPC and rendered sidebar/footer reconcile to 9 tokens. Settled accounting, revision and dollar summary remain unchanged after unit switching. Cumulative retained usage is two requests, USD 0.02 reserved and USD 0.000004 recorded; final candidate reconciliation made no new requests. Separate-empty-installation wording remains visibly distinguished from the explicitly accepted same-authentication variant. This verification result does not itself perform baseline sync, archive, merge, deployment or release execution.

## Technical limitations

- **Historical provenance:** stored zeros may include ingestion defaults; provider billing accuracy and the original availability of those values cannot be recovered from this projection. Historical rows are not necessarily from OpenCode 2.0.24.
- **Host state and transport:** `src/test-support/token-host{,.test}.ts` models session memory and JSON replies, not actual host reload/restart, disk persistence, runtime schema validation or RPC transport. The locked memory/durable setter distinction is documented in `@opencode/plugin@2.0.24/dist/tui/context.d.ts:6–21`; separate real-host verification supplies lifecycle and compatibility proof. Production must not depend on the test-only adapter.
- **Recording fixtures:** synthetic start/end events can exercise recorder/store/notification/summary/feed/renderer with subscribers active, but fixtures with startup backfill already complete do not establish clean-install backfill or normal provider activity.
- **Container boundaries:** hidden/zero-width callback behavior remains unverified; real host padding and the measured 37-cell slot are verified separately from nested-renderer 45/40/22-cell acceptance. Exceptional amounts too wide even for a dedicated line retain their full text per UX; host overflow clipping remains unverified. Widths below 22 cells are not guaranteed.
- **Authentication and platform coverage:** new-authentication onboarding, an entirely empty global installation, provider-backed execution on Linux 2.0.24, other host versions and macOS remain unproved. The accepted existing-authentication Windows 2.1.4 variant does not extend that coverage.
- **Accessibility:** native focus and terminal keyboard/screen-reader access remain unproven, as described above.

These limitations bound the feature-verification decision above; they do not negate its accepted gates or claim deployment or release execution.
