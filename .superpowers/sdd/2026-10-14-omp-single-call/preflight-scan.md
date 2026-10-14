# Pre-execution conflict scan: omp single call, Tasks 1-12

Who: read-only scan subagent, session 02f047f6, 2026-10-14. Scope: plan
`docs/superpowers/plans/2026-10-14-omp-single-call.md` (Tasks 1-12; Task 0 done, Task 13 skipped) against the spec
`docs/superpowers/specs/2026-10-14-omp-single-call-design.md` (with its §7) and the current trees:
- ccloop worktree `ccloop-wt/omp-single-call` at `7909637` (= `1cefda2` + one docs-only commit; `git diff 1cefda2 --stat`
  shows only `docs/handoff/handoff.md`, so every ccloop src/tests line the plan cites still applies).
- Orca worktree `Orca-wt/omp-single-call` at `90c7cb7c`; `git diff 13db3241 --stat -- src tests` is empty.

Every file:line below was read with `cat -n` / `awk NR` against these heads. No file other than this one was written.

Totals: **0 blocker, 3 important, 8 minor.**

## 1. Per-task self-consistency

| Task | Self-consistent? | Notes |
|---|---|---|
| 1 ccloop catalog rows | Yes | Test, code and interface agree. `readOmpModels` keeps `string[]`, and its callers (`materialize.ts:5,115`, the detect/updates criteria) keep working. The red prediction (`is not a function`) holds. |
| 2 ccloop resolution decides | Yes for code. Red predictions are wrong (m1) | The descriptor, registry, materialize, command and accept edits typecheck as written. `command.ts:233` still uses `getDescriptor`, so its import stays. After the edit `accept.ts:94` still uses `config`. The tests use only exports that exist: `runControlCommand`, `writeAgentsTable`, `singleCallEnvelope` (`tests/control/agentsFixture.ts:51,125`), `acceptStart`'s binding fields (`src/control/accept.ts:40-45`) and `tests/fixtures/control-worker.mjs`. |
| 3 ccloop extract runOmpProcess | Yes | The replacement covers `runOmpPhase.ts:14-123` exactly. The registration's `phase: string` matches `AttemptContext.onProcessRegistered` (`src/runtime/types.ts:15-20`). |
| 4 ccloop spawn check, argv, overlay | Yes | The fake's new branch needs `existsSync`, which Task 2 Step 1 adds to `fake-omp.mjs:10`. The insertion point (`fake-omp.mjs:29`) is right. The overlay matches spec §7 byte for byte. The argv in the code matches the Global Constraints, spec §3.3.2 and the C4 test. |
| 5 ccloop decode, adapter | Yes for code. M7 red shape is off (I3) | The rewritten import list is a superset of Task 4's. `assistantUsage` is at `ompProtocol.ts:12`. `SingleCallOutputInvalid` and `observedTokensOf` match `types.ts:174-207`. `errorCodeOf` reads `.code` first (`src/control/singleCall.ts:52-56`), so the stop code and `OmpSingleCallRefused.code` reach the record. The worker test follows `tests/control/singleCall.test.ts:35-55`. `singleCallEnvelope` has `maxOutputTokens: 4096` (`agentsFixture.ts:142`), which matches `world(4096)` / `world(8192)`. |
| 6 ccloop mutations | Every `from` anchor occurs exactly the stated number of times in the code Tasks 1-5 write | `M1a` count 3 is right (`(config, row)` x3). `M3`, `M4a`-`M4e`, `M5a`-`M5c`, `M6a`/`M6b` and `M7` each occur once. One red shape is wrong (I3), and the notation is inconsistent (m5). |
| 7 Orca schema/type | Yes | `ccloopPort.ts:43-45` and `agentSelection.ts:34-37` match. `safeInteger` = nonnegative int ≤ MAX_SAFE (`src/control/schema.ts:3`), so `.positive()` refuses 0. The port strips only `protocol`/`usageBreakdown` (`ccloopPort.ts:158`), so the field passes through. |
| 8 Orca estimate bound | Yes. The envelope half of criterion 8 is not exercised (I1) | `ObservedProfile.resolution: AgentResolution \| null` (`profiles.ts:30`) fits the `Pick<…> \| null` parameter. The contract schema puts no ceiling on `maxOutputTokens` (`webProtocol.ts:409-422`). `writeCanonicalRecord` is idempotent (`snapshot.ts:91`), so re-persisting the same requestHash is safe. The fixture window is 1 000 000 and strict-compatible (`tests/control/fixtures/web.ts:23-25`). |
| 9 Orca clarify/split | Yes | It follows the existing `requirementCommands.test.ts:36-44` pattern exactly. `slot.observation.resolution` exists (`planImport.ts:42`). `requirementCalls.ts:246` reads `group.requirement.maxOutputTokens`. |
| 10 Orca mutations | Anchors match the Task 7-9 code | The `M8`, `M9` (line 112 unchanged), `M10` and `Mopen` `from` strings each occur once. |
| 11 repin | Yes | It runs after Task 7, so the Orca schema accepts ccloop's new `singleCallOutputCap: null` before the repin lands. |
| 12 gates | Yes | Every script it names exists: ccloop `scripts/check-known-reds.mjs`, `check-tmp-leak.mjs`, `verify:control`; Orca `verify:{control,scheduler,chain,ccloop-pin,panel}`, `check-claude-md-lines.mjs`, `check-hooks-path.mjs`, `check-tmp-leak.mjs`, `web` workspace `check`. So does every test file on the targeted lists. |

