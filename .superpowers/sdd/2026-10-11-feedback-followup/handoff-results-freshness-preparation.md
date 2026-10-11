# Task 1 integration P2 — read-only preparation

Owner `/root/saved_verification_takeover`, 2026-10-11. This is preparation only. Task 7 still owns Orca product/tests/Git. No product or test edit, Git mutation, test invocation, clone, build, provider call or real-data access occurred here. Implementation requires the controller's explicit checkout release, BASE and authorization. No subagents were dispatched.

Read the complete scoped brief, integration review including P2, Task 1 report including its nullable-authority R1 appendix, Results spec section 8.3, current TaskResults/GroupResults/useResultsRead, actual App Results tests, direct consumer tests, Results and two-project fixtures, and relevant App/control composition. Used receiving-code-review to verify the finding against actual source. The earlier Task 1 evidence remains historical; this preparation claims no new RED/GREEN or passing gate.

## Finding verified in the existing composition

Current `web/src/TaskResults.tsx:52–73` retains currentAttempt and executionId per `[runId, generation]`, but its capture comparison uses only `prior?.captureRevision ?? 0`. `web/src/useResultsRead.ts:12` initializes prior to null on each effect; its dependencies are active and identity. Both hiding an active Results owner and a changeSeq identity restart therefore remove the only capture floor. The persistent owner memory remains mounted and still contains the same attempt/execution authority, so an otherwise matching capture 7 can pass after capture 8. This contradicts Results spec 8.3's per-run/generation monotonic admission. The continuous-read test at `web/tests/resultsApp.test.tsx:60` does not restart the effect and cannot detect this case.

Read-time hashes match the integration review's committed source objects:

| File | SHA256 |
| --- | --- |
| web/src/TaskResults.tsx | 3f74039ebbace90c8791f2da55ec3b9a4e1bd2f3b22f4678e424380d725c18d6 |
| web/src/useResultsRead.ts | e7dbd73fa0a6adfd38d78b2536e24ca9cf60def620e5726f404a6a0c4a9b2dbd |
| web/src/GroupResults.tsx | 0789f0a777c116c3ec5040ed497ac3eb724964d9d19e73e90441a3bc2d7cfe9b |

These hashes are a read-time observation, not a final source freeze or an authorized execution BASE. Task 7 may still change adjacent source before release.

The authority owners are already sufficient: task `[resultsScope, epoch, groupId, taskId]`; group `[resultsScope, epoch, groupId]`; App resultsScope includes account user ID and project scope. GroupDetailRegions keeps panels mounted, ControlGroupView passes active only for the selected Results region, and the App SectionPane preserves the mounted control panel when Memory is selected. A new immutable run/generation uses another existing Map entry. No new global state or polling is needed.

## Actual test paths and proposed functional RED

Extend `web/tests/resultsApp.test.tsx` using its existing setup/open/openTask/task helpers, isolated fake fetch, mutable FakePanel and fake timers. Its complete current file was read. Relevant existing criteria:

- Line 60, `real App keeps the latest saved capture when a lower same-owner reply arrives`: retain as continuous-read coverage.
- Line 40, `real App opens the task route and preserves mounted local drafts and focus across refresh and hidden sections`: reuse Memory → Task control navigation and the controlled 1ms hash tick; verify no hidden result reads over multiple controlled intervals.
- Line 47, `real App cancels held task reads across %s and keeps navigation focus`: reuse actual App summary/group changeSeq, epoch and run-owner updates, not a helper-only predicate invocation.
- Line 96, task/group `known attempt high-water through 2 -> null -> 1 at one capture`: preserve nullable display and independent attempt authority.
- Line 102, task/group `account switch resets remembered attempt authority`: reuse AccountContext rerender for a genuine account reset.

Add four parameterized lifecycle criteria: task/group × hide-show/changeSeq. Admit revision 8 with recognizable current prose and verification presentation, restart the actual read owner while account/project/epoch/group/task/run/generation/execution/attempt stay unchanged, then receive revision 7 with distinct older prose and verification. Require `result-response-stale` and no older current result. For changeSeq update both the fake core group/summary and the result's otherwise-valid projection; for GroupResults also return a top-level group changeSeq matching that projection. Do not let a projection mismatch masquerade as capture RED. Hiding/refetching clears transient display, so the assertion must not demand a preserved current region after a restart; it must demand refusal and absence of older current content. Capture 8's successful initial admission is asserted before the restart.

