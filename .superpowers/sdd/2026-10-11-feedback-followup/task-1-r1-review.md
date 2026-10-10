# Task 1 R1 independent scoped re-review

Owner: `/root/results5_review`, 2026-10-11 Asia/Shanghai. Base `554d77e4a2883511922c07a108320ce2115578db`; reviewed HEAD `115830d424f87063eb835d1f3f911ba1d3dfb0b2` in `/private/tmp/orca-feedback-followup-20261011`.

**Spec compliance: ✅ Approved. Task quality: Approved.** Original Important R1 is closed. No Critical, Important or Minor finding in the fix or its introduced regression surface. This is task-scoped approval; controller final root/browser gates remain pending.

## Scope and independent inspection

Read the appended Fix round 1 report, authoritative `review-554d77e..115830d.diff`, all four actual changed files and the unchanged `useResultsRead` caller contract. Reviewed only the original nullable-authority failure and behavior affected by its fix. No code/index/HEAD edits, subagents, test reruns or mutations were performed.

Verified the packaged diff equals raw `/usr/bin/git diff -U10 554d77e..115830d`. Independently hashed the current source tree with the runner's file-selection/hash algorithm: `ba2f13c7e737e5c6186c5c52a31ca65a13e29b75e979613b00f62c97d9522bd1`, matching all closing gate metadata. All four files match their source manifest hashes, with zero owned working diff against `115830d`. Commands used `rtk proxy`; line references below were measured from these actual files.

## R1 resolution and regression assessment

- `TaskResults.tsx:61` introduces independent remembered authority. The null-preservation write at line 71 keeps the greatest known attempt even when the admitted display DTO says unknown. `freshSavedRun` at line 53 consults that authority, so `2 → null → 1` refuses the final answer. The display remains based on the latest admitted DTO; null is neither rejected merely for being null nor replaced by remembered attempt 2.
- The actual task consumer (`TaskResults.tsx:83–84`) and group consumer (`GroupResults.tsx:11–12`) both use the independent authority and call `remember` only after every identity/freshness check on the entire response succeeds. The unchanged hook calls admission only for a live, active, non-revoked matching request owner. A stale request or partly rejected response cannot advance the Map.
- Owner keys separate scope/account, epoch, group and task as applicable. Entries separate runId and generation. Changing projection changeSeq, capture revision, or hiding/showing a mounted pane does not erase the remembered attempt. A new scope/account/epoch replaces the Map; new run/generation has its own entry. Component unmount retires its memory. These boundaries avoid both original rollback and erroneously refusing valid lower ordinals belonging to a different owner.
- Known executionId remains stable in its run/generation entry through projection restarts. An initially unknown execution can become known; later null/foreign execution cannot erase an established identity. The fix does not change DTO semantics, verification interpretation, output behavior or request cancellation.

The new real-App cases at `resultsApp.test.tsx:96` test both consumers through the original three-response sequence, assert unknown rendering and absent historical prose in the current region, then assert stale refusal. Account-switch cases at line 102 prove fresh ownership. Direct consumer cases at `taskResults.test.tsx:46` exercise projection/hide retention and scope/epoch/run/generation resets; line 62 exercises retained execution ownership. These exercise actual hooks/consumers, rather than passing a synthetic authority record directly to the helper. The old prior-only witness remains valid historical RED and is not a test of the repaired consumer composition.

## Evidence read, without rerunning

Read complete raw logs for the two new RED runs, all five clone mutation runs, restored focus, final Web, type and build, plus closing metadata/source/mutation manifests:

- `result5-r1-red`: four intended failures, including real task/group `2 → null → 1`; RC1.
- `result5-r1-execution-red`: both intended consumer failures on the projection/null execution boundary; RC1.
- `result5-r1-mutant-null-attempt-retention`, `owner-reset`, `account-reset`, `execution-retention`, `generation-owner`: each RC1 with the intended task/group failures. Targeted exclusions are explicitly shown as skips; none is treated as a complete suite pass. Manifest records restored unstaged/cached diff bytes 0/0.
- `result5-r1-restored-focused`: **8 files / 117 tests passed, RC0, no skips**.
- `result5-r1-full-web`: **104 files / 902 tests passed, RC0, no skips**.
- `result5-r1-type` and `result5-r1-build`: RC0. Build retains the normal Vite chunk-size warning.

Logs and metadata are `/private/tmp/orca-followup-runs/<run-name>/{output.log,result.json}`. Full Web/type/build/restored-focus metadata all carry the independently reproduced source hash above. The eight added cases and the focused mutations close the original failure without weakening existing assertions. No unresolved fix-specific doubt warranted additional execution.