## 2. Cross-task interfaces

| Producer → consumer | Interface | Match? |
|---|---|---|
| T1 → T2 | `CatalogRowV1`, `readOmpCatalog`, `readOmpModels`, `ompSingleCallExecution(row \| undefined)` | Yes |
| T1 → T4 | `readOmpCatalog`, `ompSingleCallExecution` | Yes |
| T2 → T4/T5 (fixture) | `fake-omp.mjs` line-10 import (`existsSync`, `readFileSync`), `<marker>.catalog.json` | Yes. The default row stays `contextWindow 200000, maxTokens 8192` (`fake-omp.mjs:18`). |
| T2 → T6 | `materialize.ts` `(config, row)` x3; `ompModels.ts` openrouter expression; `command.ts` cap line (6-space indent, matching `command.ts:97`); `accept.ts` `resolution.singleCallExecution === null` | Yes |
| T3 → T4 | `runOmpProcess(config, OmpProcessInput)`, `OmpPhaseOutcome` | Yes, every field is supplied |
| T4 → T5 | `ompSingleCall.ts` module (T5 rewrites the imports and appends), `ompSingleCall.test.ts` (T5 appends and reuses `ompWorld`/`failureOf`) | Yes, no name collisions |
| T5 → T6 | decode anchors (`M5*`, `M6*`, `M7`) | Anchors match. M7 red shape: I3 |
| T2 (ccloop wire) → T7 (Orca schema) | ccloop `z.number().int().positive().max(MAX_SAFE).nullable().optional()` against Orca `safeInteger.positive().nullable().optional()` | Equivalent |
| T7 → T8 | `AgentResolution.singleCallOutputCap?: number \| null` | Yes (`Pick` of an optional field accepts `{}`) |
| T7 ↔ T8 (shared test file) | T8 appends to `singleCallOutputCap.test.ts` with its own imports | Yes |
| T8 → T9 | `singleCallOutputBound` | Yes |
| T7-T9 → T10 | `M8`/`M9`/`M10`/`Mopen` anchors | Yes |
| T6 → T10 | `mutate.mjs`, `mut.sh` reused; log names distinct | Yes |
| T10 → T12 | `/private/tmp/osc/ccl-build` reuse rule | Yes |

## 3. "Before" anchors against the current files

All checked, and **all still match verbatim**:
- ccloop: `types.ts:32,39-45,186-196,198-207,230`; `ompModels.ts:2,50-64`; `registry.ts:9-12,34,40`; `omp.ts:4,30-41`;
  `claude.ts:74-76`; `codex.ts:54-56`; `materialize.ts:5,7-14,87-128`; `command.ts:89-99,97,252-255`; `accept.ts:6,86-90`;
  `fake-omp.mjs:10,17-21,29`; `runOmpPhase.ts:14-123`; `ompProtocol.ts:12`; `ompAdapter.ts:5,8,64`; `singleCall.ts:52-56,64-65`.
