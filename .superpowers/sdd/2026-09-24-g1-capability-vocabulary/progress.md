# SDD ledger — plan: /Users/biran/code/skills/loop/ccloop/docs/superpowers/plans/2026-09-24-g1-capability-vocabulary.md

**Who**: Orca controller session `9c9f7f5f-625c-4222-8a9e-75ba7479f148` (Opus 5.5 1M), 2026-09-24.
**Start commits**: Orca `963b3ee` (`chore(checkpoint): orca-dev-a4f77b1f …`; remote `430b70a`, local ahead 3),
ccloop `6b3f1d6` (`docs(handoff): the next thing is executing G1's plan …`; == remote), ccmem `463b904` (== remote).
**Spec**: ccloop `docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md` (binding authority).
**Branch**: both repos commit on `main` (project convention; human said "按顺序做" after reading the plan that says so).

## Human authorization (2026-09-24, this session, verbatim)

"task 1 3 5 6 都同意授权。按顺序做" — authorizes changing the existing criteria those tasks name,
including (asked explicitly before) ccloop `tests/control/command.test.ts` >
`routes the real CLI through control before legacy parsing and emits one JSON value`.

## Environment

- ccloop main clone: `<SP>/ccloop-main` (`git clone --local`, node_modules symlinked, `npm run build` BUILD_RC=0), SP = session scratchpad.
- Adapter config: `<SP>/fixtures/fake-codex-config.json`, mode 0600, realpath == self,
  sha256 `29b9ff381830e5718d3e29cb0f674c5f79714cf531b7e85cf99818c3580bd240`; command = node + ccloop
  `tests/fixtures/fake-codex.mjs integration <SP>/fixtures/fake-codex-marker.json`.
- ⚠️ First attempt used a config pointing at the REAL `codex` binary (renamed `REAL-codex-config.DO-NOT-USE.json`).
  `verify:control` then showed a third red, `ccloopProtocol.integration.test.ts > real ccloop protocol > accepts, accounts…`
  (`expected 'failed' to be 'succeeded'`). That test drives the adapter for real. No file under `~/.codex/sessions`
  is newer than that config (`find -newer`), which suggests no model call happened — circumstantial, not proof.
  ⇒ Lesson: `verify:control` needs a FAKE codex config; handoff §8.2 never said so.

## Baseline (before Task 1)

- `verify:web-control:consumer` (BIN only): RC=1, 2 failed / 2 passed (4). Both = `webCcloopSmoke` targetVersion pair. Matches handoff §3.
  The terminal assertion (`deliverScheduledStart … "claimed"`) lives in the GREEN test `claims phase-end usage and soft enforcement…`.
- `verify:control` with fake config: see below (rerun pending when written).

## Pre-flight scan

