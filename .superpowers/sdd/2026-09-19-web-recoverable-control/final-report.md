# Final report -- web recoverable control (plan 2026-09-20, Task 10)

Produced 2026-09-21 with `6a8fa6e feat(web): add recoverable task control` and
`92e7df2 fix(panel): serve the evidence bytes the manifest hands to the browser` in the history --
the latter is §8.1's production change, committed separately from this evidence so a human can
review or revert it on its own. Working tree `main`, nothing pushed. Every number below is copied
from a tool result; the unfiltered logs in `test-logs/` are the authority, and this file is the
index.

## 1. What was verified, and how far that reaches

Task 10 is the verification task: it adds tests and evidence, and (see §8) one production route.
The surface proves:

* the whole Web control plane over a real Panel process -- ephemeral port, temporary `stateDir`,
  allowlisted temp repository/plan, token auth, the canonical-JSON body gate -- with the durable
  SQLite state checked after each boundary (`tests/panel/controlApi.test.ts`,
  `tests/panel/controlRecoveryApi.test.ts`);
* the eleven fault seams of spec §9.3 that are new to the Web layer, each by killing a transaction
  or losing a response and re-running the identical command (`tests/control/webFaults.test.ts`);
* the ten mutation guards of §9.4, each by mutating ledger state the way a bug or a hostile process
  would and requiring the code to notice, then restoring it (`tests/control/webMutations.test.ts`);
* the frozen dispatch envelope, durable accept, evidence read and hash-verified artifact chain
  against **real ccloop** as a subprocess, with no external model
  (`tests/control/webCcloopSmoke.test.ts`).

It does **not** prove a live chain run. §7 states that boundary; the live model remains a human gate.

## 2. Commands, exit codes, pass counts

The full table (11 GREEN rows, 9 RED rows, each red mapped to the production fact it revealed) is in
`commands/2026-09-21-task-10.md`. Summary of the final GREEN run, all `RC=0`:

| Gate | Result |
|---|---|
| `npx vitest run tests/control/webFaults.test.ts` | 10 passed (10) |
| `npx vitest run tests/control/webMutations.test.ts` | 10 passed (10) |
| `ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js npx vitest run tests/control/webCcloopSmoke.test.ts` | 4 passed (4) |
| `npm run verify:web-control` | 11 files; 112 passed / 2 skipped |
| `npm run verify:web-control:consumer` | 1 file; 4 passed |
| `npm --workspace web run check` | 11 files; 58 passed |
| `npm test` (root) | 172 files passed / 1 skipped; 1516 passed / 3 skipped |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json`, no diagnostics |
| `npm run build --workspace web` | `✓ built in 531ms`, 45 modules |
| `npm run verify:control` | 39 files; 403 tests |
| `npm run verify:panel` | `PASS 0`–`PASS 14` |

The 2 skips in `verify:web-control` are the real-binary tests in `webCcloopSmoke.test.ts`, skipped by
`it.skipIf(!realBinary)` because that script does not export `ORCA_CCLOOP_BIN`; both run under
`:consumer` and under the root suite command above. The 3 root-suite skips are the pre-existing
`tests/control/ccloopProtocol.integration.test.ts` live-protocol cases, which stay skipped unless
`ORCA_CONTROL_VERIFY=1` -- and `verify:control` runs them (403 tests, no skips).

`tests/panel/noSkips.test.ts` (spec rule 12 / ruling G9) scans `tests/panel` and `web/tests` for any
skip spelling and passes, so nothing Task 10 added there hides a case behind a skip. Across the whole
`tests/` tree the only skip spellings are the three lines above -- an `it.skipIf` pair in
`webCcloopSmoke.test.ts` (146, 176) and the integration file's `describe.skipIf` (29).

**Fresh full verification after the final reviewed code** (the plan's own checklist requirement, run
against the committed tree, so it includes `92e7df2`'s route and every test in this commit):

```text
PATH="/usr/local/bin:$PATH" rtk env ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js \
  ORCA_CCLOOP_ADAPTER_CONFIG=/tmp/orca-ccloop-d3-task8/fake-codex-config.json npm test
