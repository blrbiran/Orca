# Pre-flight conflict scan -- every-agent requirement chain plan

Who: read-only pre-flight reviewer subagent of Orca session a852f96a (Claude Opus 5.5). When: 2026-10-15 Asia/Shanghai.
Read on: Orca `main` 948ef694 (plan + spec), ccloop `main` 1e05627. Nothing was run except greps and file reads; every
"would go red/green" below is predicted by reading, not measured. Human decisions taken as binding: spec issue 8 (the
version is cached), E1-E6 approved, Task 0 runs.

Severity: **blocking** = the plan as written cannot reach its own stated green, or it breaks a rule; **should-rule** = a
controller/human ruling is needed before that task starts; **note** = record it, no ruling needed.

## A. Cross-task pairs (shared file or interface)

| # | Tasks | Producer -> consumer | Finding | Sev | Suggested ruling |
|---|---|---|---|---|---|
| P1 | T1 -> T3 | fakes: codex `<marker>.catalog.json {rows,sleepMs,exitCode,stderr}`; omp `<marker>.models.json {hang,sleepMs,exitCode,stderr}`, `<marker>.models.pid` | agree (fake-omp.mjs:21-28 already has `models.json`/`hang`; T1 adds `sleepMs` and the pid) | note | -- |
| P2 | T1 -> T4 | `<marker>.catalog-calls` / `.version-calls` counts; `[2,4]` | agree: codexInstallation probes `--version` once (agentsFixture.ts:28-41) + version + debug-models + features-list = 4; omp version + models = 2 | note | -- |
| P3 | T1 -> T5 | omp rows file | agree: T5 writes `<ompMarker>.catalog.json` (rows), which is the existing rows file (fake-omp.mjs:29); `.models.json` is the script file | note | -- |
| P4 | T1 -> T8 | both edit `tests/fixtures/fake-codex.mjs` | agree: T1 inserts before the argv append (line 11) and adds `existsSync`; T8 inserts at the top of the stdin `end` handler (line 18) and adds `lstatSync` | note | -- |
| P5 | T2 -> T4 | `catalogKey`, `readCatalogEntry(dir,key,now)`, `writeCatalogEntry(dir,entry)`, `CatalogEntryV1{version,rows,codexFeatures}` | agree | note | -- |
| P6 | T2 -> T3/T5 | `CatalogRowV1.listed?` | agree: T3 sets it for codex, T5 filters on `listed === true` | note | -- |
| P7 | T3 -> T4 | `readOmpCatalog(i,{deadline,signal})`, `readCodexCatalog(i,{deadline,signal})`, `probeVersion(cmd,{timeoutMs,signal})`, `PROBE_CAP_MS`, `probeTimeoutMs` | agree | note | -- |
| P8 | T3 -> T8 | `CODEX_SINGLE_CALL_FEATURES` order | agree with C8.2's `-c features.*` literal order | note | -- |
| P9 | T0 -> T8 | Task 0 final `ISO` -> `CODEX_SINGLE_CALL_CONFIG` | conflict-risk: T8 says "copy the final ISO list" into the constant, but C8.2 hard-codes the 5 non-feature keys; an override found in Task 0 Step 4 makes C8.2 red with no instruction to update it | should-rule | C8.2's expected list is derived from Task 0's recorded list (literal, re-written from the ledger), stated in T8 Step 2 |
| P10 | T4 -> T6 | `resolveAgent` local `catalog`, `row`; T4 test "accept for omp" | agree on code; text conflict: T4 comment "codex joins this loop in Task 6" vs T6 "a new `it` beside" | note | T6 wording wins (new `it`); fix the T4 comment when written |
| P11 | T4 (cache) x T6 (test) | T6 test 3: first `resolveAgent(...,"not-in-catalog")` writes a cache entry; then `<marker>.catalog.json {exitCode:3}`; the key does not stamp `.catalog.json` (not in argv, `codex-marker` file does not exist yet) | **conflict**: second resolution is a cache hit -> `[272000,"v1-soft"]`, test expects `[null,null]`; cannot go green | **blocking** | split the unreadable-catalog half into its own `it` with a fresh `table()` (or `readAgentCatalog(...,{refresh:true})` first); keep the literal |
| P12 | T4/T8 -> every importer | `agentCatalog.ts` imports `probeVersion` from `materialize.ts`, which imports `registry.ts` (top-level `DESCRIPTORS=[claudeDescriptor,codexDescriptor,ompDescriptor]`, registry.ts:60); T4 makes `ompSingleCall` import agentCatalog, T8 makes `codexAdapter` import it | **conflict (import cycle -> TDZ)**: entry via `omp.ts` (omp.ts -> ompAdapter -> ompSingleCall -> agentCatalog -> materialize -> registry -> omp.ts mid-evaluation) throws `Cannot access 'ompDescriptor' before initialization`; same for `codex.ts` after T8. Entry points that hit it: tests/runtime/omp/ompPhase.test.ts:4, tests/runtime/codex/extraEnv.test.ts:4, tests/agents/registry.test.ts:3, ompSingleCallResolution.test.ts:6, T8's own codexSingleCall.test.ts (imports codex.js first) | **blocking** (predicted; confirm with ompPhase.test.ts after T4) | move `probeVersion` (+ `VERSION_*`) to a leaf module (e.g. `src/agents/versionProbe.ts`, re-exported from materialize.ts for existing importers); agentCatalog imports the leaf only |
| P13 | T5 -> T13 | `ccloop-models-v1` wire | agree: Orca `agentModelsSchema` matches ccloop `modelsSchema` field for field (observedAt datetime\|null, enum `v1`/`v1-soft`, strict rows) | note | -- |
| P14 | T13 -> T14 | route `/api/control/agents/:installation/models[?refresh=1]`, `orca-agent-models-v1`, 424 `ccloop-failed:<code>: <detail>` | agree: App strips `ccloop-failed:` and uses `codeAndDetail` (web/src/ccloopCodes.ts:34) | note | -- |
| P15 | T5 -> T14 | claude answers `source:"none"` | agree: App loads models only for omp/codex | note | -- |
| P16 | T6 -> T11 | wire enum `"v1-soft"` (ccloop command.ts:97 / Orca ccloopPort.ts:47) | agree on the value; order conflict = P17 | note | -- |
| P17 | T10 x T11 (spec §8.2) | T10 Step 6 sweeps `tests/control tests/panel` with `ORCA_CCLOOP_BIN` = the new ccloop main; Orca's `agentResolutionSchema` still has `singleCallExecution:z.enum(["v1"])` until T11 | **conflict**: every real-ccloop codex resolution now answers `"v1-soft"` and is refused by the strict Orca schema (webCcloopSmoke `port.resolveAgent({agent:"codex"})`, ccloopWorld worlds whose default agent is codex). "Expected newly red: E6 only" is false; E6's window rewrite cannot make it green before T11 | **blocking** | move T11 Step 3's `ccloopPort.ts:47` enum + `agentSelection.ts:36` type into T10 before the sweep (or run the sweep after T11); re-predict the red list |
| P18 | T6 -> T7 | both rewrite C1 in singleCallCapability.test.ts (line 59 codex half, then line 53 claude half) | agree; sequential | note | -- |
| P19 | T10 -> T11 | R7 needed by codexRequirementOpen (world profile declares null, ccloopWorld.ts:159-160) | agree: T10 before T11 is the right order for R7 | note | -- |
| P20 | T11 -> T16 | codexRequirementOpen / ccloopModels / webCcloopSmoke must be passed, not skipped | agree on intent; mechanics conflict = T16 row | note | -- |
| P21 | T12 x T14 | both edit en.ts, zh.ts, controlTypes.ts | agree: disjoint keys (`control.outputBound` vs `agents.models`; `RunViewV1` vs `AgentModelsViewV1`) | note | -- |
| P22 | T12 x T13 | both edit webProtocol.ts | agree: `runViewSchema` (~1243-1316) vs `agentModelsViewSchema` after `agentsViewSchema` (1763) | note | -- |
| P23 | T0 x T9 x T10 | ledger path and committing task | conflict: plan names `.superpowers/sdd/2026-10-15-every-agent-chain/` (T0, T9, T10 Step 8) vs the ruled dir `...-every-agent-requirement-chain/`; T0 says "Task 9 commits", T9 says "Task 10's first commit", T10 Step 8 commits | note (already ruled in progress.md) | follow the ledger ruling; T10 Step 8 commits from the ruled dir |
| P24 | T4 / T10 | `CCLOOP_CACHE_DIR` setup files | agree: Orca's ccloop port uses `execFile` without `env` (ccloopPort.ts:155) so process.env reaches ccloop | note | -- |
| P25 | T10 -> T15 | `$OR/node_modules` is a symlink to the main Orca tree (T10 Step 1); T15 runs `scripts/pin-ccloop.mjs`, whose line 38 runs `npm install ccloop@<sha>` | conflict: the install writes through (or replaces) the main tree's node_modules -- outside the branch, possibly what the human's panel runs from (Rule 3/13) | should-rule | before T15, give `$OR` a real `node_modules` (`npm ci` in `$OR`), or run the pin in a clone and carry only package.json/lock |
| P26 | T3 -> existing C58a-c | message `<code>: <reason> · stage <s> · elapsedMs <n>[ · stderr: <tail>]` | agree with ompCatalogDiagnostics.test.ts:34 (startsWith), :41 (`timeout 300ms` first), :48-56 (tail last) | note | -- |
| P27 | T8 -> ccloop worker -> Orca | error code `codex-single-call-not-single:tool` | agree: worker's `errorCodeOf` takes `error.code` (src/control/singleCall.ts:51-55); Orca cuts at the colon (executionDriver.ts:670-674); T14 locale keys the cut code | note | -- |
| P28 | T8 x runCodexPhase | `runDir/codex/1/single-call` used by both evidence (`call-*`) and private homes (`home-*`) | agree: both `mkdir {recursive}` then `mkdtemp` | note | -- |

