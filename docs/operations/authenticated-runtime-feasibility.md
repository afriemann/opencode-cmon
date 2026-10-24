# Authenticated-runtime feasibility

Determine whether provider-backed first use can reuse an authenticated service without changing normal accounting.

Parent: [operations](README.md). Current procedure: [standalone readiness](standalone-readiness.md). **The shared-service launch instructions below are historical and must not be executed.** Private standalone operation now replaces that restriction because the actual TUI RPC defaults to the server's working directory. No provider execution occurred; application readiness remains blocked on the runner interface.

## Authorized boundary

- Assess the existing authenticated service through documented CLI/API reads only. No credential/config-file inspection, copying, global changes, service restart or normal history access.
- Disposable configuration and ledgers may exist only beneath this change worktree. No inference in this phase; a later run must enforce at most three provider requests including auxiliary calls and USD 0.05 total.
- Ordinary accounting may append new test usage to the normal ledger. Existing rows, history, credentials and global configuration must not be edited, reset or copied. This supersedes the earlier no-append requirement below.
- Existing Docker verification is retained, not rerun. Reusing the native authenticated service is not an approved substitute for the container gate without an architecture/test-plan exception.

## Evidence

Finite PowerShell probes, each bounded to 20 seconds or less:

```powershell
opencode service status
opencode api get /openapi.json
```