Run those new actual-consumer criteria on the released unchanged product before writing the source fix. Preserve full raw logs, precise argv, RC, per-test failures and selected-test skip counts. Expected RED is the lifecycle assertion's missing refusal/older current content, not a compiler or fixture error. If setup fails, correct only the fixture and obtain the meaningful RED before product edits.

## Positive boundaries and whole-response admission

Use the same actual App test file for task/group lower-revision acceptance after genuine account/project/epoch/run/generation replacement. Account uses AccountContext; project uses the existing selector from Alpha → Beta → Alpha and reopens the group after the real scope reset; epoch updates summary/recovery/group/result coherently; a new run changes core currentRunId, lineage and run data; generation changes both the core and nested run generation. Assert that the new owner may display the otherwise valid lower capture without stale refusal. The direct consumer reset test at `web/tests/taskResults.test.tsx:46` can also be extended to explicitly check revision, while preserving its attempt/execution reset assertions.

Add task/group full-response atomicity criteria with two independently identified runs. Start with admitted revision 8. Return a would-be newer revision 10 for one member and an invalid foreign generation/identity for the other, rejecting the entire response. After a same-owner read restart, return a valid revision 9 response and require acceptance. This proves that a rejected aggregate never commits a revision 10 floor; it also exercises the existing task Promise.all and group nested admission compositions. Use a local owned-route override of the fake fetch (the existing predecessor criterion demonstrates this pattern) rather than network traffic or a broad shared fixture rewrite. Assert the first response actually refused, the later valid current content appeared, and fixture posts stayed zero.

Add task/group nonregressing nullable currentAttempt criteria: a valid capture at or above the remembered revision with currentAttempt null still displays `attempt unknown`, never promotes previous-attempt prose, and retains established known ordinal/execution authority. Keep the old 2 → null → 1 criteria unchanged. Existing direct consumer `known execution authority` at taskResults line 62 remains a required related check.

## Smallest source change and GREEN plan

Expected owned product scope is `web/src/TaskResults.tsx` only: add captureRevision to SavedRunAuthority, compare the incoming revision against the maximum of the transient prior and remembered floor, and remember the maximum only inside the existing remember call after complete response acceptance. Keep task/group caller ordering intact. GroupResults and useResultsRead should need no source edit. Do not change nullable rendering, identity/reset keys, attempt/execution checks, transport, timers or request counts.

After the minimal change, complete scoped self-review before freezing final source. Run focused Results consumers/actual App/output/region/i18n/label ordering checks, then Web typecheck, full Web tests and build on that exact source. Existing package scripts and isolated runner conventions are sufficient; no redundant ccloop/CLI suite is justified by this browser-only authority change. Record current runner hash and isolated child environment, including `NPM_CONFIG_UPDATE_NOTIFIER=false`, but do not rewrite historical logs or npm/user configuration.

Prepare a private exact-source clone with existing dependencies; prove byte equality and an unmutated type/build/focused baseline before the named `capture-authority-retention` guard deletion. Remove only the remembered capture floor from admission (leaving transient prior comparison and other guards); the task/group hide-show and changeSeq criteria must fail at the intended assertions. Restore each changed path, verify raw Git source/index diff byte counts 0/0, and run the restored focused criteria. Keep mutation provenance, source hashes, native counts/skips and full logs. If any additional guard is mutated, name its required intended assertion explicitly; build errors never count as a killed mutant.

Only explicitly owned product/tests and a dedicated report/evidence path may enter the eventual commit. Parent briefs/specs/handoff drafts, Task 7 artifacts and node_modules stay unstaged. Use raw `/usr/bin/git` through `rtk proxy`, with a one-command empty hooksPath. The final report must state released BASE/HEAD and remaining limits for independent scoped re-review; no independent acceptance is self-dispatched or claimed here.

No technical blocking context found. Implementation is pending checkout release and the controller's explicit authorization.
