# Toggle token display — implementation and verification

Display compact token amounts and keep controls usable in a narrow sidebar without changing counts, ranking or dollar accounting.

References: [proposal](proposal.md), [behavior delta](specs/cost-display/spec.md), [design](design.md), [UX](ux.md), [Linux verification procedure](../../../../docs/operations/linux-verification.md). External links use the approved archive destination depth; change-internal links remain relative.

## Completed work

- [x] Sum the five disjoint token columns losslessly; preserve NULL versus zero, group completeness, half-open ranges and raw-value ordering.
- [x] Add the optional complete `tokens` RPC block without changing inputs, dollar fields, database version or tool outputs.
- [x] Share unit selection between sidebar and footer through session memory; default to dollars after restart and preserve independent durable open state.
- [x] Render loading, unavailable and partial states without confusing missing prices with missing token history; restore unchanged dollar totals and ranking.
- [x] Format integers below 1,000 exactly; otherwise use decimal k/M/B, nearest-half-up rounding, at most two trimmed decimals, suffix promotion, a B cap and singular `1 token`.
- [x] Measure the panel rather than the terminal; keep separate View/Unit rows, whole clickable choices and reserved nonshrinking widths at 45/40/22 cells.
- [x] Preserve intact amounts, continuation/stacking and name truncation; clip the footer at its allocation without self-clipping feedback or displacing siblings.
- [x] Preserve content selection and control isolation; dispose test-owned renderers, subscriptions and SQLite readers before fixture removal.
- [x] Pass controlled regression, typecheck, lint, build and formatting checks on the pinned integrated candidate.
- [x] Verify real-host slot sharing, source-triggered replacement, restart behavior, supported geometry and RPC compatibility.
- [x] Verify normal provider recording and refresh, both rendered unit views and unchanged settled accounting under the accepted existing-authentication / empty-isolated-ledger variant.
- [x] Verify disposable-resource cleanup independently of assertions.
- [x] Confirm the post-candidate finalization delta is documentation-only and finish this record before archival.

Production areas: `src/{types,store,summary,rpc,index}.ts` and `src/tui.tsx`. Token presentation preserves recording, repair, retention, monetary semantics, ranking, tool outputs, dependencies and configuration.

## Executable coverage

Paths are relative to `src/`. Rendered tests exercise production controls; fixture and synthetic-event checks are not substitutes for real-host/provider proof.

| Tests | Assertions |
| --- | --- |
| `test-support/token-host.test.ts` TOK-00 | Recording adapter, dollar baseline and fixture cleanup. |
| `token-summary.test.ts` TOK-01/02 | All 32 NULL masks, complete total 700, child/compaction/zero-cost cases, attribution, merged models, binary ties, completeness, half-open ranges, empty zero and read-only repeat. |
| `token-summary.test.ts` TOK-03 | Unchanged RPC inputs/status; required nested nullable totals, completeness and exact group keys. |
| `token-display.test.tsx` TOK-04/06 | Rendered unit switching, shared slots, independent remount, refresh/error recovery, collapse, session memory and fresh-memory dollars default; no RPC or accounting writes from switching. |
| `token-display.test.tsx` TOK-05; `tui.click.test.tsx` | Active/label/gap no-ops, ancestor isolation, content versus chrome selection at 80/45/40/22 cells. |
| `token-display.test.tsx` TOK-07/08/10/11 | Legacy reply, loading ellipsis, unavailable/partial states, intact narrow amounts, Providers reachability, group coverage and singular/large amounts. |
| `token-display.test.tsx` TOK-09 | Active receiver before synthetic activity; production recorder→store→notification→RPC-adapter→rendered refresh to 700 tokens/$0.25; unchanged ledger after switching and complete disposal. |
| `token-summary.test.ts` TOK-12/13/19 | Immutable dollars, missing-price token completeness, exact total 2467 and raw 1234-before-1233 ordering despite equal compact strings. |
| `token-format.test.ts` TOK-14/15 | Every integer below 1,000; zero/one/NULL/absent, completeness, half-up boundaries, suffix promotion, trimmed zeroes and large B values without raw-value changes. |
| `token-display.test.tsx` TOK-16/17/18/21 | Nested 45/40/22 panels in a 120-cell terminal; intact choices, all selections, panel-only resize, 1.58B/long-name/stacked layouts and footer clipping at its own width. |
| `test-support/layout-boundary.test.tsx` TOK-20 | Independent parent widths 45→22→40→45 at fixed terminal width; test-only probe, no production dependency. |
| `token-footer.test.tsx` TOK-22 | Public unit clicks for zero/1.58B totals; stable frames across 120→48→120→32→120 allocations, sibling occupancy changes, remount and one-line clipping without sibling displacement. |
| Existing accounting/TUI/tool suites | Preserve storage, recording, backfill, pricing, money, analysis and tool behavior. |
| `test-support/host-terminal.py` | Real slots/controls, measured geometry, candidate disposal/reconstruction, collapse/reopen, restart and real RPC legacy/NULL/zero/partial fixtures. |
| `test-support/authenticated-terminal.test.py` | 18 offline safety tests, including actual dispatch guards, limits 1/3, malformed limits, endpoint rejection and no-dispatch behavior. |
| `test-support/authenticated-terminal.py --first-use` | Accepted native provider workflow: empty ledger, rendered zero, normal recording/refresh, token/dollar views, switching invariance, restoration and sustained cleanup. Requires separate explicit provider authorization; not an automatic rerun command. |