Service discovery returned an endpoint. The authenticated OpenAPI read succeeded; only the event operation description and parameters were surfaced, not user data or credentials. Its `GET /api/event` operation explicitly subscribes to events **across all server locations**, with no location-filter parameters. This agrees with the [published V2 OpenAPI](https://opencode.ai/v2/openapi.json).

Candidate production inputs inspected at `a16d4359de2c4a92f514d9588ca49f8ea15dd516` match `9a55b54b0db1ea9546811aed55da1a54c95baf89` for the server, recorder, store, backfill, TUI, summary, RPC, manifest and lockfile. The intervening `src/` delta is the terminal test driver, not production code. Two existing uncommitted requirement/design edits were preserved. No candidate was loaded into the authenticated service.

## Earlier assessment (superseded no-append requirement)

| Boundary          | Finding                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate storage | `src/index.ts:48-58` supports `dbPath` and `sourceDbPath`; explicit fresh scratch paths could prevent that instance from opening the normal ledger or history source. They do not scope event delivery.                                                                                                    |
| Live recording    | `src/index.ts:174-195` subscribes to the server event stream and persists each returned cost row. `src/recorder.ts:99-135,176-211` records supported step/compaction events without rejecting other locations or sessions. Directory is recorded as metadata, not an admission filter.                     |
| Normal runtime    | A candidate wrapper could filter its own subscription, but cannot stop an already active normal plugin receiving test events. The installed older clone was not inspected; no evidence establishes that it excludes the proposed test location. Therefore normal-ledger non-mutation cannot be guaranteed. |
| Plugin selection  | The [V2 plugin guide](https://opencode.ai/v2/docs/plugins) says plugin arrays accumulate and supports ordered disable/re-enable entries. Such controls apply to the test location; they do not remove an existing subscription in another loaded location. No deduplication experiment was run.            |
| Host history      | Same-service disposable sessions would still be stored by the shared runtime. A scratch `sourceDbPath` changes the plugin's reader, not the runtime's session storage. Later session removal does not prove absence of accounting writes or retained history.                                              |

The earlier non-mutation requirement blocked setup. Approval of ordinary new accounting entries removes that blocker; it does not authorize history deletion or temporary global accounting changes.

## Current setup procedure

Run `pwsh -NoProfile -NonInteractive -File docs/operations/prepare-authenticated.ps1` from this worktree (30-second preparation bound). It prints a fresh ignored run directory beneath `node_modules/.cache/cmon-auth/`. Build there with `bun run build` in its `candidate/` directory (120-second bound). No dependency installation, inference, credentials or global edits are involved. Preserve the printed directory as `<run>` for subsequent operations.

`prepare-authenticated.ps1` exports exactly `9a55b54b0db1ea9546811aed55da1a54c95baf89`, checks its dependency lock against the prepared checkout, and uses a project-local dependency junction. The new location is `<run>/project`; `ledger.sqlite` and the deliberately absent `absent-source.sqlite` are separate fresh paths. The adapter delegates to the unchanged candidate server setup, supplies those paths, and forwards only the admitted session's events. It never seeds accounting. The inherited `opencode-cmon` ID is disabled **only at the disposable location** and replaced by a distinct adapter ID, preventing ID deduplication from selecting the older normal plugin there. Other loaded locations and normal accounting remain untouched. Confirm effective plugin status before arming.

### Supported interfaces and safety gates

- Use `opencode api` with existing service discovery/authentication; never extract connection credentials. The actual host is **2.1.4**, not the Docker host pin **2.0.24**. Runtime metadata confirms General selects `deepseek/deepseek-flash` (DeepSeek V4.1 Flash 1017); the server default is a different model and must not be used implicitly.
- Query scoped metadata with `opencode api plugin.list --param 'location[directory]=<run>/project'`. Poll at most 15 seconds for `state.status=active` because initial plugin inventory can be empty. The adapter writes a `ready` lifecycle record after the real candidate setup returns cleanup. Without an admission file, its guards reject generation and no session events reach its ledger; rejection-to-dispatch behavior still needs the source proof below.
- Later, after native-execution approval, create **one fresh session** through `session.create`, with `location.directory=<run>/project`, `agent=general`, explicit `model={providerID:"deepseek",id:"deepseek-flash"}`, a fixed title and deny-all permissions. Never reuse or inspect normal sessions.
- The independent terminal runner launches normal `opencode` (not `--standalone`) from `<run>/project`, with process-local `OPENCODE_CLI_CONFIG_CONTENT` equal to `cli-inline.json`. This replaces only that child's terminal plugin array with the candidate TUI. Do not write global CLI settings. A native rendered-terminal facility is still required; the existing Linux PTY driver cannot run unchanged on Windows.
- Before provider work, independently capture the empty real cost RPC and rendered zero panel. Use the existing `CostRpc` imported from `<run>/candidate/dist/rpc.js` through the TUI observer's `ctx.client.rpc(CostRpc).summary({from,to})`; retain the same client/location, candidate, ledger and rendered terminal after the call.
- Arming is a **later execution action**, not part of setup: write `<run>/armed-session.json` with `{ "sessionID": "<new-session>", "expires": <epoch-ms-at-most-10-minutes-ahead> }`. Submit one `session.prompt` containing `Reply OK.` without attachments, mentions or skills. Wait at most 60 seconds; interrupt that exact session on timeout. No automatic rerun.
- The adapter reserves one of three durable slots **before dispatch** in `requests.json`; failed attempts remain counted. Its hooks disable retries, WebSocket dispatch and non-primary requests. Title generation receives a local fixed result, so is intended to consume **zero** provider requests. Compaction and transient generation are rejected. Only `deepseek/deepseek-flash` at the official HTTPS chat endpoint is admitted, with redirects forbidden. These controls must not be treated as an established hard ceiling until host hook rejection semantics are proved.
- The final outgoing HTTP body is fixed: one tiny text message, no tools or history, non-thinking mode, output ceiling 256. This replaces request content only; stored history and ordinary recorder events are unchanged. Reserve USD **0.01 per physical attempt**, at most **0.03** for three attempts, below the approved USD 0.05 ceiling. This conservative reservation supersedes the earlier USD 0.0006072 estimate; fail closed on incompatible old counters rather than resetting them. Abort if pricing or request semantics invalidate the reservation. Ordinary ledger rows need not include auxiliary attempts, so use the transport reservations, not row count, for the request cap.
- Count only the admitted session's requests for this acceptance run; unrelated orchestration remains normal usage and is excluded from the scratch event feed. Verify one real recorded step, token counts, summary RPC update and corresponding rendered frame independently. A request reservation is not proof of successful recording or rendering.

### Source grounding

[Plugin controls](https://opencode.ai/v2/docs/plugins) document ordered ID removals and re-enable behavior; [hooks](https://opencode.ai/v2/docs/build/plugins) document per-kind generation hooks, native HTTP interception, output overrides and local title results. Published [2.1.4 session interfaces](https://unpkg.com/@opencode/plugin@2.1.4/dist/promise/session.d.ts) confirm these hooks, retry decisions and mutable requests on the actual host version; the installed 2.0.24 interfaces agree for the used fields. The [2.1.4 DeepSeek driver](https://unpkg.com/@opencode/ai@2.1.4/dist/providers/deepseek.js) uses `/v1/chat/completions` and `max_tokens`. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing) identifies the Flash alias, peak/off-peak rates and 384K default maximum output: an explicit output cap is essential. [Inline CLI settings](https://opencode.ai/v2/docs/cli/config) support child-only terminal configuration. Authentication resolution APIs are intentionally not used.

## Observed setup and outstanding gates

Prepared scratch: `node_modules/.cache/cmon-auth/run-0be21d503ed2401f95c99f79819466db/`. Build exit 0; candidate adapter reported `ready` on host 2.1.4; effective inventory contained `cmon-isolated-candidate` with `state.status=active` and no inherited `opencode-cmon` instance. Scoped real RPC returned revision 0, cost 0, token total 0 and empty groups. `requests.json` remained at 0 attempts / USD 0 reserved; no admission file or test session was created. No normal installation was changed.

The CLI's raw `method path` mode did not apply the supplied `--param` location to an initial RPC read; it returned the default location's aggregate instead. That is **not** zero-state evidence; its scratch capture was discarded, and no history or accounting mutation occurred. Use the documented operation-ID mode for scoped requests, confirmed against the disposable zero ledger:

```powershell
opencode api rpc.call --param rpcID=cmon --param method=summary --param 'location[directory]=<run>/project' --data '{"input":{"from":<month-start-ms>,"to":<next-month-start-ms>}}'
```

| Built input                      | SHA256                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| Candidate server `dist/index.js` | `1fcb37595b2a81ca1d45bc1f9a5e99776ff9b88d3cdb19281525b4cc8caa5f6c` |
| Candidate TUI `dist/tui.js`      | `643163b107ea1226cf1bb5236b067b724f887d791a1de6d59bd30e6fea40cbbe` |
| Candidate lockfile               | `489dcc606351dfc3cf56620b81f1ab15d090fd340ed5acd11e5f001d499c6184` |

Outstanding before arming:

1. Source proof on **host 2.1.4** that rejected context/model/native-HTTP hooks abort dispatch rather than being logged and ignored, and that native HTTP hooks cover every physical provider retry. Public authoring types alone do not establish this. Obtain the matching implementation or a documented contract; do not test uncertainty with paid inference.
2. Independent native rendered-terminal runner, bounded process-tree lifecycle and observer interface. Windows cannot use the Linux `pty`/`termios` driver unchanged. Setup proves the RPC endpoint, not a rendered frame. No full runnable terminal harness is claimed yet.
3. Approved native-execution exception covering actual host 2.1.4 and the unchanged production candidate. The final adapter includes redirect rejection (source SHA256 `17ebd2f930097989b4aa85a16a242109a821de393d45f8b38f3725fe36c701da`); it was syntax-checked but its scratch copy was **not** refreshed because verified sustained eviction failed. Never arm that earlier scratch adapter.

All three plus the cleanup issue below are required for environment-ready status. This is **partial setup, not acceptance or release readiness**. Adapter syntax and operations diff-whitespace checks passed. Existing requirement/design edits were preserved.

## Native exception and cleanup

Native-execution rationale for review: the real service holds opaque authenticated connections. Moving them into the otherwise suitable Linux container would require forbidden credential copying or a separately authorized login. Native use tests the real provider boundary without that copy, but proves host 2.1.4 behavior, not a provider call on pinned Linux 2.0.24. The approved Docker evidence remains separate. This rationale is **not an approved exception**.

After verification, disarm by removing only the run's admission file, interrupt any admitted active session, close the test terminal and verify its process tree exited. Use `debug.location.evict` scoped to the exact disposable location to dispose the candidate subscription/store; require its `disposed` record. Do not restart the service, delete sessions/history, reset accounting, prune shared resources or unload another location. Preserve bounded private evidence and the normal appended usage rows. Remove only the known run's dependency junction (not its target) before optionally deleting that run's scratch. If disposal cannot be proved, retain scratch and report cleanup blocked rather than deleting an open ledger.

**Observed cleanup issue:** one scoped `debug.location.evict` completed and produced `disposed`, but a new `ready` generation appeared about half a second later. Sustained unloading is therefore **not proved**. No repeated eviction, service restart, scratch deletion or admission was attempted. The earlier unarmed adapter and empty scratch ledger are retained; its request counter remains zero. Investigate the disposable location's reactivation using scoped public runtime/source evidence before refreshing the adapter or deleting scratch. No rollback of the normal installation is required or authorized.

## Sustained-disposal and native-tool continuation

The retained run's manifest matched the authorized candidate and zero request budget usage. Its disposable `project/opencode.json` still referenced the wrapper, explaining why rebuilding that location could reactivate it. Removed **only that scratch package reference**, retaining the inherited normal-plugin disable and adding `-cmon-isolated-candidate`. No global configuration, normal ledger, candidate source copy or shared service was modified.

The authenticated host's own OpenAPI describes `debug.location.evict` as disposing the requested location's cached services so its next use boots fresh. It accepts the scoped `location[directory]` query. In contrast, `location.reload` explicitly rebuilds **every loaded location** and was not used. The [plugin controls](https://opencode.ai/v2/docs/plugins) document ordered removals and automatic reload of watched configuration.

After the scratch config change, one exact-location eviction exited 0. The wrapper recorded `disposed` with no subsequent `ready`. Scoped `plugin.list` rebuilt/read that location without an active `cmon-isolated-candidate`; another inventory read after a 30-second observation window still showed none. SHA256, size and modification timestamps of the scratch ledger, request state and lifecycle log were unchanged throughout that window; SQLite sidecars were absent. Admission remained absent and attempts remained zero. This combines the supported disposal contract, candidate cleanup record, fresh inventory and no-late-write observation; a 204 response alone was not counted as unloading proof. It establishes bounded sustained candidate disposal, not that the shared runtime permanently forgets the location. Scratch is retained for evidence, not deleted with open references assumed safe.

Private run evidence: `disposal-proof.json`, `disposal-plugins.json`, `disposal-plugins-final.json`, `lifecycle.jsonl` in the retained run identified above. The old adapter remains unarmed and is no longer configured. Any later setup must use a fresh run with the current adapter; do not re-enable the old copy.

### Guard review and remaining boundary

The supplied matching-host 2.1.4 implementation review establishes that rejected hooks defect before HTTP execution and are not retried. The adapter's native HTTP guard accepts only primary `deepseek/deepseek-flash` POSTs to `https://api.deepseek.com/chat/completions` (route proof below), rejects redirects, replaces the body with one fixed short message and `max_tokens:256`, and disables model retries, WebSocket and auxiliary generation. Local title output requires no provider call. Admission is absent by default and expires within ten minutes. The request reservation reads, checks, increments and writes synchronously with no await in that critical section; `attempts >= 3` rejects a fourth dispatch. Invalid/noninteger/negative counters or inconsistent reserved amounts now fail closed as well. These are source-backed controls, not a paid probe or proof of successful provider accounting.

The active design/test plan now contains the conditional native exception. [Pinned Windows terminal tools](windows-terminal-tools.md) are installed and their no-service ConPTY/Job Object smoke passed. The remaining next step is the independently owned finite no-call application harness and its zero-state/RPC/rendered assertions. Tooling and disposal readiness do **not** authorize arming or establish first-use acceptance. No real prompt was run, and existing Docker/credential-free results were not repeated.

### Default endpoint correction (2026-10-24)

The first admitted attempt was reported blocked by the old `/v1`-only endpoint guard before provider dispatch. No retry is authorized by this correction. The following public-source chain proves the catalog-backed default, not an arbitrary configured override:

| Source | Relevant behavior |
| --- | --- |
| [Public provider catalog](https://models.dev/api.json), `deepseek` | `api=https://api.deepseek.com`, `npm=@ai-sdk/openai-compatible`; `deepseek-flash` has no model-specific provider override at review time |
| [Core 2.1.4 catalog conversion](https://unpkg.com/@opencode/core@2.1.4/dist/chunks/location-akfw3dm8.js), lines 68–77, 160–165 | Provider `api` becomes `settings.baseURL`; model `provider.api` overrides it only when present |
| [Core 2.1.4 model resolution](https://unpkg.com/@opencode/core@2.1.4/dist/chunks/location-6b66j3w1.js), lines 178–184 | Merges provider settings into model settings |
| [Core 2.1.4 native mapping](https://unpkg.com/@opencode/core@2.1.4/dist/chunks/location-ght5gt7k.js), line 148 | DeepSeek's compatible SDK maps to `@opencode/ai/providers/deepseek` |
| [AI 2.1.4 DeepSeek route](https://unpkg.com/@opencode/ai@2.1.4/dist/providers/deepseek.js), `route`, `configure`, `model` | Route path `/chat/completions`; supplied `baseURL` replaces the driver's standalone `/v1` default; model uses `max_tokens` |
| [AI 2.1.4 endpoint join](https://unpkg.com/@opencode/ai@2.1.4/dist/route/endpoint.js), `render` | Trims base trailing slashes and concatenates the route path; no implicit `/v1` |
| [AI 2.1.4 HTTP transport](https://unpkg.com/@opencode/ai@2.1.4/dist/route/transport/http.js), `jsonRequestParts`, `httpJson.prepare` | Renders endpoint, adds query only if configured, constructs JSON POST |
| [Official DeepSeek quick start](https://api-docs.deepseek.com/) | OpenAI-compatible root base and explicit `POST /chat/completions` example |

**Exact allowlist:** method `POST`, origin `https://api.deepseek.com`, pathname `/chat/completions`, no query (including an empty `?`), no URL credentials or fragment. `/v1/chat/completions` is intentionally not also allowed: it is the driver's standalone default, not this catalog-backed route. Other origins, ports, paths and methods remain rejected. No global config, credentials, runtime API or inference were read/executed to derive this default; a configured override still fails closed.

Endpoint rejection appends `http-rejected` to the owned run's `lifecycle.jsonl` before throwing, containing only timestamp/event, method, origin, path and `queryPresent` boolean. No raw URL, query values, credentials, headers or body are recorded. Reservation is untouched on endpoint rejection; evidence-write failure also aborts the hook. The corrected adapter must be used only in a separately authorized fresh run; retained adapters/counters are not refreshed by this change.

Offline-only check: `node --check docs/operations/authenticated-candidate.mjs` and `node node_modules/.cache/cmon-native-tools/endpoint-offline-check.mjs` (30-second bound each). The scratch projection captures the real HTTP-hook source with mocked in-memory state/evidence and a forbidden-network stub; it does not import the adapter, create admission, start a host or dispatch inference. It covers exact default acceptance, nine endpoint rejections, redaction, three USD 0.01 mock reservations, fourth-attempt rejection, invalid counters, fixed body and unchanged source guards.

Both checks exited 0. Projection result: `PASS`, nine rejected endpoints, three mock reservations, fourth rejected, zero provider dispatches, zero admission files created, no real runtime started. Existing run state, candidate code and authoritative tests were untouched. Runtime health/first-use acceptance remains unverified; these are adapter safety checks only.

Independent fixture expectations must use `/chat/completions` for accepted requests, reject `/v1/chat/completions`, expect USD `attempts * 0.01`, and assert the sanitized `http-rejected` receipt with no counter change. Do not relax the three-attempt, session/model, no-retry, no-history/tools or output/thinking assertions. Authoritative tests were not edited here.

### Remaining-budget run limit (2026-10-24)

The authorization is **three physical provider requests / USD 0.05 across all runs**, not three per new directory. Supplied execution evidence reports one physical request already consumed, nine tokens and USD 0.000002 actual cost; retain its USD 0.01 reservation and all prior evidence. A new directory must not renew that authorization.

For the next independently supervised run, prepare with **one remaining slot** (command from this worktree; 30-second bound):

```powershell
pwsh -NoProfile -NonInteractive -File docs/operations/prepare-authenticated.ps1 -MaxRequests 1
```

This is preparation only, not permission to arm or prompt. `-MaxRequests 2` is the alternative maximum remaining allowance under the supplied prior usage; do not omit the parameter for this continuation. The generic default remains 3 for a wholly unused authorization. Reconcile prior physical attempts/reservations before any subsequent run; this local guard cannot discover other run directories. With limit 1, the original cumulative maximum is two physical requests / USD 0.02 reserved. A failed send consumes the slot and blocks another physical attempt; no retry or auxiliary request is newly permitted.

**Executable interface:** the prepare parameter accepts only strings `1`, `2`, `3`, then writes a numeric `maxRequests` to `environment.json`, plugin `options.maxRequests` and `requests.json`. The adapter reads `ctx.options?.maxRequests` safely, falling back to the manifest and then 3 only when absent. Noninteger, null, out-of-range or manifest-mismatched values fail before hook registration. The synchronous native HTTP hook compares `attempts >= maxRequests`, preserves USD `attempts * 0.01`, and persists the limit with every reservation and `http-attempt` receipt. A persisted different limit fails closed. Compatible older state without the field is annotated only upon a valid reservation, never reset. Existing counters, ledgers and prior budget history were not edited.

**Source basis:** `authenticated-candidate.mjs` implements the limit in the same pre-dispatch critical section as the previously reviewed host-2.1.4 native HTTP guard; the matching-host abort/physical-retry grounding above still applies. `prepare-authenticated.ps1` passes the numeric option and records the same allowance in both evidence files. Endpoint, provider/model, admission, body replacement, no tools/history, local title and disabled retry/auxiliary hooks are unchanged.

**Offline evidence:** bounded Node projection of the actual adapter setup/hooks with in-memory filesystem, mocked candidate and no HTTP transport passed **29 cases**. Limits 1/2/3 rejected respectively the second/third/fourth attempt; absent options/manifest retained default 3. Each accepted mock reservation was USD `attempts * 0.01`; malformed limits (including null/string), conflicting manifest/state limits and invalid counters failed closed. Seven wrong endpoints, wrong model and auxiliary requests were rejected; endpoint rejection left state unchanged and receipts redacted. Fixed output/body, redirect prohibition and retry refusal passed. Node syntax, PowerShell parser and six malformed CLI parameter checks passed. The first projection invocation exposed a synchronous-throw assertion mismatch; correcting the offline assertion to `assert.throws` produced the passing result, with no adapter relaxation.

**Independent fixture expectations:** configure `{ options: { maxRequests: 1 } }` and matching manifest/state evidence for the recommended run; expect one reservation then rejection without a second state increment. Repeat with 2 and expect two reservations then rejection. Assert `requests.json.maxRequests`, `http-attempt.maxRequests`, unchanged state after rejection and USD `attempts * 0.01`; keep all existing endpoint/session/model/body restrictions. Do not modify authoritative tests to assume a renewed three-request allowance. **Actual provider requests this phase: 0.** No application/runtime was started; runtime acceptance remains unverified by these checks.