RC=0   Test Files  173 passed (173)   Tests  1519 passed (1519)   Duration  100.31s
log: test-logs/root-suite-final.log
```

With both environment variables exported the two `it.skipIf` cases and the three live-protocol cases
run, so this is the zero-skip count: 173 files and 1519 tests. It supersedes row 7's
172/1516+3-skipped as the post-code measurement; row 7 is kept because it is the configuration
`verify:web-control` uses.

## 3. Artifact inventory

Test/source bytes (sha256, from `shasum -a 256` in the working tree at evidence time):

```text
388a4ed326ff2ea6ad1b95892a8571f05e36a972c2b176733af30d93cc7d9ded  tests/control/webFaults.test.ts
b062ae50c194bb967bba381f51a19d2a01d4f11edf6b75a9a0056c0898f98bcd  tests/control/webMutations.test.ts
08f358a750424a2b2fe5325a8953d8ac96041bb531585885c40d1f54a8947601  tests/control/webCcloopSmoke.test.ts
818bc89a0e9853dceda348d0ac18e8d96f835fdee5c4534947196203cc46f06b  tests/panel/controlApi.test.ts
3b0f11be537d7ebb4b17e2ef32fb7f024ed3205e8407ff66a8e6fa0c13fb884f  tests/panel/controlRecoveryApi.test.ts
33b396695608b662facc32462551366ebe395aebe4efcd7c25811c76794afbdb  tests/panel/fixtures/controlPanel.ts
f12aecf5ef7757b271eabbfe9d55dc13221c7d59ef232e80e9a8009aa3997bb4  src/panel/controlApi.ts
27408d9a35916321f619e90fa41a4b14a4f49949501ad33654c08985689eea6f  package.json
```

Evidence files (this directory):

```text
d7bbbd05e67b1e1bab5b503a343c3e0a0873c8b8903e104dcb915f0c218593e2  artifacts/api-fixtures.json
-                                                        artifacts/api-fixtures-dump.test.ts.txt  (collector, kept out of the suite)
e0196bfd01ca61f328bb76fbc6889ba202256972f576d499e254f95d580c10ef  test-logs/root-suite.log
f50017b0afc35572ac3aafc5227705d9c8cd5808f4d906a94eb881763586eba7  test-logs/root-suite-final.log
8284e4cf41b6ce8d4ef26a3c688eb3ea4294a67839788ca6a4b65f0fdf52894f  test-logs/typecheck.log
babb2c1346628bf027e78455698511edc007c39f2bcabf9ae5658009cd867609  test-logs/verify-control.log
7799ce6d8dee456507ccffa3403db80e9c940f890a2293bae331d70014b2c821  test-logs/verify-panel.log
6594e5eb69dd3691cd28506fae8a8bb64321159d0785de91a3c553122a955859  test-logs/verify-web-control-consumer.log
f199a49c18467d357f7915ddf9adacbb940558f8ff0d597d33ab97c306f47d54  test-logs/verify-web-control.log
a1edf5fd14cbc262f5da502cb207d029683600b9ca0597ae82c30bacef6e8c8d  test-logs/web-build.log
80553c4449c6867e31c6576063f90c5db19cc5abba417315f2f6f68d77206507  test-logs/web-check.log
2ee4e156006d3df00baa811ad9607f42076720860aa9844986283fea13c0f730  test-logs/webCcloopSmoke-green.log
db398814233617abfbd49e6cf8d03201115ba9e2f13f6716cca09a3bcc19a40c  test-logs/webFaults-green.log
a3341cb1d456e0c50ce19712f73b0dd87777a2f07b7ffcc5569723522a6953b7  test-logs/webMutations-green.log
```

`webFaults-green.log` was captured after `commands/2026-09-21-task-10.md` was written, through
`rtk npx vitest run tests/control/webFaults.test.ts`; it is the same command as that file's row 1, so
the row's counts (10 passed, `RC=0`) are unchanged and re-confirmed by this log.

Spec-to-test coverage is `acceptance-map.md`: all 43 §9.1 scenarios, §9.3 seams and §9.4 mutations,
each at a `file:line` with the verbatim `it()` title. Every cited line was re-checked against the
file.

## 4. Redacted API fixtures

`artifacts/api-fixtures.json` holds the verbatim Panel answers for one full flow
(import → replay → draft view → refused edits → estimate → model-advice edit → confirm → start →
handoff-stop → settlement → evidence manifest and download → recovery → summary). Run
`artifacts/api-fixtures-dump.test.ts.txt` to regenerate. The flow is the same one
`tests/panel/controlApi.test.ts` asserts, so these bodies are the ones the tests already pin.

Notable real answers (abbreviated; field names verbatim):

```jsonc
// POST /api/control/groups/import-plan -- replayed with the same commandId and revision
{ "status": 201, "byteForByteIdentical": true }