## Verification result

**PASS:** integrated candidate `abc25236cd1f1532704654b7881ed1d05052a977`, recorded in `a1c007f4cb015ad917ef695ad7ad22e3018a33d0`. Assertion status **PASS**; cleanup status **PASS independently**. No application correction remains.

| Check | Result and retained evidence under ignored `node_modules/.cache/` |
| --- | --- |
| Controlled Linux | 383 tests / 3,723 assertions; frozen install, adapter, summary, display, full suite, types, lint, build and format exit 0. Runner and cleanup exit 0. Bundle `cmon-linux/cmon-linux-b96587faea12457bb8b024ed4254287c`. |
| Offline Windows safety | 18 tests PASS; no runtime or provider invocation. |
| Credential-free real host | 45 assertions PASS: complete zero real RPC, intact controls in measured 37-cell sidebar, shared footer, genuine source-triggered candidate replacement, retained Tokens/open state and collapse/reopen. Executed public-module observer path; cleanup separately PASS. Bundle `cmon-host/cmon-host-318bc1d75808471491dee47fa285c215`. |
| Retained restart/RPC compatibility | 30 assertions PASS, reused for unchanged bodies, not rerun or counted as new: restart restores dollars/durable open state; legacy, NULL, zero and partial fixtures traverse real RPC/consumer. Bundle `cmon-host/cmon-host-0df353b0cc1b4ab59def3d6cae9e833f`. |
| Accepted provider workflow | 30 assertions PASS, retained rather than rerun: one normal nine-token recording/refresh through real RPC and both rendered unit views; unchanged settled rows, metadata, revision and dollar summary after switching. Bundle `cmon-auth/run-b8e92ba88875437e82a33ba99d246b3a`. |

The provider run recorded input 7 + output 2, with reasoning/cache-read/cache-write zero; ledger, complete RPC revision 1 and both token views agree on 9. Stored cost is 2 microdollars, rendered `$0.00`; this is runtime accounting, not an independent provider invoice. Original breakdown/open/sidebar/unit preferences were restored. Cumulative retained usage is two requests, USD 0.02 reserved and USD 0.000004 recorded; final integrated verification made zero new requests.

Cleanup receipts establish both new containers absent, invocation image tags removed and empty fixture inventory. Retained native `job.json` and `cleanup.json` establish empty Job Object membership and 30 seconds without residual process or ledger/counter/lifecycle writes. Shared resources and ordinary accounting were not removed.

### Provenance and evidence reuse

