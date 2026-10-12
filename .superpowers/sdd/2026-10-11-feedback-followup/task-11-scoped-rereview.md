# Task 11 scoped re-review

Reviewed the complete `48f65e7344484dedb5608beed592cf74b96fbe5a..ae6df40c1e213408b5bea3553560638a9fa889e2` fix diff, the previous independent review, affected source, report fix section, and retained test logs. Read-only; no source, index, or HEAD changes.

## Findings

1. **Important dismissal race — ADDRESSED.** `command-parked` now derives `dismissed` from the current reducer entry rather than resetting it ([controlState.ts:179](/private/tmp/orca-feedback-followup-task8-20261011/web/src/controlState.ts:179), [controlState.ts:183](/private/tmp/orca-feedback-followup-task8-20261011/web/src/controlState.ts:183)). Thus a `command-dismissed` event arriving while Check again is in flight remains effective when the late missing-group event arrives. The new held-lookup App test exercises Check again → Dismiss → late 404, checks persisted storage and hidden attention, then checks the same ID again to a retained result ([controlCommandRecovery.test.tsx:141](/private/tmp/orca-feedback-followup-task8-20261011/web/tests/controlCommandRecovery.test.tsx:141)). The old re-park behavior was killed by the fresh clone mutant.
2. **5xx `group-not-found` classification — ADDRESSED.** Missing-group parking now requires both HTTP 404 and the `group-not-found` code for a non-`@` scope ([controlApi.ts:279](/private/tmp/orca-feedback-followup-task8-20261011/web/src/controlApi.ts:279)). The new 500/503 cases assert `unresolved` ([controlCommandRecovery.test.tsx:179](/private/tmp/orca-feedback-followup-task8-20261011/web/tests/controlCommandRecovery.test.tsx:179)); the status-guard deletion mutant failed both cases.

## New Critical / Important issues

None found in the three-file scoped fix. The reducer change preserves the existing entry's dismissal without creating a new entry or changing command identity. The API change narrows parking to the route's typed 404 and leaves command scopes on the existing unresolved path.

## Verification and limits

Retained final-HEAD Web check metadata reports RC 0 at `ae6df40c1e213408b5bea3553560638a9fa889e2`; its log shows 108 test files, 956 passed, zero skipped ([metadata](/private/tmp/orca-feedback-followup-task8-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-11-evidence/task11-fix-web-postcommit-result.json), [log](/private/tmp/orca-feedback-followup-task8-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-11-evidence/task11-fix-web-postcommit-output.log)). Final Web build metadata reports RC 0 for the same source tree ([metadata](/private/tmp/orca-feedback-followup-task8-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-11-evidence/task11-fix-build-postcommit-result.json)). Fresh clone mutant logs show the re-park and status mutations failing their targeted tests ([re-park](/private/tmp/orca-feedback-followup-task8-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-11-evidence/task11-fix-mutant-repark-output.log), [status](/private/tmp/orca-feedback-followup-task8-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-11-evidence/task11-fix-mutant-status-output.log)). The fix diff changes only Web source/tests; prior root 64/64 remains the applicable root evidence. I did not rerun the suite or perform browser UI testing.

## Out of scope

The broader Task 11 implementation, Task 10 installation-update flow, and final release UI checks were not re-reviewed. No additional out-of-scope finding is asserted here.