// POST .../proposal/edit naming expectedRevision 99 -- durable refusal
{ "status": 409, "error": { "code": "revision-conflict", "commandRevision": 1 } }

// POST .../proposal/edit with value 9007199254740992 -- refused by the canonical-JSON body gate,
// which is why the code is about the payload rather than about integers.
{ "status": 400, "error": { "code": "control-non-json-payload", "commandRevision": null } }

// The ledger is the bookkeeping a browser cannot forge. After those two refusals:
{ "total": 2, "staleRow": { "1": 1 }, "outOfRangeRow": null, "groupRevision": 1 }
// -> a revision conflict is one durable command row; an invalid payload never reaches the ledger.

// GET /api/control/summary without a token
{ "status": 401, "body": { "error": { "code": "token-required" } } }

// GET .../runs/<estimate run>/evidence -- before and after the estimate answer was published
{ "status": 200, "body": { "schema": "orca-run-evidence-v1", "entries": [] } }   // both times
// -> an estimate's own answer is not run evidence; it is exposed as estimates[].output/outputHash.

// GET .../runs/<run>/evidence for a run the fixture marked `settled-restartable` with no checkpoint
{ "status": 423, "error": { "code": "recovery-blocked", "message": "recovery-blocked:run-state:run-…" } }
// -> an unresolved run reads as unresolved. This state was written in-process by the test fixture
//    (`settleRun`), not by the production settlement path, so it is not a claim about normal flow.

// POST /api/control/groups/grp-1/start
{ "status": 202, "result": { "kind": "scheduled", "operation": "start", "wakeId": "scheduler-wake:grp-1:4" },
  "commandRevision": 4, "projectionSeq": 6,
  "effectivePayloadHash": "44136fa3…", "authorityCommandHash": "c8db9fca…" }

// POST .../handoff-stop
{ "status": 200, "result": { "kind": "handoff-stopped", "stopRevision": 5,
    "frozenRunIds": ["run-5a096e24-…"], "requestIds": ["handoff-0e3ee8e6…"] } }

// The claimed work run, as the browser sees it
{ "runId": "run-5a096e24-…", "phase": "work", "state": "starting", "claimOrdinal": 1,
  "providerAttemptOrdinal": 0, "remaining": { "tokens": 2000000, "activeMs": 14400000, "attempts": 3, "sessions": 3 },
  "evidenceIds": [] }

// GET /api/control/runs/<work run>/evidence + its downloadUrl, and a forged artifact id
{ "entries": [ { "evidenceId": "handoff-run-89ca…", "kind": "handoff",
                 "sha256": "aa6483b2…", "byteLength": 151,
                 "downloadUrl": "/api/control/runs/run-89ca…/evidence/handoff-run-89ca…" } ] }
{ "downloadStatus": 200, "bytes": 151, "contentDisposition": "attachment; filename=\"aa6483b2…\"",
  "contentSecurityPolicy": "default-src 'none'",
  "unlistedArtifactId": { "status": 423, "body": { "error": { "code": "recovery-blocked",
                              "message": "recovery-blocked:evidence-reference-unknown" } } } }