- Candidate production is byte-identical to `9a55b54b0db1ea9546811aed55da1a54c95baf89`. Server SHA256 `1fcb37595b2a81ca1d45bc1f9a5e99776ff9b88d3cdb19281525b4cc8caa5f6c`, TUI `643163b107ea1226cf1bb5236b067b724f887d791a1de6d59bd30e6fea40cbbe`, lock `489dcc606351dfc3cf56620b81f1ab15d090fd340ed5acd11e5f001d499c6184` match controlled export and retained native build.
- Candidate `src/` tree: `7bf9e0ff21f70a2aa53e714c6a8907ae0821114b`; operations tree: `df58bf22c082ecdf0290e8f0169b0be9af62414a`. Controlled image: `sha256:9d3bb1b7b2a6bf716e68bd88c47afad1b09493ee2f0cc621763381ecb7ee140c`.
- Executed Docker observer SHA256: `f00041bd059a3897e0da156f67956428fcd8bb7705d62ab1d1bc03492ceb9eb8`. Native driver SHA256: `19a880cd0faa748aa9fc9cfd203909ecdddf60106ac744bdf8073f948118cc63`, matching retained `ready.json` and current source.
- Retained executed adapter SHA256 `0e45eba7edb36dae68d8f40a487741978d5aee9259b2b3f40eb71c98a5b744c1`; candidate adapter `e487526cb043d3671efcf86b65cc80299e793ef4702917c18875942b541e26da`. Exact comparison establishes only standard `URL`/`Buffer` imports and `globalThis.Request` binding changed; runtime identity checks establish equivalent constructors. Guard/security/reservation/counter/dispatch bodies are byte-identical. The 18 offline tests support equivalence-based reuse, not a new provider execution.
- Key native artifacts: `ready.json`, `assertions.json`, `first-use.json`, completed-message/RPC snapshots, rendered token/dollar frames, restoration receipts, `job.json` and `cleanup.json`. Host bundles retain input hashes, image identities, candidate generations, frames, RPC snapshots and separate command/cleanup receipts.

### Commands and limits

Executed integrated checks:

```powershell
pwsh -NoProfile -NonInteractive -File docs/operations/verify-linux.ps1 -Revision abc25236cd1f1532704654b7881ed1d05052a977 -Verify
python -B src/test-support/authenticated-terminal.test.py
```

Retained host procedure: `docs/operations/prepare-host.ps1 -Revision 6aa9af926d14ed363056105db6231b42f27ec5ef -Driver src/test-support/host-terminal.py`. Docker procedures own finite startup, deadlines and teardown. Offline safety tests have a 30-second outer bound. The accepted native workflow used a 480-second outer bound, 300-second owned Job Object, bounded UI waits and 30-second cleanup stability check.

Portable checks use `bun run test` (required timezone/browser conditions), focused token suites before the full suite, then `bunx --no-install tsc --noEmit`, `bun run lint`, `bun run build` and formatting. Frozen installation uses `bun install --frozen-lockfile --ignore-scripts`. Bound test/static/format commands to 120 seconds and install/build to 180 seconds; preserve assertion and cleanup exits separately.

## Scope of proof

Rendered controls and normal provider recording establish the useful token-switching workflow under the **explicitly accepted existing opaque authentication, Windows OpenCode 2.1.4, empty isolated ledger and absent import source variant**. No staging exists for these local boundaries. Network-disabled Linux OpenCode 2.0.24 supplies credential-free host proof only.

Nested 45/40/22 renderer geometry is fixture proof, not a claim that the real host allocated those widths; its measured sidebar is 37 cells. Compatibility fixtures and synthetic events are not provider recording. Breakdown may return to Agents after full sidebar reconstruction; ordinary refresh, unit switching and collapse/reopen retain its selection. Session unit survives plugin replacement, not process exit.

**Uncovered:** new-authentication onboarding, an entirely empty global installation, provider execution on Linux 2.0.24, keyboard/screen-reader behavior, deployment and release execution. These are not passed or newly imposed prerequisites for the accepted variant.

## Finalization and retention

At finalization, HEAD is `a1c007f4cb015ad917ef695ad7ad22e3018a33d0`; the delta from verified `abc2523` is documentation-only: this record, active proposal/design/UX/behavior documents and the live capability specification. Local target `main` remains `ae05f0b69bacb0547a49873e8efd27f286b40a96`, matching the target pinned during verification. No code, test, dependency, configuration or target change follows the candidate in this checked state. Concurrent baseline specification reconciliation is documentation-only; its approval and the archive move are not asserted as executed by this record.

Worktree lifecycle: path `.worktree/toggle-token-display`; branch/change `toggle-token-display`; owner test engineering; status feature-verified, retained, unmerged; next action authorized documentation finalization and verified landing. Cleanup evidence covers disposable test resources only; worktree/branch removal awaits landing. Landing and removal receipts belong outside the archived change.

This record is content-complete for exact archival. No in-folder evidence or checkbox backfill remains after the move; subsequent completion evidence belongs in live records outside the archive.