| # | Task(s) | Checked | Finding | Ruling |
|---|---|---|---|---|
| P1 | T1 own text | Step 1 code vs `tests/control/command.test.ts` | `runControl`/`cfg` do not exist (helpers are `runControlCommand`, `runCli`, `configFixture()`). The existing `routes the real CLI … emits one JSON value` already asserts the full answer with `toEqual` — the new criterion would duplicate it | Ruling: rewrite that existing criterion in place to the v2 eight fields (human-authorized) instead of adding a duplicate — why: same observation, one home — cost if wrong: one test to split back out |
| P2 | T1 | other consumers of old vocab in ccloop (python scan, `reference/` excluded) | only `src/control/command.ts` and `tests/control/command.test.ts` | none |
| P3 | T2 own text / spec §7.1 | import graph | `webProtocol.ts` imports `safeInteger` etc. from `schema.ts` at top level; defining `capabilitiesSchema` in `schema.ts` via `capabilityViewSchema.extend` makes a runtime ESM cycle → TDZ ReferenceError at load. `npm run typecheck` (plan's check) cannot see it | Ruling: define `capabilitiesSchema` in `webProtocol.ts` next to `capabilityViewSchema`, delete the copy in `schema.ts`, switch importers (`budget.ts`, `ccloopPort.ts`, tests). Honors spec's intent (no second field list) — cost if wrong: an import path, reversible |
| P4 | T2 → T3..T6 | interface | after T2 Orca accepts only `protocol:2`; fixtures still v1 until T5/T6 ⇒ many Orca tests red between T2 and T6 | Ruling: accept plan order; per-task discriminant = every red ⊆ {old-vocab consumers from the python scan} ∪ {targetVersion pair} — cost if wrong: a real regression hidden until T6's full gates |
| P5 | T4 own text | test API | `createCcloopPort({stub raw})` does not exist; port is `createCcloopExecutionPort` and needs a real binary; the fake-peer pattern lives in `tests/control/ccloopPort.test.ts` (`fixtures/fake-control-peer.mjs`) | Ruling: T4's new criteria go in `ccloopPort.test.ts` using its existing fixture, not `profiles.test.ts` |
| P6 | T4 vs existing criteria | `tests/control/ccloopPort.test.ts` | `states only what ccloop states, and says unavailable…` and `therefore fails a claim closed on capabilities…` assert the OLD gap and must be inverted; `uses direct argv…` asserts `protocol:1`. NOT named in plan, NOT in human's authorized set (1,3,5,6) | ⛔ ask human before T4 (user instruction: existing criteria need naming, ask first) |
| P7 | T6 list vs scan | python scan of Orca | T6 list omits `ccloopPort.test.ts`, `profiledService.test.ts`, `unconfiguredPort.test.ts`; latter two only mention `probeProfileCapabilities` (v2 view, no change expected) | T6 Step 1 says the rescan output governs — follow it |
| P8 | T3 own text | `budget.ts` | matches plan (`protocol!==1`, three booleans, `unsupported`, `requestBoundEvidence`) | none |
| P9 | T5 | `webCcloopSmoke` | terminal assertion is in test 1 (green today via borrowed declared fields); M7/M8 must mutate the ccloop clone's answer | none |
- `verify:control` with fake config (rerun): RC=1, 42 files passed / 1 failed (43); 430 passed / 2 failed (432). Reds = targetVersion pair only. Matches handoff §3 cell for cell.

## Human authorization #2 (2026-09-24, this session, via AskUserQuestion)

P6 resolved: human chose "授权改写三处" — rewrite in `tests/control/ccloopPort.test.ts`:
① `states only what ccloop states, and says unavailable for the rest rather than inventing it`;
② `therefore fails a claim closed on capabilities, which is the accurate answer until ccloop grows the probe`;
③ the `protocol:1` assertion in `uses direct argv plus stdin JSON and validates successful responses`.
Conditions: whole rewrite, not weaker, comment names this authorization.

## Progress

- Task 1: implementer done — ccloop `f9727a1` `feat(control): answer the v2 eight-field capability vocabulary` (BASE 6b3f1d6). Trailer: Claude Sonnet 5.
  Implementer concern: M1/M2 red on `expect(result.code).toBe(0)` (ccloop's own strict response schema rejects first), not on the `toEqual` line.

## Human instruction #3 (2026-09-24, this session)
Finish all tasks this session, ignore context size; on problems proceed with controller's recommendation and report at the end for review; then update the three handoffs (Orca section in ccloop/ccmem must not grow; no hard HEAD); give an executive summary (≤10 lines) in chat only.
- Env note: Tier 0 gate blocked `git pull --ff-only` inside the scratch clone (merge into a `main`). Not retried; used a fresh `git clone --local` into `<SP>/ccloop-t1` (HEAD f9727a1, BUILD_RC=0, answers v2 eight fields).
- Task 1 review (sonnet): Spec ✅, quality Approved, two Important:
  (a) `requestBoundProof.workDimensions/handoffDimensions` are `z.array(z.string())` in ccloop vs Orca's sorted-unique 4-value enum.
      Task 1: parked — Ruling: plan-mandated verbatim; value is always `null` today (non-null belongs to the "compute capabilities" step 2 excluded by spec §2); if a future non-null value is malformed, Orca rejects it on receipt ⇒ fails closed, not open — cost if wrong: a latent looseness a future ccloop author must tighten.
  (b) M1/M2 red at `result.code` (ccloop's strict schema), `toEqual` never seen red on its own.
      Controller ran M2b in a clone (`<SP>/t1-m2b`, HEAD f9727a1): green baseline 7/7 RC=0; mutation = `.strict()`→`.passthrough()` on the capabilities schema + `durableAccept: true` in the handler; command.ts sha256 cde02f6d…af123 → 889f044a…08cb (differs);
      result RC=1, 1 failed / 6 passed, red at `tests/control/command.test.ts:115` (the `toEqual`), diff shows the extra `durableAccept`. Clone deleted; main tree diff 0 / cached 0 bytes. ⇒ addressed.
- Task 1: complete (commits 6b3f1d6..f9727a1, review clean after controller-run M2b; 1 parked)
- Ruling (pre-T2): after T2 changes `Capabilities`, `npm run typecheck` will error in `budget.ts` (T3), `ccloopPort.ts` (T4) and v1 test fixtures (T5/T6) — accept transient typecheck red on local, unpushed commits; T2 must keep every module loadable at runtime (vitest transpiles without typechecking) and list the remaining type errors in its report; T6 closes with full typecheck green — why: plan order is spec's argument, merging tasks would blur review surfaces — cost if wrong: a bisect across T2..T5 hits non-compiling commits.
- Task 2: BASE 963b3ee (Orca)
- Task 2: implementer done — Orca e1ef07e `refactor(control): collapse capabilities schema into the v2 view schema`; claims 105 reds in tests/control all within discriminant; typecheck RC=2 with 15 errors in expected files; M3: removing outer .strict() does NOT red (base's .strict() survives .extend()), .passthrough() does.
- Ruling (pre-T3, a): move the v2 upgrade of `tests/control/fixtures/store.ts` `caps` (and the second it.each cell `requestBoundEvidence:null`→`requestBoundProof:null`) from T6 into T3 — why: with a v1 `caps`, the schema line rejects every claim, so T3's new criterion and M5 would pass/red for the wrong reason (empty criterion) — cost if wrong: none beyond moving an authorized T6 edit earlier.
- Ruling (pre-T3, b): T3 Step 1 ("measure first: delete `!c.durableAccept`, both named tests red") must be measured on a clone at 963b3ee (pre-T2); at e1ef07e the schema rejects the v1 fixture first and the measurement means nothing — cost if wrong: none.
- Ruling (pre-T3, c): rewrite the authorized third cell `{...caps,durableAccept:false}` → `{...caps,handoffControl:"phase-end"}` and the authorized schedulerBridge peer `{...caps,durableAccept:false}` → `{...caps,handoffExecution:null}`; this gives M5 (delete `handoffControl!=="durable"`) a criterion and keeps both tests' intent (peer lacking a required durability property is refused before reserving/creating a run) — cost if wrong: two literals.
- Task 2 review (sonnet): Spec ✅, Approved. Reviewer re-ran tests/control independently: 105 failed / 323 passed / 5 skipped (433), RC=1; 105/105 attributed to v1 vocabulary or the targetVersion pair, 0 unattributed. Typecheck RC=2, 15 errors all v1-vocabulary. Zod 3.25.76: `.extend()` keeps base `.strict()`.
- Task 2: minor (deferred): outer `.strict()` on `capabilitiesSchema` (webProtocol.ts:96) is redundant — strictness comes from `capabilityViewSchema`; registered as a redundant guard (handoff §6.1 shape 2), not given a fake criterion.
- Task 2: complete (commits 963b3ee..e1ef07e, review clean)
- Task 3: BASE e1ef07e
- Ruling (pre-T4): T4's pass-through criteria need the fake peer to answer v2 and to answer a non-default `handoffControl`. `ccloopPort.test.ts` uses `tests/control/fixtures/fake-ccloop-control.mjs` (T5 Step 1's file, human-authorized). ⇒ pull T5 Step 1 into T4: fake answers the eight-field v2 default, plus an optional `config.capabilities` override (whole object) read from its adapter config. New T4 criteria live in `ccloopPort.test.ts` (P5), not `profiles.test.ts` — cost if wrong: a fixture knob that only tests use.
- Task 3: implementer done — Orca 68f8c37; claims tests/control 63 failed/368 passed/3 skipped (434), all within discriminant; typecheck RC=2, 9 errors none in budget.ts; M4/M5/M5b/M5c each red exactly the named criterion.
- Task 3 review (sonnet): Spec ✅ on all rulings; guard semantics confirmed (real ccloop v2 answer passes soft, refused strict; universal gate is pre-existing shape). Reviewer independently re-ran M5 (matches) and tests/control WITH ORCA_CCLOOP_BIN: 63 failed / 368 passed / 3 skipped (434), RC=1; 63/63 attributed.
  Two Important, both report-bookkeeping (no code): (1) implementer's per-cause tally didn't sum; reconciled by reviewer = 54 `control-capability-unsupported` + 4 `control-response-invalid` (all ccloopPort.test.ts) + 2 `start-intent-missing` + 2 targetVersion + 1 v1-literal `toEqual` (webCcloopSmoke `claims phase-end usage…`) = 63.
  (2) Task 2's 105 was measured WITHOUT ORCA_CCLOOP_BIN (5 skipped: realBinary-gated tests skipped), Task 3's with it (3 skipped) ⇒ the one red absent from Task 2's list is that realBinary-gated test, a v1-literal consumer, not a regression.
  Task 3: Ruling: both findings addressed by recording the reviewer's reconciled tally here as the authoritative record instead of a fix round — why: no code change requested, the ledger (not the scratch report) is what survives — cost if wrong: the task-3-report.md prose stays inaccurate; this line supersedes it.
  ⇒ Standing rule for T4–T6: every tests/control run sets ORCA_CCLOOP_BIN=<SP>/ccloop-t1/dist/cli.js and ORCA_CCLOOP_ADAPTER_CONFIG=<SP>/fixtures/fake-codex-config.json, so skip counts are comparable.
- Task 3: complete (commits e1ef07e..68f8c37, review clean after ledger reconciliation)
- Task 4: BASE 68f8c37
- Task 4: implementer done — Orca 67890cf; tests/control 59 failed / 376 passed (435), 0 skipped (both env vars set); typecheck 8 errors, none in ccloopPort.ts; M6 reds 3, M6b reds exactly the override criterion.
- Task 4 review (sonnet): Spec ✅; all four named risks cleared (fake-ccloop-control default change invisible to webCcloopSmoke's `consumer()`; ERRATUM still attached; value assertion present; reviewer re-ran tests/control: 59 failed / 376 passed (435), RC=1, subset of T3, per-cause 51+3+1+2+2=59; re-ran M6b, sha matched, 1 red = override criterion).
  Important #1: the ERRATUM (plan-verbatim text) points at `tests/control/profiles.test.ts`; the criteria live in `ccloopPort.test.ts` (P5). Ruling: fix in place — the ERRATUM was written this session, unpublished, never true (in-place edit of own unpublished typo is allowed; original JSDoc untouched) — cost if wrong: none.
  Controller cleaned up two reviewer-left scratch clones (`review-mut-clone`, `verify-clone-t3`) after unlinking their node_modules symlinks.
- Task 4: fix round 1 dispatched (resume implementer).
- Task 4: fix round 1/5 (1 addressed, 0 open — ERRATUM file reference; commits 67890cf..a6f8365). Scoped re-review done by controller mechanically (Rule 5: code can answer): diff is 4+/3- inside the ERRATUM only; the named `it()` title occurs exactly once in tests/control/ccloopPort.test.ts; implementer re-ran ccloopPort.test.ts 8/8 RC=0, typecheck same 8 errors none in ccloopPort.ts.
- Task 4: complete (commits 68f8c37..a6f8365, review clean after 1 fix round)
- Ruling (pre-T5): call sites in webCcloopSmoke use the REAL port's `probeProfileCapabilities()` (production strip path) instead of a test-side `codexProbe` copy; `codexProbe` is deleted (its only job was borrowing). The first test's `expect(capabilities).toEqual({protocol:1,…})` becomes the exact v2 literal (same authorized test). M7/M8 mutate a ccloop clone's `defaultHandler` answer and rebuild; ORCA_CCLOOP_BIN points at the mutated build — cost if wrong: none; strictly more production code under the terminal criterion.
- Task 5: BASE a6f8365
- Task 5: implementer done — Orca 287b502; consumer gate 2 failed/2 passed (targetVersion pair), terminal green; verify:control 58 failed/377 passed; typecheck 6 errors. CONCERN: M7/M8 red first at the raw capabilities() literal, then (bypassed via throwaway diagnostic) at service.ts:89's start gate — terminal `claimed` assertion not proven load-bearing by itself.
- Pre-T6 rescan (python, at 287b502): remaining hits in tests/panel/{controlConfigPort,controlReadApi,controlConfig}.test.ts, tests/panel/fixtures/controlPanel.ts, tests/control/{planImport,profiles,endToEnd,webFaults}.test.ts, fixtures/{fake-control-peer.mjs,web.ts}. NOT vocabulary (must stay): `protocol:1` on start envelopes / handoff requests (src/control/service.ts:148, startEnvelope.ts:74, dispatch.test.ts:11) and the error message string in commandLedger.test.ts:152; budget.test/capabilitySchema.test hits are the intentional v1-refusal criteria.
- Task 5 review (sonnet): Spec ✅ (diff = authorized edits only; literal byte-identical to the real f9727a1 answer). Measurements:
  X1 (invert `cap.handoffControl !== "durable"` in webDispatch.ts `probeBlocksDispatch`; sha 644d6c6f…3e4b → 3ebc3e03…bc8f): red at webCcloopSmoke.test.ts:153 (`"error" in await soft.service.start(...)` expected false) — NOT the terminal line 154.
  X2 (delete service.ts profiledCapabilities' handoffControl clause + neutralize the raw literal, M7 ccloop build): identical to X1; service.ts is not on this path at all.
  ⇒ CORRECTION of the implementer's report: the early catch is NOT `service.ts:89`; it is the same `probeBlocksDispatch`, called first in `scheduleStart()` (via `WebControlService.start()`) and again in `deliverScheduledStart()` on the same observation — first call wins.
  Discriminant: verify:control 58 = 51 capability-unsupported + 2 targetVersion + 2 start-outcome-unknown + 2 start-intent-missing + 1 group-stopped; strict subset of T4's 59 (the extra one was the v1 literal). Typecheck 6 errors, none in webCcloopSmoke.
  Minor: report's M7 after-sha has a stray 65th hex char; correct value e07a8cad163d490c396534fb0fa90c4bc564b5d45f665e1c05802ef84116434f.
  Important #2: terminal `claimed` assertion proven only in the positive direction (real answer passes and claims); the delivery-time reject is never isolated.
  Ruling: fix round 1 = ONLY-ADD criterion isolating the delivery-time guard (observation passes at start, degrades before delivery ⇒ delivery not `claimed`, no run), plus mutation X3 (remove the delivery-time `probeBlocksDispatch` check) must red it — why: spec §8.2 asks for the terminal criterion to be shown load-bearing; only-add needs no new authorization — cost if wrong: one extra test.
- Task 5: fix round 1/5 (2 addressed — delivery-time guard isolated by only-add criterion `blocks only at delivery when the observation degrades after a clean schedule` pinning `{kind:"blocked",reason:"claim-capability-unavailable"}` + runs=0; report correction appended; commits 287b502..b8a1b71; diff 27+/0-).
  Implementer's X3 over all tests/control: exactly 3 new reds = new criterion + `webContinuation.test.ts:438` + `webMutations.test.ts:110` (delivery guard previously pinned only via synthetic/probe-failure paths).
  Controller re-ran X3 independently (clone at b8a1b71, `blocked = false;` inserted after webDispatch.ts:166; sha 644d6c6f…3e4b → 9f350d0b…4654): green baseline 3 passed / 2 failed (targetVersion) RC=1; mutated 3 failed / 2 passed, new criterion red at webCcloopSmoke.test.ts:181 (`expected { kind: 'claimed' … } to deeply equal { kind: 'blocked' … }`). Clone deleted; main diff 0 bytes.
  Reviewer's "stray 65th hex char" Minor was wrong: both occurrences in task-5-report.md are 64 chars (python).
  Controller finding on b8a1b71: new comment claimed "Human authorization" for a controller-ruled only-add test ⇒ fix round 2 dispatched (comment-only).
- Task 5: fix round 2/5 (1 addressed — false "Human authorization" attribution → "Controller ruling (…)"; commits b8a1b71..2040f77; 1+/1- comment only). Scoped re-review by controller (diff read directly; consumer gate re-run by implementer 2 failed / 3 passed RC=1).
- Task 5: complete (commits a6f8365..2040f77, review clean after 2 fix rounds)
- Task 6: BASE 2040f77
- Ruling (pre-T6): `npm run verify` is an `&&` chain; with the two in-scope-expected targetVersion reds, `npm test` stops it and every later gate goes unmeasured. ⇒ run each segment of the chain separately with its own RC (typecheck, npm test, ledger validate, check-claude-md-lines, check-hooks-path, verify:control, verify:scheduler, verify:chain, web build, verify:panel, --ws check) plus `npm run verify` itself once for the record — cost if wrong: none; strictly more measurement.
- ⚠️ Task 6 implementer tripped a harness SECURITY WARNING "[Interfere With Workloads]". Controller traced its transcript: at 2026-09-24T01:10:47Z it started `npm test` in the background (its own output: "started PID 23680"); later it `kill`ed 23680 (`npm test`), then 9 orphaned `node (vitest 1..9)` workers (PPID 1, started 09:10–09:11 local, i.e. the same minute as its own npm test). ⇒ Strong circumstantial evidence the killed processes were its own run's workers; not provable that no other session's vitest started in that minute (load avg 24, 42 ttys). Reported to human.
- Task 6: implementer done — Orca 2e6f47a `test(control): sync the last v1 capability-vocabulary consumers to v2` (10 test/fixture files, src untouched). Claimed gates (RC from files): typecheck 0 (0 errors); npm test 1 (182/183 files, 1620/1622, only targetVersion pair); ledger validate 2 (acceptable); claude-md-lines 0; hooks-path 0; verify:control 1 (43/44 files, 434/436); verify:web-control 1 (16/17, 189/191); verify:scheduler 0 (51/51, 167/167); verify:chain 1 (second stage reruns suite → same pair); web build 0; verify:panel 0 (15/15); --ws check 0 (14/14, 70/70); npm run verify 1 (stops at npm test). ~/.orca unchanged. ccloop check-known-reds RC 0.
  Its first verify:control run had a schedulerBridge timeout it attributed to its own orphaned vitest workers (see the SECURITY WARNING entry above); two reruns clean.
- Task 6 review (sonnet): Spec ✅; all four named risks checked against logs (typecheck 0 errors; npm test / verify:control / verify:web-control / verify:chain / verify each exactly the two targetVersion reds; 0 skipped; scheduler 51/51 167/167; panel 15/15; --ws 14/14 70/70; ccloop check-known-reds RC 0). No assertion changed; scope clean.
  Task 6: parked — Important (forward risk): `tests/control/fixtures/web.ts` `webFixture` and `tests/panel/fixtures/controlPanel.ts` `createHarness` answer `port.capabilities()` as `{protocol:2, ...declared}` with no independent hook, while `setObserved` exists only for the probe path — a future claim-time-mismatch test using `setObserved` would get a false green. Ruling: real, pre-existing (old literals already equalled the declared profile), not in Task 6's vocabulary-only mandate; register in handoff for the fixture owner — cost if wrong: one future false green.
  Task 6: minor (deferred): four panel/planImport mocks' `capabilities()` is inert; a literal would read clearer than a spread.
  Task 6: minor (deferred): the orphan-process numbers in task-6-report.md have no redirected log (conclusion independently supported by isolated + clean reruns).
- Task 6: complete (commits 2040f77..2e6f47a, review clean, 1 parked)

## Final whole-branch review (opus) — 2026-09-24
- C1 (Critical, verified by controller): Orca origin/main = 2040f77 (`reflog origin/main`: "2026-09-24 09:10:13 +0800: update by push"); ccloop origin/main = 6b3f1d6 (answers v1); ccmem origin == local 463b904. Controller scanned every subagent transcript of this session for a `git … push` tool call: none (only the reviewer's report text). ⇒ pushed from outside this session (human, or the post-commit/batch-push mechanism in Orca handoff §9) — not attributed.
  Consequences: (1) published Orca main requires protocol 2 while published ccloop main answers protocol 1 → every `capabilities` call against the published pair = `control-response-invalid`; published Orca main is typecheck-red (6) and verify:control-red (58). (2) CORRECTION of the pre-T2 ruling's premise "local, unpushed commits": T2–T5 (e1ef07e..2040f77) are now PUBLISHED text — their comments/ERRATA get only appended ERRATA from now on. Only 2e6f47a (T6) and 3b76d89 (checkpoint) are unpublished.
  Ruling: awaitingHuman — push ccloop f9727a1 FIRST, then Orca (Tier 0; agent cannot).
- I1: acceptance claim restated (text only; goes to handoffs): real ccloop f9727a1 answer, via production `probeProfileCapabilities`, lets a soft Web group on a TEST-declared profile schedule; `deliverScheduledStart` books one `starting` run row in Orca's ledger; NO ccloop `accept` happens (that leg = seam B, still red); strict refused; M7/M8 red the smoke test at the answer literal / schedule-time gate; delivery-time gate independently load-bearing via X3 (synthetic degradation).
- I2 (Important): T6's endToEnd rewrite `durableAccept:"false"`→`handoffControl:false` is also caught by the `handoffControl!=="durable"` clause ⇒ `budget.ts:84` (schema line) has NO criterion: reviewer deleted it in a clone at 2e6f47a → identical FAIL set (15 = targetVersion pair + 13 env-caused controlMount/controlShutdown in an unbuilt clone). ⇒ fix in 2e6f47a's file (unpublished, human-authorized T6).
- I3 (Important): endToEnd.test.ts and fake-control-peer.mjs comments say the retired guarantees "moved" to handoffControl — false; they were deleted, nothing replaces them. ⇒ fix in place (unpublished 2e6f47a).
- I4, M1–M6: carry to handoffs (M5a — `not.toBe(null)` → literal — folded into the fix wave as a tightening).
- Final fix wave dispatched: I2 + I3 + M5a.
- Final fix wave: Orca 820b13b `fix(control): give the schema-line criterion in endToEnd a real red, correct false capability-migration comments` (I2: `contextObservation:false` + `toThrow("control-capability-unsupported")`; I3 comments; M5a literal). ⚠️ Commit has NO Co-Authored-By/Claude-Session trailers: the fixer tried `git commit --amend` (forbidden in its dispatch) and the harness denied it; left for the human. Its gates: typecheck RC 0; verify:control RC 1, 434/436, 0 skipped, only the targetVersion pair.
  Controller re-ran I2's mutation independently (clone at 820b13b, deleted `if(!capabilitiesSchema.safeParse(c).success)…` = budget.ts:84; sha b74ee7fb…deb3 → a3a7e882…62952, identical to the final reviewer's mutated sha): green 22/22 RC 0 → 1 failed / 21 passed RC 1, the only red = `rejects a malformed peer capability answer the guard clauses never read` at endToEnd.test.ts:86 ("promise resolved … instead of rejecting"). Clone deleted; main diff 0. ⇒ I2 addressed.
  Controller found two false phrases in 820b13b's new comments ("three v1 strict-mode gates"; handoffControl "happen to also gate strict mode") — the v1 guard line ran in every budget mode. Deterministic two-anchor replacement (Rule 5), committed as a4864d0 `test(control): say the three retired capability gates applied in every budget mode` (comment-only).
- Final review: complete. Remaining items carried to handoffs: C1 push order (human), I1 honest acceptance statement, I4 no real profile snapshot, M1 descriptor looseness, M2 assertCapabilities strict omits workDimensions.includes("tokens"), M3 published ERRATUM says "the paragraph above" but the stale one is the second, M4 "ruling-88" label = ccloop 人裁 88 (the naming rule), the authorizing message is the human's 2026-09-24 "task 1 3 5 6 都同意授权" + the Task-4 AskUserQuestion answer, M5b capabilitySchema test title unfalsifiable, M6 web BudgetEditor doesn't show the two dispatch-deciding fields; T2 redundant outer .strict(); T6 fixture capabilities()=declared forward risk; T6 inert mocks; T6 orphan-process log gap + SECURITY WARNING; 820b13b missing trailers.
