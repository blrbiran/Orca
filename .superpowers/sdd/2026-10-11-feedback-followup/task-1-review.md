# Task 1 independent Results5 review

Owner: `/root/results5_review`, 2026-10-11 Asia/Shanghai. Reviewed product `71d19b5be49762752492bc93d8c80c26d2ec835b` and closing tests `554d77e4a2883511922c07a108320ce2115578db` in `/private/tmp/orca-feedback-followup-20261011`. Code, index and HEAD were read-only; no subagents and no suite reruns.

**Spec compliance: ❌. Task quality: Needs fixes.** One Important finding; no Critical or Minor findings. Final controller root/browser gates remain pending and are not the reason for this Task1 verdict.

## Scope and source

Read task-1 brief, global constraints, task-1 report, Results5 preflight, RTK and CLAUDE. Read the original Task5 brief at `/Users/biran/.codex/worktrees/progress-results-20261010/Orca/.superpowers/sdd/2026-10-10-task-results/task-5-brief.md` and effective task-results spec including §8–8.6. Reviewed all 22 owned changed files, including actual App wiring and tests; followed the accepted read model only for nullable-current-attempt semantics. Controller-owned `10b02df` documentation amendments are outside Task1 compliance scope.

The supplied `review-9965162..554d77e.diff` contains the exact raw `git diff -U10 9965162..554d77e` after its package header (byte equality checked with Python and `/usr/bin/git`). Main HEAD was `554d77e`; `git diff 554d77e -- web README.md skills/orca-control/SKILL.md` was empty. Line references below were measured with `rtk proxy nl -ba` on that tree.

## Important — Unknown current authority erases the attempt high-water mark

**Locations:** `web/src/TaskResults.tsx:54` and `web/src/useResultsRead.ts:20`; both consumers use this guard (`TaskResults.tsx:61`, `GroupResults.tsx:11`).

For one unchanged scope/epoch/run/generation/execution/capture owner, admit current attempt **2** with its report still missing, then admit a stale/unavailable response with `currentAttempt: null`. The null response must be displayed as unknown, but `useResultsRead` also replaces its only remembered `prior` with that response. A later old response for attempt **1** now passes `prior?.currentAttempt == null` at line 54. It becomes the current result again, including attempt 1's old explanation and verification. Capture monotonicity does not protect this case: all three responses can have the same capture revision because current-attempt authority advances independently of capture.

This violates the original Task5 freshness consumer ruling and spec §8.3: unknown authority must not turn historical explanations into current results, and late older answers cannot roll back independently known attempt authority. The accepted reader explicitly allows null current authority (`src/panel/taskResults.ts:94–105`), so rejecting all null replies or displaying the previous known attempt as current would be an incorrect fix.

**Focused reproduction:** `/private/tmp/orca-results5-review-null-20261011.mts` imports the actual unchanged `freshSavedRun` and existing fixture, then performs the exact `prior = answer` admission sequence used by the hook. All identities, changeSeq and capture revision stay fixed. Observed output:

```json
{"known":2,"intermediate":null,"late":1,"captures":[3,3,3],"admittedUnknown":true,"admittedOlder":true,"lateExplanation":["Saved work"]}
```

Command: `rtk proxy python3 /private/tmp/orca-followup-run.py /private/tmp/orca-feedback-followup-20261011 results5-review-null-authority-node node --import tsx /private/tmp/orca-results5-review-null-20261011.mts`. **RC1** at the intended assertion: an unknown observation must not erase the independently known attempt high-water mark. Complete raw log and metadata: `/private/tmp/orca-followup-runs/results5-review-null-authority-node/{output.log,result.json}`. Source HEAD `554d77e`, tree SHA256 `f3dbba749389ec93ced1e1203f0e39457cbc6f4bdcd43793e5ffabe36ad14577`. No product mutation or suite run was needed. An initial tsx CLI invocation failed on sandbox IPC `EPERM`; that infrastructure failure is preserved separately at `results5-review-null-authority/output.log` and is not counted as functional evidence. Running through Node's loader avoided the IPC requirement.

**Required correction:** retain the greatest independently known attempt for each live owner/run separately from the currently displayed nullable DTO. Continue displaying null as unknown with history noncurrent; refuse a later lower known ordinal. Add regression coverage through the task and group consumers for `2 → null → 1` at identical capture revision and confirm null still displays unknown. Reset remembered authority only at the appropriate owner boundary. Prove the new protection with a focused deletion mutation in a clone.

Existing `resultsApp.test.tsx` covers direct `2 → 1` and initial-null history, but not this three-observation sequence. The supplied current-attempt-authority mutant fails the direct rollback criterion as intended; it cannot establish the missing sequence.

## Other scoped review conclusions

- App supplies active-section and account/project identity down to group/task reads. The shared hook and output lifecycle retire requests on hide, scope/epoch/owner change and login-required notification. Real App tests exercise task routes, mounted drafts/focus, hidden polling, account/project/epoch changes, predecessor ownership and AuthGate logout.
- Current missing explanations use `currentExplanation`; historical/predecessor attempts stay labelled history. Capture revision and execution identity guards, known core generation checks and nested group changeSeq checks are present. The finding above is the uncovered composition of null with the monotonic guard.
- Output previews validate exact run/group/attempt/output/path and the permitted encoded download URL. Download consumes that URL and the original response Blob. Tests observe exact binary bytes, encoded owners, binary/large allowed downloads, refusals and held blob cancellation. Minimal Markdown uses React text nodes; HTML/scripts/links/images do not acquire active markup or remote reads.
- Actual outcome, controller verification, Agent explanation, source availability, group review and delivery remain separate. No Agent prose is promoted to authority; no new model call/backfill, dependencies or evidence permission change was found. English/Chinese keys, actual-outcome translation, pseudo-locale coverage and roving Arrow/Home/End tabs are present.
- README and operator skill describe immutable snapshots and the installed old-pin versus producer publication/repin boundary. The additional controller spec/plan commit does not expand this task's implementation scope.

## Verification evidence assessed

Read complete existing raw logs and metadata for final whole Web (`result5-attempt-authority-full`: **104 files / 894 tests passed, RC0, no skips**), final typecheck (RC0), build freeze (RC0, retained Vite chunk warning) and restored focused run (`result5-attempt-authority-restored`: **8 files / 109 tests passed, RC0, no skips**). Final Web/type and restored-focus metadata share the exact tree SHA256 above, matching the independent focused witness. Build metadata predates the final test additions; no fresh build was claimed here.

Read the 14-mutation manifest and the complete raw current-attempt-authority mutation failure. Its targeted run deliberately skipped 17 unrelated criteria, as recorded, and is not a full-suite pass. This review does not claim to have replayed mutations or re-audited every historical raw failure. The existing passing suite and mutation do not cover the Important null-intermediate regression. Scoped fix and independent re-review are required before Task1 acceptance.
