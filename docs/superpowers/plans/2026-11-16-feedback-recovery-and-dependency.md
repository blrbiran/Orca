# Feedback Recovery and Dependency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover blocked requirement calls, replace dependencies atomically, and stop an automatic fix when the reviewer reports that it conflicts with a person's constraint.

**Architecture:** Keep the existing command ledger and control protocol. Repin the published ccloop change in an independent installation tree. Treat literal Git-history delivery as a separate contract and acceptance problem, not as a workspace-mode switch.

**Tech Stack:** TypeScript, Vitest, React, SQLite control store, npm GitHub dependency.

**Spec:** `docs/superpowers/specs/2026-11-16-recovery-and-dependency-feedback-design.md`; history design: `docs/superpowers/specs/2026-11-16-history-delivery-design.md`.

## Global Constraints

- Work in an isolated Orca clone with independent node_modules; leave other agent worktrees and real user data untouched.
- Use fake installations for regressions; no real provider call was necessary.
- Daily gate is `TMPDIR=/tmp npm test` with typechecks. `npm run verify` is reserved for a tagged release.
- Published specs and historical SDD files are append-only.
- The person subsequently opened this session with `allow-push`, authorizing ordinary pushes to the three `origin main` refs this session. A panel restart was not requested.

## Review Focus

- Blocked requirement calls listed only in `blockedCalls` must resolve their CLI recovery command (Task 2).
- A nonexistent run must fail before any POST (Task 2).
- A dependent with a pending start wake but no run must keep its old edge (Task 3).
- Replacement refusal must preserve the old edge and group revision (Task 3).
- Red on both base and tip does not prove identical failures; the reviewer must see both available tails (Task 4).

---

### Task 1: Published ccloop repin and paired compatibility

**Files:** `package.json`, `package-lock.json`, `tests/control/webCcloopSmoke.test.ts`.

**Interfaces:** The installed package's `dist/build-info.json.commit` matches the published GitHub pin. Its Codex descriptor reports response-completed observations as `realtime`, `budgetEnforcement:soft`, and `requestBoundProof:null`.

- [x] Confirm remote #316; run `scripts/pin-ccloop.mjs` in an independently installed Orca clone and verify lockfile/install/`npm ci` checks.
- [x] Match installed and paired clone `build-info.json` to the pin; run the ccloop #316 decoder/recovery tests and Orca's V10/V11 paired recovery tests. Report skipped tests separately.

### Task 2: Run-scoped requirement recovery (#329)

**Files:** `src/commands/domains/settings.ts`, `tests/commands/writesMore.test.ts`; verified existing producer `src/panel/controlViews.ts` and consumer `src/control/stopIntent.ts`.

**Interfaces:** `groupOfRunId(c: WriteContext, runId: string): Promise<string>` resolves `recovery.blockedCalls` before ordinary group views.

- [x] Add a blocked single-call CLI case, including a missing run that must POST nothing; watch it fail at `run-not-found` on the old resolver.
- [x] Resolve both blocker lists; run the CLI file and the existing service's `launchNeverClaimed` file.

### Task 3: Atomic dependency replacement (#330)

**Files:** `src/control/groupEdges.ts`, `src/control/webProtocol.ts`, `src/commands/domains/work.ts`, `web/src/GroupGraph.tsx`, Web types/locales and generated CLI references; tests `groupEdges`, `writesMore`, and `board`.

**Interfaces:** Extend `add-group-dependency` with optional `{replaces:string}` and a `group-dependency-replaced` result naming both edges. The delete/insert occurs inside one command-ledger transaction.

- [x] Watch a queued start with no run accept deletion under old code, then refuse it without losing the edge or revision.
- [x] Watch replacement fail at stack ambiguity after schema admission, then replace the exact edge atomically; cover cycle refusal, CLI payload, Web action and stale selection after success.
- [x] Independent clone mutations removing the removal guard, exclusion from stack calculation, and old-edge deletion; each named behavior went RED and the restored clone has zero worktree/index diff bytes. The mutation runner's M2/M3 log labels were swapped in its report; inspect their actual log assertions.

### Task 4: Contradictory human constraint and check (#322)

**Files:** `src/control/requirementReview.ts`, `tests/control/requirementReviewFix.test.ts`.

**Interfaces:** The reviewer can name `{criterionId,requiredCheck,because}` in an optional `checkConflict`. The controller validates the criterion and a check in the task union or frozen acceptance record, then reports `not-passed/cannot-judge` without auto-opening a fix. No required check is dropped or marked green.

- [x] Reproduce missing baseline prompt context, rejected conflict shape and unwanted automatic fix; verify each expected RED before the respective fix.
- [x] Show both bounded failure tails when a base-red acceptance exists, use the acceptance record's command despite settings changes, and keep normal non-conflicting review fixes working.

### Task 5: Literal Git history (#328) and finish

- [x] Compare the archived requirement with `workspace.ts`, `driverLanding.ts`, `integrationPass.ts` and group acceptance. Record the direct-source-parent history contract and tests in the separate design. `main` remaining unchanged during group-trigger delivery is expected.
- [x] Audit existing #291/#296 funding and dependency-order criteria; run two Orca daily gates and classify their complete failure sets. Both gates returned RC1 under load; no full-green claim.
- [ ] Implement the history contract/driver/acceptance in a separate cross-layer project; no current delivery scheme can satisfy literal direct merges of named branches. This session's design does not mark #328 fixed.

## As built and remaining limits

The #322 constraint is free text: the reviewer must recognize and report a semantic conflict. A missing or incorrect report can still start an inappropriate automatic fix; a reported conflict stops work for review and never waives a check. Group acceptance's existing `passed-relative` result compares red status at base and tip, not identical failure signatures. The new review prompt exposes available tails but does not change that acceptance rule. The reviewer reads an untrusted repository diff; it may be induced to request a pause, but such a pause cannot approve a failed check or mark a group done. These limits are recorded for the next design round.
