# Recovery and dependency feedback design

Status: implementation scope agreed by the person on 2026-11-16; issue #322 ruling: the person's instruction not to repair pre-existing failures takes precedence over a conflicting check.

## Intent

A requirement's suggested recovery command must work; a person replacing a prerequisite must not expose a moment when the dependent can start without either prerequisite; an automatic requirement-review fix must not silently undo a person's explicit constraint. These are independent defects and retain the current persistence and authorization model.

## #329: recovery of a blocked requirement single call

The CLI's `groupOfRunId` consults recovery `blockers`, then ordinary group views. Blocked single calls appear in `blockedCalls`, while ordinary group views refuse a clarifying group. Look up the run in `blockedCalls` as well as `blockers` and use the group revision from the summary. Keep the existing run-scoped recovery transaction; do not replace the command with group retry, which does not requeue a drafting round. A nonexistent run still fails before POST. Acceptance: a read listing a blocked clarify or split call gives a command that POSTs once for that run, and a wrong run does not POST.

## #330: dependency replacement

A group confirmed but waiting for a prerequisite can still have an accepted start wake. Adding a dependency checks `dependentStarted`; removing one does not. Removing the only prerequisite and then adding another is an unsafe two-command operation. Extend the existing add-dependency command with optional `replaces` (CLI `group depend --on NEW --replace OLD`); under the ordinary command-ledger transaction, validate the exact existing edge, the new prerequisite, repository, archive state, cycle, stacked branch ambiguity and start state, then replace the edge. A distinct `group-dependency-replaced` result names both edges. Preserve the existing edge and revision on refusal. Require an unstarted dependent for removal too, so no already scheduled group loses its ordering guard. Expose the same action in CLI and Web. Do not treat 'no run yet' as evidence that a start was never queued.

## #322: conflicting human constraints and checks

The reported requirement explicitly forbade fixing a pre-existing failing test. The reviewer was correct to flag that test change. The subsequent automatic fix inherited `npm test`, which could not pass if the prohibited change was reverted. Prefer the person's explicit no-repair constraint and report the conflicting check instead of automatically opening an impossible fix task. Preserve the failing check as evidence; do not silently waive or delete it. The command to resolve the conflict remains a person's choice: change the check, change the requirement, or explicitly accept a relative baseline after checking the failing cases are the same. A red base by itself does not prove equivalent failures on the tip. The review prompt repeats the original human requirement and, when the group acceptance has a red base, shows the check and bounded baseline evidence. The reviewer may report a structured `checkConflict` naming a `not-met` criterion, an actual required task or project check and the reason it conflicts with the person's restriction. The controller checks the criterion and command names, records the report as an unresolved review and refuses automatic fix. This is a conservative pause, not a determination that two red runs have identical failures. Because the constraint is free text, the reviewer still has to identify the contradiction; a missing report remains a known limitation. Never parse arbitrary human prose with a keyword and never declare a red check passed.

## #328: history-specific deliverables

Orca normally lands task trees to `orca/<group>` and integrates at the configured trigger. A task marked done before group-trigger integration does not imply main has advanced. A requirement that demands a particular merge ancestry or per-task commit on main needs a separate preflight and acceptance contract; a matching tree does not prove Git history. Do not blanket-reject `worktree` or interpret a task-level done as group-level delivery. Design the history criterion and its Web/CLI explanation separately after comparing existing integration schemes and the actual archived requirement; no old run is rewritten.

## Constraints

No real provider call or real `~/.orca` write for regression tests. Affected tests must fail for their named behavior before implementation, preserve unrelated schemas and group history, and run through the repository's daily `npm test` gate. The ccloop repin is separate and only uses the published commit in an independent installation tree.
