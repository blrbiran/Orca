### Verdict: Approved (0 Critical, 0 Important, 4 Minor)

### Spec Compliance
- ✅ Section placed before the "Runs of" heading, only when `item.currentRunId !== null`, refetching on `[runId, changeSeq]` — web/src/TaskDetail.tsx (RunActivity + insertion line); order pinned by compareDocumentPosition in taskActivity.test.tsx test 1.
- ✅ Part B names used (controller amendment): `fetchRunActivity`/`RunActivityV1`/`ActivityEntryV1` exist (controlApi.ts:117, controlTypes.ts:368-371); no duplicate fetch added (global amendment 3). `reasonCode` from runFacts.ts:18 (strips `Error: `) and `explainRunReason` used for blocked rows (amendment 3). `codex-no-completion` has an en entry (en.ts:1103).
- ✅ Amendment 4: test data uses raw `executing`; component maps via CCLOOP_STEP (planning/executing/verifying) to the panel's plan/execute/verify, unknown words shown as sent.
- ✅ Read-only, stays on archived groups: no `archived` gate on RunActivity; test 3 renders with `archived` and asserts the region and one request. E10 gating (`!archived` on retry, LoopPlanCard `archived`, editors) untouched in the diff.
- ✅ Locales: `control.activity` and `enums.activityKind` in en+zh; en uses `satisfies Record<ActivityKindV1,string>`; the zh type is `Translation<typeof en>`, so a missing key fails compile. The refusal shows an en-keyed text with the code (no new error code, so no en/zh error-code entry is needed).
- ✅ taskLabels.test.tsx rewrite is exactly as briefed (activity mock + 3-request assertion, asserted after the download).
- ✅ Two unnamed existing-test rewrites match the ledger ruling: i18nPseudo counts 33/165 -> 34/178 (+13 kinds = 178, arithmetic checks) and the controlI18n heading query narrowed to "a 的运行"; neither weakens what it pins.
- ✅ No ~/.orca writes (web-only). Fetch is stubbed per test.
- ⚠️ Mutation evidence is the implementer's claim only (6 mutations incl. changeSeq dep after adding the refetch test). Plausible for each new branch: region line, true&&, phase branch, explain, CCLOOP_STEP, changeSeq dep. Not re-run.

### Strengths
- Added the changeSeq refetch test because the dep drop was green before — the correct response to mutation 6.
- Test 1 asserts positions after the call on literal expected strings, not inputs read back; the URL assertion pins the route.
- Refusal path keeps the rest of the detail; `live` flag guards unmount/rerun races.

### Issues
Critical: none. Important: none.

Minor
1. TaskDetail.tsx RunActivity: `entries` is not reset when `runId` changes (e.g. after retry-task gives the task a new current run). Old run's rows show under the new run's region label until the fetch lands; on a refused refetch they stay together with the refusal text. Fix: `setEntries(null); setRefusal(null)` at effect start when runId changes, or key the component by runId.
2. taskActivity.test.tsx test 2 pins only `startsWith("… · blocked · ")` and no `"Error: "`; it does not pin the explained wording, so a regression to showing the bare code (`codex-no-completion`) passes. Fix: assert `toContain("The model stopped without finishing its turn.")`.
3. Untested branches of activityText: a phase row with no numeric `attempt`, a step word with no CCLOOP_STEP entry, and the generic kind-only fallback. Behavior is simple, but unpinned.
4. Implementer-noted: a blocked row with `codex-exit-error` shows raw until the queued final-wave explanation lands (already queued; not an E11 defect).

### Assessment
Task quality: Approved. The change matches the brief as amended by Part B names and pre-flight amendments 3-4, keeps the activity view read-only and visible on archived groups with E10's gating intact, and the two extra test rewrites are within the ledger ruling.