## B. Per-task self-consistency

| # | Task | Finding | Sev | Suggested ruling |
|---|---|---|---|---|
| T0 | Codex isolation research | consistent; output dir name per P23 | note | -- |
| T1 | fake catalog answers | consistent: flag list, rows, counts and red reason match the fixture code | note | -- |
| T2 | cache file | 17 tests counted = 17 stated. **Mutation predictions wrong**: M2.2 (profile), M2.3 (configDir), M2.4 (inherited dir) leave the key different because `configFilesOf` puts those values into `configFiles[].path`; M2.1 is predicted red in "the binary's realpath" but `command` already differs. "the binary's size" also changes the mtime, so it cannot fail when `size` alone is dropped from the stamp (Rule 9: a criterion seen only green) | should-rule | either record these fields as carried redundantly by `configFiles` paths / `command` (and drop the four per-field claims), or rebuild the tests so only that field differs (size: restore the original mtime with `utimes` after the rewrite) |
| T3 | bounded probe | consistent; `probeFailure` is exported and used by codexCatalog but missing from Interfaces; `positiveSafe` copied verbatim from ompModels.ts:79 (a reviewer will call it duplicated) | note | export one `positiveSafe` from catalogProbe.ts or types.ts |
| T4 | one reader | P12 (blocking). Spec issue 3 promises `ccloop-agent-catalog:` lines from "the control worker", but no task passes `log` to the `readAgentCatalog` calls in ompSingleCall/codexAdapter/worker | should-rule | either wire `log` in the worker's calls (stderr goes to its log) or strike that clause from issue 3 |
| T5 | control models | test "prints the same answer from `ccloop agents models`, and logs a miss on stderr" asserts nothing about stderr (the log goes to `process.stderr`, not the result) -- title claims more than the body checks. Red expectation "every test `control-command-invalid`" is wrong for the CLI test (`agents-command-invalid`). M5.3's reason is wrong (claude would throw "no rows"; still red) | should-rule | drop "logs a miss" from the title, or inject `log` and assert the miss line |
| T6 | codex v1-soft | P11 (blocking). Files list omits `src/agents/materialize.ts` and `tests/agents/agentCatalog.test.ts`, which Step 3 edits; P-4 stages exact paths | should-rule | add both to Files and to the Step 6 commit |
| T7 | claude 200000 | Rule 16 scan `grep 'agent-default.*\(null\|unknown\)'` is line-based and misses claude.ts:53-54 (`...under "agent-default"` / `-- with capabilities answering contextWindowTokens null --`), a published comment Task 7 makes false | should-rule | add that comment to the ERRATUM list explicitly |
| T8 | codex single call | `codexSingleCallHome(..., this.extraEnv?.CODEX_HOME ?? $HOME/.codex)` ignores an inherited `CODEX_HOME` when `configDir` is null, while catalogKey/readCodexCatalog honour it -> links the wrong auth.json/config.toml. `record` helper copied verbatim from ompSingleCall.ts:63. C8.2 literal tied to Task 0 (P9). Credential-path step has no [HUMAN] gate (S10) | should-rule | source = `configDir ?? process.env.CODEX_HOME ?? $HOME/.codex`, with a C8.3 variant |
| T9 | ccloop gate | consistent: ccloop verify-control-protocol.mjs:9-10 reads `ORCA_CCLOOP_BIN`/`ORCA_AGENTS_TABLE`; scripts exist | note | -- |
| T10 | R7 + Orca setup | P17 (blocking); otherwise test/impl consistent (old rule red, new rule green) | -- | see P17 |
| T11 | strict/soft | Step 4 says "8 passed"; the two files hold 6 (`it.each`) + 1 + 2 = **9** tests | should-rule | correct to 9 (counts are measured, Rule 14) |
| T12 | output overrun | `RunOutputBound` is placed only at ControlGroupView.tsx:403, inside the list filtered to problem runs (failed/blocked/unsettled/focused). A completed over-bound call -- the main case, "result used as normal" -- never shows the line; spec §6.2 "the call row shows" | should-rule | also render it where completed single-call runs are listed (or name that list); add a jsdom case for a completed run |
| T13 | models API | consistent; `query-invalid` maps to 400 (controlErrors.ts:28) so the test holds; plan text says `control-protocol-unavailable` maps to 503, it is 422 (errors.ts:137), untested | note | -- |
| T14 | datalist | consistent with T13 wire and existing helpers (`controlFailureFrom`, `codeAndDetail`, `explainCcloopCode` exist) | note | -- |
| T15 | repin | P25. No `CCLOOP_CACHE_DIR` exported for the pin script; verify-ccloop-pin.mjs:26 relocates HOME but not `XDG_CACHE_HOME` | should-rule | export `CCLOOP_CACHE_DIR` to a temp dir in T15 (Rule 17) |
| T16 | Orca gate | Step 2 loop runs plain `npm test`, while the text requires `npm test -- --reporter=json --outputFile=...` to prove "passed, not skipped" | should-rule | put the JSON-reporter form in the loop. Note: the wording scanner does not cover the zh strings |

