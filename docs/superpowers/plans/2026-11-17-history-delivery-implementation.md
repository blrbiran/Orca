# Named Source History Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A confirmed group that promises ordered merges of named source branches into a local target becomes done only when the target's first-parent history contains those exact source commits as direct second parents and required artifacts exist there.

**Architecture:** An explicit optional history expectation on the local integration scheme freezes source names, task mapping, target, order, and required artifacts. Orca binds actual source commit identities as the named tasks land, then integrates those commits in order with compare-and-swap publication and a recoverable journal. A separate history acceptance check reads the real target ref and gates group completion and dependent dispatch. Groups without an expectation keep their existing bytes and behavior.

**Tech Stack:** TypeScript, Zod, SQLite, Git plumbing, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-11-16-history-delivery-design.md` (append-only corrections take precedence over its earlier proposal).

## Global Constraints

- Only single-repository `delivery: local`, `trigger: group`, `method: merge` can carry `historyExpectation` version 1; ordinary delivery and folder/multi-directory groups are unchanged.
- A named source is `refs/heads/<valid branch>` in the registered repository, tied to exactly one existing task; task order follows dependencies. Missing refs block by name, and source SHAs are never taken from agent answer text.
- A named source ref must exist in the registered repository when its mapped task lands. Its object identity is persisted with that landing or recoverably staged before it; absent refs block by name, and later moves do not silently change the SHA. Run-created branches have no supported producer in version 1 (spec Correction 1).
- Each source SHA must be the direct second parent of a target merge on the target's first-parent chain in declared order; equal file trees do not count. The final target tree must contain every required artifact.
- A target ref move after a history acceptance invalidates it; pending history decisions block acceptance. No ordinary acceptance result, waiver, or system verdict bypasses the history gate.
- The target's checked-out working tree must be clean for local delivery. Never force-update refs, move a dirty worktree, push, or grant agent write access to the registered repository's Git metadata.
- A user-visible command that starts target integration requires the existing authorization path; CLI and Web expose the same status and refusal.
- Development tests use isolated repositories and redirected user-data roots. Daily gate is `npm test` plus typecheck; `npm run verify` is reserved for a requested tagged release.

## Review Focus

1. Source ref missing at a task landing: stop with an actionable reason and no `done` or dependent dispatch (Task 2).
2. Source ref moves after binding: retain the bound SHA; never follow the moving name in integration (Tasks 2, 3).
3. Target moves between creating and publishing a merge, or after acceptance: retry/reconcile safely or invalidate evidence (Tasks 3, 4).
4. Crash after a target CAS and before DB settlement: rediscover the exact merge from the target's parent chain without duplicating it (Task 3).
5. Tree equal but second parent wrong, reordered, or an artifact missing: refuse history acceptance even when ordinary checks pass (Task 4).

---

### Task 1: Author and freeze an explicit history expectation

**Files:** Modify `src/control/webProtocol.ts`, `src/control/integrationScheme.ts`, `src/control/integrationCommands.ts`, `src/control/webService.ts`, `src/control/requirementSchemas.ts`, `src/control/requirementSplit.ts`, `src/control/requirementCommands.ts`, `src/commands/domains/settings.ts`, `web/src/IntegrationScheme.tsx`, `web/src/controlTypes.ts`; add `tests/control/historyContract.test.ts` and Web tests.

**Interfaces:** `historyExpectationSchema` has `{version:1,targetRef:string,sourceRefs:{taskId:string,ref:string}[],directSecondParent:true,artifactPaths?:string[]}`. Optional on the local scheme and on the single-repository split output. `readHistoryExpectation(group)` returns a frozen validated expectation or null. `schemeHash` binds every member, including order. Requirement drafts may propose it but confirmation must visibly approve it. Existing local scheme without it remains byte-identical.

- [ ] Write tests for valid ordered distinct refs, missing/duplicate/non-task IDs, invalid target/method/trigger/delivery, unchanged ordinary schemes, and a confirmed group's refusal to drop or replace the promise silently.
- [ ] Run the focused tests and see the named behavior fail on the old code.
- [ ] Implement strict schema and authoring/preview plumbing; map a proposed split expectation to the group's explicit integration choice without interpreting prose as authority.
- [ ] Run focused tests, backend and Web typechecks, and builds; record output paths and results.
- [ ] Commit the isolated change with its tests.

### Task 2: Bind source tips to landed tasks

**Files:** Add `src/control/historySource.ts`; modify `src/control/driverLanding.ts`, `src/control/driveRecord.ts` if a staged SHA is needed, and `src/control/integrationScheme.ts`; add `tests/control/historySource.test.ts`.

**Interfaces:** `bindHistorySource(repo,groupId,taskId,runId,landedCommit)` reads and validates the named ref/object in the registered repository and returns an immutable `{taskId,runId,landedCommit,sourceRef,sourceSha,contractHash}` record. Re-entry with the same identity is idempotent; a mismatched source is an explicit block. Bind before calling a task done and preserve the SHA across ref movement. Do not bind agent text or an unregistered run-local Git ref.

- [ ] Write a real-repository test for existing/missing/moved source refs, SHA/object provenance, crash re-entry, and ordinary landings.
- [ ] Run tests red against the source-binding behavior.
- [ ] Implement the pre-landing observation and durable association with the landing; avoid creating a false `done` on an unbound history task.
- [ ] Run focused tests and typecheck; commit with the test.

### Task 3: Publish the ordered merges with recovery

**Files:** Add `src/control/historyIntegration.ts`; modify `src/control/integrationPass.ts`, `src/control/integrationScheme.ts`, `src/control/integrationCommands.ts`; add `tests/control/historyIntegration.test.ts`.

**Interfaces:** `integrateHistory(deps,repo,groupId,integration,groupTip)` returns the existing `Outcome` family and uses only frozen bindings. It persists a base/ordinal/expected SHA journal before publishing; each target commit has exactly `(currentTarget,sourceSha)` parents, including already-ancestor source tips, and publishes via existing local delivery's clean-worktree/CAS checks. It resumes from the target's verifiable first-parent chain after a crash; it does not substitute the group tip as a named source. Reconcile remaining group-tree artifacts with a tree-only commit, preserving those merge parents and checking for conflicts.

- [ ] Write real-Git tests for two ordered source branches, same-tree false positive, already-ancestor source, dirty target, CAS target move, post-CAS crash, and conflict refusal/retry.
- [ ] Run the new behavioral tests red.
- [ ] Implement a separate history path in integration; preserve the old integration path and its byte-level records when no expectation is present.
- [ ] Run focused tests, existing `integrationCrash`/`integrationScheme`, and typecheck; commit.

### Task 4: Prove history before completion and dependent release

**Files:** Add `src/control/historyAcceptance.ts`; modify `src/control/groupEdges.ts`, `src/control/groupDone.ts`, `src/control/executionDriver.ts`, `src/control/groupAcceptanceRecord.ts`, `src/panel/controlViews.ts`, `src/control/webProtocol.ts`; add `tests/control/historyAcceptance.test.ts`.

**Interfaces:** `historySatisfied(store,repo,groupId)` checks contract hash, all bound SHAs, actual target tip, exact first/second parents along its first-parent chain in order, final artifact blobs, and unresolved history decisions. It records an immutable evidence object only for the exact target tip/group tip; any changed target tip makes the read unsatisfied until reconciliation. `prerequisiteDone` and `markGroupsDone` require it for history groups, regardless of ordinary tree acceptance or system verdict.

- [ ] Write tests for the 5 Review Focus failure modes, pending history decision, completed work with integration still pending, and dependent dispatch blocked until proved.
- [ ] Run tests red; implement producer, read-time validation and view/problem projection.
- [ ] Run focused and neighboring group acceptance/dependency tests plus typecheck; commit.

### Task 5: Explain and operate delivery in CLI/Web

**Files:** Modify `src/commands/domains/reads.ts`, `src/commands/domains/settings.ts`, `web/src/IntegrationScheme.tsx`, `web/src/GitScheme.tsx`, `web/src/controlTypes.ts`, `web/src/locales/{en,zh}.ts`; add `tests/commands/historyDelivery.test.ts` and `web/tests/historyDelivery.test.tsx`.

**Interfaces:** Preview names target, ordered source refs, and the literal parent condition. Progress shows each bound tip/merge and a named blocker. The owner can inspect and retry an interrupted history delivery via the existing authorized route, without bypassing acceptance. The UI does not imply a task's `done` means the target moved.

- [ ] Write tests for pre-confirm review, absent/moved source, pending decision, target move, and ordinary integration UI unchanged.
- [ ] Run them red; implement CLI/Web strings and actions; run focused tests and Web typecheck/build.
- [ ] Run `npm test` with its affected-file report and root/Web typecheck, preserving complete logs; classify skips and any failures honestly.
- [ ] Review the diff against the spec and direct-parent proof, then commit.

## Completion

After the five tasks, inspect each commit and current branch diff, independently review cross-repository ref safety and crash re-entry, run the affected daily gate on the integrated branch, and fast-forward merge to main only after verification. Add a correction to the existing spec if any implementation choice differs from the original boundary; never rewrite its prior paragraphs.