// Leak check over the serialized group view
{ "containsRoot": false, "containsRepoPath": false }
```

The two `<run>` ids differ between quoted blocks because the dump records the estimate run and the
work run of the same Panel; `api-fixtures.json` carries the full ids.

## 5. Fault-injection outcomes (§9.3)

All eleven Web-layer seams named by the plan are executable and green; the low-level crash/SIGKILL
criteria from earlier tasks were re-run unchanged inside `verify:control`. Per-seam results:
`acceptance-map.md` §9.3. The shape each one proves is the same: kill or lose at the named point,
assert **zero** rows (or exactly the durable intent) for that command, then re-issue the identical
envelope and assert **one** effect. Two of them are worth restating because they are the ones a
reader would otherwise assume were simulated:

* *startup recovery before listen* (`webFaults:266`) -- the store is reopened and `recover()` is
  called before the server is created, so the first HTTP request already sees `dispatchBlocked`
  true; there is no window in which an unrecovered panel answers.
* *global shutdown cross-group commit* (`webFaults:243`) -- a second `boot()` over the same
  `stateDir` (a new epoch, i.e. a process restart) replays the shutdown once under the same command
  id, and the non-target groups keep their pre-shutdown revision byte-for-byte.

## 6. Mutation-guard outcomes (§9.4)

Ten guards, all green, each restoring its mutation before the test ends: `acceptance-map.md` §9.4.
The three that most often hide in a projection:

* **safe-integer overflow** is refused before the ledger opens, not clamped: in-process the zod
  boundary throws out of command handling; over HTTP the canonical-JSON gate answers 400
  (`control-non-canonical-json` → `control-non-json-payload`), and §4's ledger-row probe shows no
  `commands` row for it.
* **unknown usage does not release its reserve**: the read refuses a run view that reports the grant
  as spent, and the run's `remaining` plus the group's `committedRemaining` are unchanged by an
  unknown-usage settlement -- clearing it later is a human decision, not a projection subtraction.
* **no immediate-kill or in-place-release route exists**: six forged paths
  (`skip-usage`, `force-complete`, `runs/:id/kill`, `runs/:id/mark-checkpointed`, `recovery/trust`,
  `groups/:id/reset-ledger`) all answer 404 `route-not-found` and leave the revision untouched; the
  only sanctioned way past a blocker is `recovery/retry`, which is itself one durable command and
  advances the revision by exactly one.

## 7. No live model call occurred

No external model was invoked while producing any evidence in this directory. `npm test`,
`verify:web-control`, `verify:web-control:consumer`, `verify:control`, `verify:panel`, `typecheck`
and the web build all completed with the deterministic fixtures named in
`commands/2026-09-21-task-10.md`: real ccloop as a subprocess whose `control capabilities` answer is
a literal, `tests/control/fixtures/fake-ccloop-control.mjs` as the worker-side consumer, and
ccloop's own `tests/fixtures/fake-codex.mjs` behind
`ORCA_CCLOOP_ADAPTER_CONFIG=/tmp/orca-ccloop-d3-task8/fake-codex-config.json` for the paths that
needed a "model" at all. Codex stays `usageObservation: "phase-end"` and `budgetEnforcement: "soft"`
in every assertion; strict mode is proven *unreachable on it*, not enabled anywhere. The live chain
verification remains a separate human gate, and nothing here authorises or implies it.

## 8. Deviations from the plan's Task 10 text

Each of these is a deliberate choice made during execution, not an oversight. Listed for approval.

1. **One production change.** `src/panel/controlApi.ts` gained
   `GET /api/control/runs/:runId/evidence/:artifactId` (21 added lines, committed alone as
   `92e7df2`). Before it, the evidence manifest handed the browser a `downloadUrl` that no route
   served -- the manifest's own field was a 404. The route re-walks the same reference list and
   serves only a listed hash through `readArtifact`, so it cannot be used to read an arbitrary
   artifact. Task 10 was scoped to tests; this was the minimum change that makes an accepted
   manifest honest. **Needs human sign-off.**
2. **A shared fixture file the plan did not list**: `tests/panel/fixtures/controlPanel.ts` (236
   lines) boots the real Panel both `controlApi.test.ts` and `controlRecoveryApi.test.ts` use. Its
   header comment states exactly which two facts are settled in-process and why.
3. **`proposal-edit` where step 3 named `set-limit`.** `webService.setLimit` requires
   `group.status ∈ {ready, running, review}` (webService.ts:433), so on a *draft* group the smallest
   legal human mutation is `proposal-edit`; the overflow guard exercises that. `set-limit` is
   exercised where its own precondition holds: `tests/control/confirmation.test.ts:85`
   ("set-limit changes only live ceiling/reserve and preserves readable frozen authority"), the
   blocked case at `tests/control/confirmation.test.ts:48`, and the HTTP verb at
   `tests/control/proposal.test.ts:76`.
4. **The dispatch→`StartEnvelope` translation lives in the test.** `webCcloopSmoke.test.ts` builds
   the ccloop envelope from the ledger's canonical `orca-dispatch-envelope-v1` because no production
   consumer does that yet (§9). The test therefore proves the wire contract and the frozen identity,
   not the existence of a production worker loop.
5. **Two facts are settled in-process**, not over HTTP: the estimate answer
   (`service.completeEstimate`) and a run's terminal disposition (the fixture's production-path
   settlement helpers). A browser cannot supply either; the worker-side path that does is covered by
   `webCcloopSmoke.test.ts` and `verify:control`.
6. **`verify:web-control` skips 2 tests by design** unless `ORCA_CCLOOP_BIN` is exported; the named
   `:consumer` script and the root suite run them. The plan's own script text is unchanged.

## 9. Findings left for a human decision

* **Production `orca panel` still mounts no `/api/control` surface at all.** `src/panel/server.ts`
  imports only the host check and the canonical-JSON body gate from the control layer, and nothing in
  `src/panel/` constructs the `deps.control` runtime (stateDir, trusted config, profile router,
  scheduler, `ExecutionPort`) that `buildApi` requires. The whole plane is therefore proven green
  over a Panel that the *test harness* assembles (`tests/panel/fixtures/controlPanel.ts`). This is
  the carried-forward item 1 of the 2026-09-21 handoff section, and Task 10 did not close it: the
  plan's Task 10 Step 1 asked for "a real Panel with a temporary stateDir and deterministic profiles",
  which is what the harness is, not for production wiring. **The next decision is where that
  assembly lives and what it is allowed to default to.**
* **Panel evidence links cannot be opened by a browser.** `web/src/ControlGroupView.tsx:99` and
  `web/src/RecoveryView.tsx:49` render plain `<a href={evidenceManifestUrl(runId)}>`; every
  `/api/control` read requires the `x-orca-token` header, so following one of those anchors answers
  401 (proven in §4). This predates Task 10 (it is Task 9's UI surface) and fixing it means a
  product decision -- a fetch-with-token viewer, or a scoped link credential -- not a test change.
* **No production consumer turns `orca-dispatch-envelope-v1` into a ccloop `StartEnvelopeV1`.** The
  Web ledger books the claim intent (`outbox kind='work-claim'`) and never calls `port.accept`
  in-process by design; the dispatch engine, budget ledger and ccloop protocol are each tested
  green, and this file proves a real consumer accepts the envelope the ledger froze -- but the loop
  that runs in a shipped Panel does not exist yet. Together with the next point it is the remaining
  gap before the live chain gate.
* **`createCcloopExecutionPort` exposes no `probeProfileCapabilities`,** so a raw ccloop port cannot
  drive Web dispatch at all (`intersectCapabilities` records a probe failure and
  `probeBlocksDispatch` blocks the claim). The smoke test supplies the probe from the real
  subprocess's `capabilities` answer plus the declared profile descriptors, which is what §9.1's
  "Codex plus strict is refused" row needs -- and it is also why wiring the production probe is a
  decision to make deliberately rather than to patch in.

## 10. Pre-existing D3 evidence, linked not modified

`verify:control`'s no-model path still points at the Task 8 D3 fixture config; its hashes at
evidence time, read-only:

```text
f6c14da856424b105356a5697fbd0be376257e1000910407b88c4a0f7ef856e8  /tmp/orca-ccloop-d3-task8/fake-codex-config.json
0cfac1b9439e1c9d91987cf25de340beed5aabdcd6ffce1fc7e12ebcdce537b5  /tmp/orca-ccloop-d3-task8/fake-codex-marker.json
878691afb5f3c3c57963dc282d4eb43a7c474fd46211f692f1b92078ead4665f  /tmp/orca-ccloop-d3-task8/fake-codex-marker.json.calls   (159 lines)
```

`.calls` is appended to by every `verify:control` run, so that hash is a point-in-time value, not a
constant. Nothing in this task wrote to `/tmp/orca-ccloop-d3-task8/`.