## C. Plan vs spec / Global Constraints / defect shapes

| # | Where | Finding | Sev | Suggested ruling |
|---|---|---|---|---|
| S1 | spec §3, §4.3 vs issue 1 | the spec says a catalog failure is `agent-catalog-unavailable`; the plan keeps omp's own codes (C58 and Orca locales key on them) | should-rule | accept the plan (cheaper, keeps C58 unchanged); record as a spec correction |
| S2 | spec §6.1 vs issue 10 | "no object" -> spec `codex-single-call-not-single`, plan `single-call-output-invalid` (Orca's retry keys on it) | should-rule | accept the plan |
| S3 | spec §6.2 vs issue 11 | spec: `outputBound` only for `v1-soft` calls, text says "Codex ..."; plan: every single call, kind-neutral text | should-rule | accept the plan, or add a kind field to the run view |
| S4 | spec §4.2 vs issue 14 | "a criterion checks nothing is written under the real cache path" is replaced by a relocated-HOME proof | note | accept |
| S5 | spec §4.3 | "a miss and a failed probe are logged separately on ccloop's stderr" is implemented only for `ccloop agents models` (T4 row) | should-rule | see T4 |
| S6 | GC "probe timeout min(deadline, 30_000)" | T4 `readAgentCatalog` caps the version probe at `min(10_000, ...)` | note | accept, or say so in GC |
| S7 | GC "every criterion that can reach the cache sets CCLOOP_CACHE_DIR" | T15 does not; T4's relocated-HOME criterion unsets it on purpose (with HOME relocated) | note | see T15 |
| S8 | spec §6.1 "the plan step that adds [the credential symlink] is named to the human before it is written" | T8 Step 4 writes `codexSingleCallHome` (symlinks auth.json/config.toml) with no [HUMAN] gate; the ledger records approval for Task 0's symlinks only | should-rule | add a [HUMAN] nod to T8 Step 4, or record that the Task 0 approval covers it |
| S9 | human ruling on issue 8 | T4 keeps `version` in the entry (cached) | agree | -- |
| S10 | spec §9 mutations | each named branch has a mutation, except "an existing dir's mode is left alone" (T2), which has a test but no mutation | note | add M2.13: `chmod` an existing dir in ensureDir -> red |
| S11 | defect shape: an assertion before the call that reads back its own write | none found; T2 RF2 `readdir(locked)` may be unfalsifiable, which the plan already registers (M2.11) | note | -- |

## D. Anchor spot-checks (current trees: ccloop 1e05627, Orca 948ef694)

| # | Anchor | Plan says | Found |
|---|---|---|---|
| A1 | ccloop tests/agents/ompCatalogDiagnostics.test.ts:34,41,48-56 | C58a-c prefix/timeout/tail | OK |
| A2 | ccloop tests/control/singleCallCapability.test.ts:16,48,53,59,60,70-78 | E1-E3 | OK |
| A3 | ccloop tests/agents/registry.test.ts:81,83 | E4 title + null | OK |
| A4 | ccloop tests/control/agentsControl.test.ts:110 | E5 `capabilities: { contextWindowTokens: null }` | OK |
| A5 | ccloop src/agents/materialize.ts:25,47,88-143 (and spec's :109,:127) | probeVersion, timer, resolveAgent | OK |
| A6 | ccloop src/agents/ompModels.ts:4-22,30-77,85-86 | constants/stderrTail, runOmpJson, readOmpCatalog | OK |
| A7 | ccloop src/agents/types.ts:37,51; registry.ts:46,60 | CatalogRowV1, resolution enum, descriptor enum | OK (registry.ts:60 is the top-level DESCRIPTORS array behind P12) |
| A8 | ccloop src/agents/codex.ts:35,41-60,61-64; claude.ts:67-68 | no `-p` field, capabilities/singleCall*, createAdapter; I6 comment | OK; claude.ts:53-54 holds a second "null" comment (T7 row) |
| A9 | ccloop src/control/command.ts:97,195-214,247-291,293-318 | enum, METHODS, defaultHandler, validateResponse | OK |
| A10 | ccloop src/runtime/omp/ompSingleCall.ts:32-35,36-42 | published re-check comment, re-check | OK |
| A11 | ccloop src/runtime/codex/runCodexPhase.ts:11,28-30,42-44,48; codexAdapter.ts:12,36-39 | PhaseRequest, args, schema, env; options/ctor | OK |
| A12 | ccloop src/agents/updates.ts:139-144; vitest.config.ts:7; agentsFixture.ts:28-41 | ompUnavailable; setupFiles; codexInstallation probe | OK |
| A13 | Orca src/control/profiles.ts:119-122; estimatorCompatibility.ts:16; ccloopPort.ts:47,57; agentSelection.ts:36-39 | null-wins; `!== "v1"`; enum; PEER_CODE; never frozen | OK |
| A14 | Orca tests/control/webCcloopSmoke.test.ts:56-62,156-159; ccloopWorld.ts:82,162; profiles.test.ts:171; ccloopDefaultE2E.test.ts:40 | E6 table + null window; WorldOptions + `"soft"`; observed-null; shell codex | OK (E6's null is at :158) |
| A15 | Orca web/src/locales/en.ts:1358-1359; tests/panel/refusalCoverage.test.ts:94-96; ControlGroupView.tsx:403; controlApi.ts:36,289-309,315; executionDriver.ts:670-674; package.json:35; controlAssembly.ts:41; vitest.config.ts:10 | as cited | OK (enCcloopErrors opens at 1357; :403 is inside the problem-runs filter, see T12) |
| A16 | Orca tests/control/fixtures/estimateHarness.ts:19-29,52-54; src/control/estimator.ts:116-120 (`readEstimateContract` returns `maxOutputTokens`); webProtocol.ts:1763 | harness option + event literal; bound source; agentsViewSchema | OK |

Rows: 28 (A) + 17 (B) + 11 (C) + 16 (D) = 72.