- Orca: `ccloopPort.ts:43-45`; `agentSelection.ts:34-37`; `estimator.ts:11,56,74-115,107-111,112`; `singleCallPurposes.ts:49`;
  `requirementCommands.ts:8,97`; `requirementRecords.ts:24`; `planImport.ts:42`; `requirementCalls.ts:246`.

Caveat (m2): several steps make an insertion and then quote a later line number in the same file. The quoted numbers are
correct at the base commit but shift once the earlier edit is applied.

## 4. Plan against the spec and its own Global Constraints

- No mandate contradicts the spec's rulings.
- There are small deviations: the decode bullet in the Global Constraints (m3), and how usage is booked for an
  unparseable line or a never-started process (m4).
- The spec §5 criteria 1-10 each map to a test and a named mutation, but Rule 9 coverage is incomplete (I2).

## 5. Existing tests rewritten?

**None.** Every task that modifies a `tests/` path modifies one of three kinds of file:
- a new file it creates itself: `ompCatalog`, `ompSingleCallResolution`, `ompSingleCallAccept`, `ompSingleCall`,
  `ompSingleCallWorker`, `singleCallOutputCap`, `requirementOutputBound`;
- a file an earlier task of this plan created: T5 extends T4's file, T8 extends T7's;
- `tests/fixtures/fake-omp.mjs` (m6).

The plan's list of existing criteria that stay green holds on reading. Specifically:
- `singleCallCapability.test.ts:48-60` spreads `resolveAgent`'s own resolution.
- `materialize.test.ts:72-77`, `agentsControl.test.ts` and `command.test.ts` use `toMatchObject`.
- `ompSelection.test.ts:50,82` inject `probeModels`.
- `ompSelection.test.ts:91-104` reads a real-shaped row.
- Orca's `fake-ccloop-control.mjs:48` emits no cap.

## Findings

### I1 — important — Task 8 (plan lines 1878, 1895-1904): criterion 8's envelope half is not exercised
- **What is wrong:** Spec §5 criterion 8 says the cap "is written as the contract/envelope `maxOutputTokens`". The C8 test asserts `raised.contract.maxOutputTokens` and then reads the same value back through `persistEstimateArtifacts`/`readEstimateContract`. That read-back is a production round trip of a value the previous line already asserted. The envelope is built in `ESTIMATE.prepare` (`src/control/singleCallPurposes.ts:41-50`, line 49 `maxOutputTokens: contract.maxOutputTokens`), and no new test calls it. A regression there (for example, sending `preflight.maxOutputTokens`) would stay green, and ccloop's spawn check would then refuse every omp estimate whose cap is above the preflight value.
- **Evidence:** `singleCallPurposes.ts:49`; plan line 1901 (comment "the single-call envelope takes contract.maxOutputTokens") is an assertion by comment only.
- **Proposed resolution:** In the C8 test, call `ESTIMATE.prepare({ store: h.store, … }, { groupId: "g", estimateId: "estimate-cap", … })` after persisting a matching estimate record, or assert on the `accept` envelope in a driver-level world. Add a Task 10 mutation `Menv`: `singleCallPurposes.ts` `contract.maxOutputTokens` → the profile's preflight value, which must go red.

### I2 — important — Tasks 6 and 10 (plan lines 1742-1764, 2092-2098): branches added without a named, seen-red mutation (Orca Rule 9 item 1)
- **What is wrong:** Orca CLAUDE.md Rule 9 says every new branch needs a mutation of itself that is seen red. Task 10 covers M8/M9/M10/Mopen. The C10 refusal branch (0 / negative / fraction / unsafe) has no mutation of its own. Plan line 1822 even says that test "may be green already … not claimed here". On the ccloop side, Task 6 names no mutation for these:
  - the `positiveSafe` filter (Task 1, Review Focus 1);
  - the `omp-single-call-unavailable` branch (row lost cap / model gone / catalog unreadable; Review Focus 2);
  - the non-completed outcome booking null (Review Focus 3);
  - `Math.min(request.timeoutMs, installation.timeoutMs)` (Review Focus 4);
  - the `/^[A-Za-z]{1,32}$/` bound (Review Focus 5);
  - the omp `contextWindowTokens: row?.contextWindow ?? null` alone (M1a mutates all three at once).
- **Evidence:** plan lines 44-48 (Review Focus pins), 1744-1763 (Task 6 list), 1822, 2096.
- **Proposed resolution:** Add to Task 10 `M10b` (`safeInteger.positive()` → `safeInteger`, red on "C10: refuses…"). Add to Task 6:
  - `M1d` (`positiveSafe` → identity on numbers);
  - `M4f` (drop `row.maxTokens === null ||`, or the `row === undefined` clause);
  - `M5d` (`outcome.reason !== "completed"` path → decode anyway);
  - `M5e` (`Math.min(...)` → `config.installation.timeoutMs`);
  - `M5f` (regex → `.+`).

  These are reversible plan edits. Whether ccloop-side branches fall under Orca Rule 9 (Orca Rule 16 says Orca's rules do not spill into ccloop) is for the controller to decide; the Orca-side `M10b` gap is unambiguous.

### I3 — important — Task 6 Step 10 (plan line 1763) with Task 5 test (plan lines 1402-1407): M7's second red is a TypeError, not the named assertion
- **What is wrong:** Under M7, `parseSingleCallObject("[…]")` returns the array, so `decodeOmpSingleCall` succeeds and `decodeFailure` returns `null`. The test then evaluates `(failure as { tokenUsage?: unknown }).tokenUsage` on `null` and throws `TypeError: Cannot read properties of null` before `toEqual` runs. The plan's expected red is `[text, false, undefined]`. Task 6's rule (plan line 1742) is "red on the named assertion, not a load error or crash", so an executor following it would classify this as a crash and take the "missing criterion" branch (plan line 1764).
- **Evidence:** plan lines 1336 (`decodeFailure` returns `null` on success), 1405, 1763.
- **Proposed resolution:** Write the test line as `(failure as { tokenUsage?: unknown } | null)?.tokenUsage`, or expect `[text, false, undefined]` with optional chaining. The first C7 test already reds properly on the assertion.

### m1 — minor — Task 2 Step 4 (plan line 697): red predictions do not match what the pre-implementation tree does
- **What is wrong:** Before Task 2, `resolveAgent` ignores `probeCatalog` and calls the real `readOmpModels` on `command: ["/opt/omp"]`, which cannot spawn. So:
  - every `resolveAgent(table, …, deps)` C1 test rejects with `omp-model-catalog-unavailable`, not `[null, undefined, undefined]`;
  - "still refuses a model the catalog does not list" is **red**, with an uncoded Error, not "may already be green";
  - C2 refusal is red at `expect(resolution.singleCallExecution).toBeNull()`, because the field is `undefined` today;
  - C2 admission is red at `.toBe("v1")` before it ever reaches accept.
- **Evidence:** `src/agents/materialize.ts:90,115` (deps type lacks `probeCatalog`; `deps.probeModels ?? readOmpModels`); `src/agents/ompModels.ts:42` (spawn error → `omp-model-catalog-unavailable`); `types.ts:39-45` (no `singleCallExecution` field).
- **Proposed resolution:** Correct the expected-red text so the executor does not mistake a correct red for a surprise.

### m2 — minor — Tasks 2, 8, 9 (plan lines 717-724, 753, 772, 850, 1938-1950, 2039): line numbers quoted after an earlier insertion in the same step
- **What is wrong:** The plan quotes line numbers that an earlier edit in the same step has already moved:
  - `registry.ts` adds an import line, then cites "line 34" and "line 40" (now 35 and 41);
  - `omp.ts` "add import after line 4" makes "replace lines 30-41" lines 31-42;
  - `materialize.ts` gets a type-import line, so `resolveAgent` moves from 87-128 to 88-129;
  - `accept.ts` deletes line 6, so "86-90" becomes 85-89;
  - `estimator.ts` gets an import after line 11 and a function before line 56, so "107-111" moves by about 9 lines;
  - `requirementCommands.ts` gets an import after line 8, so 97 becomes 98.
- **Evidence:** base lines verified in §3 above.
- **Proposed resolution:** Apply each edit by its quoted text (every anchor is unique), not by line number, or apply bottom-up.

### m3 — minor — Global Constraints (plan line 22): the decode bullet is narrower than the spec, the Interpretations and the code
- **What is wrong:** The bullet says "no `tool_execution_*` event (`omp-phase-tool-forbidden`)". Spec §3.3.5, the plan's Interpretations (line 58) and Task 5's code (line 1588) also refuse `extension_ui_request` and any `*subagent*` type.
- **Evidence:** spec line 72-74; plan line 22 against lines 58 and 1588.
- **Proposed resolution:** Extend the bullet to match. There is no code change.

### m4 — minor — Interpretations (plan line 56) and Task 5 (plan lines 1586, 1626) against spec §3.3.5/§3.3.7: usage booking edge cases
- **What is wrong:** There are two edge cases.
  1. `omp-events-invalid` is thrown on the first unparseable line even when a complete assistant `message_end` with valid usage exists elsewhere. The spec says "fail closed; observed usage still booked", so the Interpretation's reason ("there is no observed total") is not always true.
  2. The non-completed path throws with `neverStarted: outcome.neverStarted`, so an abort before spawn, `timeoutMs <= 0` or a spawn error books **0**. Spec §3.3.7 says abort and timeout book null. This matches the existing `observedTokensOf` ERRATUM (`src/runtime/types.ts:169-175`) and the phase adapter (`ompAdapter.ts:32`), so it is defensible, but it is not recorded as an interpretation.
- **Proposed resolution:** Record both as interpretations, or, for (1), skip unparseable lines only after the usage pass. Neither is a correctness blocker.

### m5 — minor — Task 6 Steps 7-10, Task 10 Step 3 (plan lines 1749-1763, 2095): `-t` notation
- **What is wrong:** `mut.sh` takes the pattern as positional argument 6 and adds `-t` itself (plan lines 1718-1726). The steps write `tests/... -t "C4"`, and passed literally that would make `-t` the pattern.
- **Proposed resolution:** Write the call form explicitly, e.g. `mut.sh <clone> M4a <file> <spec> tests/runtime/omp/ompSingleCall.test.ts C4`.

### m6 — minor — Tasks 2 and 4 (plan lines 507, 519-536, 1073, 1085-1102): a shared fixture used by existing criteria is modified
- **What is wrong:** `tests/fixtures/fake-omp.mjs` is used by `tests/control/ompSkillsDir.test.ts` (ccloop) and, through `ORCA_CCLOOP_BIN`, by Orca's `tests/control/ompSkillsE2E.test.ts:48,60`. The plan treats it as "fixture, not a criterion". Its default catalog row and phase branch are byte-identical in behaviour, so no existing assertion moves. It is still the one place where an existing criterion's inputs are edited, which ccloop Rule 15's spirit asks to surface.
- **Evidence:** `fake-omp.mjs:10,17-21,29-40`; `grep -rln fake-omp tests` → `tests/control/ompSkillsDir.test.ts` only (ccloop).
- **Proposed resolution:** Keep as planned, and name it in the checkpoint's "fixtures touched" line.

### m7 — minor — Task 2 (plan line 78 list): published doc comments whose meaning drifts are not listed
- **What is wrong:** `src/agents/registry.ts:35-39` (the `singleCallExecution` doc: "'v1' when this kind can run …"; it is now per catalog row for omp) and the `capabilities` signature doc are not in the plan's "Code comments whose meaning drifts" list. The list names only `types.ts:230` and `requirementRecords.ts:24`.
- **Proposed resolution:** Add `registry.ts:35-39` to the list, and give it an appended ERRATUM in Task 2 (ccloop Rule 16).

### m8 — minor — Task 7 Step 2 (plan line 1822) and Task 8 Step 2 (plan line 1936): tests the plan concedes may be "green today" carry no red of their own
- **What is wrong:** "C10: refuses…" and "C8: no cap…" are each acknowledged green before the implementation, and neither has a Task 10 mutation that reds it (C8 "no cap" pins non-movement, which M8 cannot red by construction). That is acceptable for a pin of non-movement, but per Orca Rule 9 item 1 neither is yet a criterion.
- **Proposed resolution:** C10-refuses is covered by I2's `M10b`. For C8-no-cap, add a mutation `Mfloor` (`?? 0` → `?? 1_000_000`) that must red it.
