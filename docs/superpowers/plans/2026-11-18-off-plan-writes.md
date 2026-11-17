# Off-plan writes (#346) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 2026-11-18 by the controller of Orca session `4389b15f` on `main` after
`docs(handoff): the human's end-of-session answers -- stuck-runs gets an independent review next, …`.

**Goal:** A loop task may write files its plan did not name, unless a task that can run in parallel with it claims them; every off-plan write is recorded, and a write into a parallel sibling's claim is retried automatically after that sibling lands.

**Architecture:** Loop plan version 4 expands to a contract with an empty allowlist (ccloop then enforces only the denylist). At confirm, Orca computes each v4 task's parallel siblings' claims from the archived plan and freezes them per task in the execution snapshot; `deriveContract` adds them to the derived contract's denylist and constraints. A denylist stop on a frozen sibling claim is classified `parallel-claim`; `retry-task` gains `after: <sibling>` (adds the sibling to the work item's `dependsOn`, drops that sibling's claims from the task's frozen entry, re-derives), and an orca-auto pass issues it. Landing records off-plan paths as an activity row that the task view and the review facts read.

**Tech Stack:** TypeScript, zod, node:test-style vitest suites, SQLite control store, React web panel.

**Spec:** `docs/superpowers/specs/2026-11-17-off-plan-writes-design.md` (including "Ruling on W4").

## Global Constraints

- No ccloop change and no repin. ccloop's empty allowlist means "no allowlist"; its denylist matcher reads exact, `<dir>/**`, `**`.
- Contracts of loop plan version ≤ 3 keep their bytes and hashes; snapshots of groups without v4 tasks keep their bytes (the new snapshot key is omitted, not empty).
- Constraint lines, verbatim from spec W2:
  - always (v4): `targetPaths are the files this task is expected to change; change others when the work needs them.`
  - when the frozen sibling claims are non-empty: `Other tasks of this group change these paths at the same time; do not modify them: <paths>.` (`<paths>` = the sorted, de-duplicated claims, joined with `, `).
- `off-plan-write` activity paths capped at 64, with the total count.
- Off-plan records are information only: never a failure, never fed back into the plan.
- Repo rules: Rule 9 (each new branch: a named mutation, seen red, in a `git clone --local` copy), Rule 14, Rule 18 (`npm test` per task; the controller runs `npm run test:wide` at merge). Existing assertions that must change are listed in the task's commit with a `Ruling:` comment; they wait for the human's approval before merge.

## Decisions the plan makes where the spec left room (append to the spec as "Correction 1" in Task 7)

1. **Where the claims live.** Not in the archived plan or the recipe (both are hashed before confirm), but in a new optional snapshot key `offPlan`, computed in `prepareExecutionSnapshot` and read back by every `deriveContract` caller. This is "frozen with the contract" (spec W2) and lets `--after` change one task's entry without re-deriving its sibling.
2. **"Adds dependsOn".** The dispatcher reads only the work item's `dependsOn` (`src/control/orchestration.ts:171`, `dependencyReady`). `--after` appends the sibling there; the archived plan's `dependencyTaskIds` are not touched.
3. **Overlapping unordered pairs.** Instead of refusing the plan (`off-plan-claims-overlap`), a pair whose write sets intersect is never a parallel sibling (its claims would deny the task its own targets). Recorded because plan-file import may not materialize implicit edges as dependencies.

## Review Focus

1. Two siblings each write the other's claim: both auto-retries `--after` each other; the second must be refused as a cycle (`after-cycle`) and left for a person — no deadlock, no silent loop. (Task 6 test.)
2. A task claiming `**`, or a sibling claiming `**`: no task is parallel to it, so no task gets `**` in its denylist. (Task 2 test.)
3. A review fix task in a group whose tasks are v4: `fixTaskAllowlist` must stay `[]` (no allowlist). In a mixed v3+v4 group the union becomes a narrow list; the fix task then can miss — accept, but pin current behaviour with a test so a change is seen. (Task 1 test.)
4. Multi-directory v4 task: the extra repository's contract entry carries `allowlistPaths: []` explicitly and its own sibling claims; a denylist stop reads `denylist match: <key>:<path>` (key known from the contract, so a path containing `:` still parses). (Tasks 1, 3, 5 tests.)
5. Auto-retry funding refused: the refusal is visible on the task (same mechanism as other orca-auto retries), and a person's `--after` still works. (Task 6 test.)

---

### Task 1: Loop plan version 4

**Files:**
- Modify: `src/control/loopPlans.ts` (REGISTRY, `expandRecipe`, new exported constant)
- Modify: `src/control/requirementSplit.ts:459-470` (multi-directory `additionalRepos` built after expansion)
- Test: `tests/control/loopPlans.test.ts`, new `tests/control/offPlanContract.test.ts`

**Interfaces:**
- Produces: `export const OFF_PLAN_TARGETS_CONSTRAINT: string` (the "always" line above); `export function offPlanWrites(planVersion: number): boolean` (true for ≥ 4); `currentLoopPlanVersion(id) === 4` for every plan id.

- [ ] **Step 1: Failing tests** in `offPlanContract.test.ts`:
  - `"a version-4 standard task has no allowlist, its protected paths as the denylist, and the targetPaths line"`: `expandLoopPlan("t1", "/r", "standard", inputs)` → `contract.safetyPolicy.allowlistPaths` equals `[]`; `denylistPaths` equals `inputs.protectedPaths`; `context.constraints` ends with `OFF_PLAN_TARGETS_CONSTRAINT`; `recipe.planVersion === 4`.
  - `"a version-3 recipe re-expands to its old bytes"`: a stored v3 recipe's `expandRecipe` hash equals the hash recorded in an existing v3 fixture (take one from current tests; if none, compute it on `main` before the change and paste it).
  - `"a version-4 multi-directory task sends an empty allowlist for each extra repository"` (through the split path that builds `additionalRepos`).
  - `"a review fix task of v4 tasks has no allowlist"`: `fixTaskAllowlist([[],[]], ["a"])` equals `[]`; and the mixed case `fixTaskAllowlist([["x"],[]], ["a"])` equals `["x","a"]` (pins today's behaviour, Review Focus 3).
- [ ] **Step 2:** `npm test` → the new tests fail (no version 4).
- [ ] **Step 3: Implement.** REGISTRY gains `...V1_PLANS.map(plan => ({ ...plan, version: 4, ...V2_DEFAULTS, ...V2_CHANGES[plan.planId] }))`. In `expandRecipe`, when `offPlanWrites(recipe.planVersion)`: `allowlistPaths: []` and `OFF_PLAN_TARGETS_CONSTRAINT` appended after the plan's and setup's constraints. In `requirementSplit.ts`, the extra-repository entries' `allowlistPaths` become `[]` when the expansion's version is ≥ 4.
- [ ] **Step 4:** `npm test`. Existing tests that expand a fresh loop plan and expect `allowlistPaths` equal to `targetPaths` (or a v3 version number) now fail: change each minimally, comment `// Ruling: pending human approval (session 4389b15f, #346 v4)`, list them in the commit body. Mutations: drop the `[]` branch; drop the constraint line; drop the extra-repo `[]` — each must turn a new test red.
- [ ] **Step 5: Commit** `feat(loop): plan version 4 -- no allowlist, targetPaths are a plan (#346 W2)`.

### Task 2: Parallel siblings' claims

**Files:**
- Create: `src/control/parallelClaims.ts`
- Test: `tests/control/parallelClaims.test.ts`

**Interfaces:**
- Consumes: `writeSetOf`, `qualifiedWriteSetOf`, `normalizeClaim` (`src/scheduler/writeSet.ts`), `intersect` (`src/scheduler/pathTrie.ts`).
- Produces:
  ```ts
  export interface SiblingClaims { siblingId: string; claims: Array<{ repoKey: string | null; path: string }> }
  export interface ParallelClaimsInput { taskId: string; dependencyTaskIds: readonly string[]; contract: TaskContract }
  export function parallelClaimsOf(tasks: readonly ParallelClaimsInput[]): Map<string, SiblingClaims[]>
  ```
  Siblings sorted by `siblingId`, claims sorted by `repoKey ?? ""` then `path`, de-duplicated; a task with no siblings maps to `[]`. A claim's `path` is the declared string from the sibling's `context.targetPaths` (primary repository, `repoKey: null`) or `context.additionalRepos[].targetPaths` (that entry's `key`). Only tasks whose contract has `allowlistPaths: []` receive siblings (v4); any task may be a sibling.
- Rule: S is a sibling of T iff S ≠ T, S is neither ancestor nor descendant of T over `dependencyTaskIds`, and the two write sets do not intersect in the same repository (Decision 3).

- [ ] **Step 1: Failing tests:** `"a diamond gives B's claims to C and C's to B, nothing to A or D"` (spec acceptance 1); `"a task claiming ** has no siblings and is no one's sibling"`; `"an unordered pair whose write sets intersect are not siblings"`; `"claims in another repository keep their repository key"`; `"a v3 task (non-empty allowlist) gets no siblings"`.
- [ ] **Step 2:** run, see them fail (module missing).
- [ ] **Step 3:** implement (ancestor sets by DFS over `dependencyTaskIds`; intersection per repository with `intersect`).
- [ ] **Step 4:** `npm test` green; mutations: drop the ancestor exclusion; drop the intersection exclusion; drop the v4 filter — each red.
- [ ] **Step 5: Commit** `feat(control): the parallel siblings' claims of a v4 task (#346 W1)`.

### Task 3: Freeze the claims at confirm and derive them into the contract

**Files:**
- Modify: `src/control/webProtocol.ts` (`executionSnapshotSchema`: optional `offPlan`)
- Modify: `src/control/executionSnapshot.ts` (`deriveContract`, `prepareExecutionSnapshot`, `readConfirmedTaskExecution`, `replaceTaskInSnapshot`)
- Modify: every other `deriveContract` caller: `src/control/webService.ts:361`, `:2772`, `src/control/groupTaskAppend.ts:51`
- Test: new `tests/control/offPlanSnapshot.test.ts`

**Interfaces:**
- Consumes: `parallelClaimsOf`, `SiblingClaims` (Task 2).
- Produces:
  - snapshot key `offPlan?: Array<{ taskId: string; siblings: SiblingClaims[] }>`, sorted by `taskId`, entries only for tasks with ≥ 1 sibling, key omitted when there are none.
  - `export function offPlanEntryOf(snapshot: ExecutionSnapshotV1, taskId: string): SiblingClaims[]` (`[]` when absent).
  - `deriveContract(task, proposalVersion, siblings: readonly SiblingClaims[] = [])`: when `siblings` is non-empty, the derived contract's primary `denylistPaths` = sorted unique(original ∪ claims with `repoKey: null`), each extra repository's `denylistPaths` likewise with its key's claims, and `context.constraints` gains the sibling line (Global Constraints) listing every claim (extra-repository claims as `<key>:<path>`). Empty `siblings` ⇒ output byte-identical to today.
  - `replaceTaskInSnapshot(..., skills, siblings?: readonly SiblingClaims[])`: when given, replaces (or removes, when empty) that task's `offPlan` entry.
- Groups whose tasks are added after confirm (`groupTaskAppend`, review fix, debug, system debug) pass `[]` (spec W2: a review fix task has no siblings; debug tasks keep the original's denylist — recorded limitation).

- [ ] **Step 1: Failing tests:** `"a confirmed diamond freezes B's and C's siblings and derives their denylists and constraint line"`; `"readConfirmedTaskExecution re-derives the frozen entry and accepts it"`; `"a snapshot with no v4 task has the bytes it had before"` (compare to a fixture computed on `main`); `"replacing one task's entry leaves its sibling's derived contract hash unchanged"`.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** implement; `prepareExecutionSnapshot` builds `ParallelClaimsInput` from `verifyPlanAuthority`'s plan (`dependencyTaskIds`) and each task's original contract.
- [ ] **Step 4:** `npm test`; mutations: don't pass the entry in `readConfirmedTaskExecution` (must turn `recovery-blocked` red); drop the constraint line; drop the extra-repo denylist — each red.
- [ ] **Step 5: Commit** `feat(control): freeze a v4 task's parallel claims at confirm and deny them in its contract (#346 W2)`.

### Task 4: Record off-plan writes at landing

**Files:**
- Modify: `src/control/activity.ts` (`ACTIVITY_KINDS`), `src/control/webProtocol.ts` (`activityKindSchema`)
- Modify: `src/control/driverLanding.ts` (where a run becomes `landed`, `:72` and `:1037`)
- Modify: `src/control/requirementReview.ts` (`reviewFacts`)
- Modify: the task view's last-run line and `task show` (find where a run's `pathPolicyMisses` are rendered today and put the line next to it), `web/src/locales/en.ts`, `zh.ts`
- Test: new `tests/control/offPlanWriteRecord.test.ts`

**Interfaces:**
- Produces: activity `off-plan-write` with body `{ taskId: string; runId: string; paths: string[]; count: number }` (`paths` sorted, at most 64; `count` the full number). `export function offPlanPaths(changed: readonly string[], targetPaths: readonly string[]): string[]` (pure; paths not covered by any target under `normalizeClaim`; `.decisions/**` excluded).
- Review facts line, once per task with records: `Off-plan writes by <taskId>: <paths joined ", "><" (+N more)" when count > paths.length>`.

- [ ] **Step 1: Failing tests:** `offPlanPaths(["src/a.ts","src/board/cli.js","README.md"], ["src/a.ts"])` equals `["README.md","src/board/cli.js"]`; `offPlanPaths(["src/x/y.ts"], ["src/**"])` equals `[]`; a landing of a run whose diff has 70 off-plan files records 64 paths and `count: 70`; a landing with none records no row; `reviewFacts` includes the line.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** implement; the changed paths come from `git diff --name-only -z <run base> <attemptSha>` through the file's existing `git(landing, [...QUIET_GIT, …])` helper (multi-directory: primary repository only — record the limitation in a comment); write the row in the same transaction that sets `landed`.
- [ ] **Step 4:** `npm test`; mutations: drop the cap; drop the `.decisions` exclusion; skip the row write — each red.
- [ ] **Step 5: Commit** `feat(control): record a landed run's off-plan writes (#346 W3)`.

### Task 5: Classify a stop on a sibling's claim

**Files:**
- Modify: `src/panel/runDiagnosis.ts` (cause union and classification), `src/control/webProtocol.ts:2099` (cause enum), `web/src/controlTypes.ts:461`, `web/src/locales/en.ts:980-981`, `zh.ts:823-824`
- Test: `tests/panel/runDiagnosis*.test.ts` (extend) or new `tests/panel/parallelClaimDiagnosis.test.ts`

**Interfaces:**
- Consumes: `offPlanEntryOf` (Task 3).
- Produces: diagnosis cause `"parallel-claim"` with optional `siblings: string[]` on the diagnosis; `export function parallelClaimOf(stopReason: string | undefined, contract: TaskContract, siblings: readonly SiblingClaims[]): { path: string; repoKey: string | null; siblingIds: string[] } | null` — parses `denylist match: <path>` or `denylist match: <key>:<path>` (the key must be one of the contract's `additionalRepos[].key`, so a `:` in a path is not misread), and returns the siblings whose claim matches the path with ccloop's rule (exact, `<dir>/**` prefix, `**`). A match on a protected path only ⇒ `null` (unchanged protected-path stop).
- en `cause`: `"The run wrote a file another task of this group is changing at the same time"`; en `next`: `"Orca retries it after that task lands (orca task retry --after <task>)"`; zh to match.

- [ ] **Step 1: Failing tests:** sibling exact claim; sibling `src/board/**` claim; extra-repository key with a `:` in the path; protected path only ⇒ not `parallel-claim`; a v3 run's denylist stop ⇒ unchanged cause.
- [ ] **Step 2–4:** fail, implement, `npm test`; mutations: drop the key check; drop the protected-path exclusion — each red.
- [ ] **Step 5: Commit** `feat(panel): a stop on a parallel sibling's claim is diagnosed parallel-claim (#346 W4)`.

### Task 6: `retry-task --after` and the orca-auto pass

**Files:**
- Modify: `src/control/webProtocol.ts:851` (`retryTaskPayloadSchema` gains `after: idSchema.optional()`), `src/control/retryTask.ts` (`applyRetryTask`), `src/control/webService.ts` (new orca-auto pass beside the worker-lost and quota retries, ~`:1087`–`:1229`), `src/commands/domains/work.ts` (CLI `--after <taskId>`), the Web problem row's action (same place that offers retry for a blocked run), locales
- Test: new `tests/control/parallelClaimRetry.test.ts`

**Interfaces:**
- Consumes: `parallelClaimOf`, `offPlanEntryOf`, `replaceTaskInSnapshot(…, siblings)`, `deriveContract(…, siblings)`.
- Produces: in `applyRetryTask`, with `after`:
  - refuse `after-with-observed-paths` when `allowObservedPaths` is also set;
  - refuse `after-not-a-sibling` unless `after` is in the task's frozen siblings;
  - refuse `after-cycle` when appending `after` to the work item's `dependsOn` makes the group's work graph cyclic (the check `src/control/graph.ts` already does);
  - otherwise, in the same transaction as the retry: work item `dependsOn` = sorted unique(`dependsOn` ∪ [`after`]); the task's entry loses `after`'s claims; the derived contract is re-derived and `replaceTaskInSnapshot` stores both; the `task-retried` activity body carries `after`.
  - orca-auto pass: for each task whose current run is `blocked_waiting_human` and diagnosed `parallel-claim`, issue `retry-task` with `after` = the first sibling id, command id `orca-auto-parallel-claim-${taskId}-${runId}`, actor `ORCHESTRATION_ACTOR`, once per run; funding refusals go through `autoRetryFundingRefusal` and are recorded the way the ladder records `ladder-skipped`.

- [ ] **Step 1: Failing tests:** `"a person's --after adds the sibling to dependsOn, drops its claims and re-derives"`; `"the task does not dispatch until the sibling is done"` (dependency gating); `"--after a task that is not a frozen sibling is refused"`; `"two siblings blocked on each other: the second auto retry is refused after-cycle and stays for a person"` (Review Focus 1); `"the auto pass retries once per run"`; `"an auto retry refused for funding is recorded and a person's --after still works"` (Review Focus 5); `"--after with --allow-observed-paths is refused"`.
- [ ] **Step 2–4:** fail, implement, `npm test`; mutations: skip the cycle check; skip the once-per-run guard; keep the sibling's claims — each red.
- [ ] **Step 5: Commit** `feat(control): retry a parallel-claim stop after its sibling, by hand or as orca-auto (#346 W4)`.

### Task 7: End to end with real ccloop, and the spec correction

**Files:**
- Create: `tests/control/offPlanWritesE2E.test.ts` (model it on `tests/control/observedPathRetryE2E.test.ts`; `ORCA_CCLOOP_BIN` = `/Users/biran/code/skills/orca/ccloop/dist/cli.js`)
- Modify: `docs/superpowers/specs/2026-11-17-off-plan-writes-design.md` (append "Correction 1 (plan 2026-11-18)": the three decisions above)

- [ ] **Step 1: Tests** (spec acceptance 3–5): a v4 task writing an unlisted file in an unclaimed directory lands and `off-plan-write` names it; a task writing its parallel sibling's claimed file stops `blocked_waiting_human`, its diagnosis is `parallel-claim` naming the sibling, and the orca-auto pass re-dispatches it only after the sibling lands, then it lands; the #345 shape (`board-cli` with `targetPaths: [src/cli.js, test/board-cli.test.js]` writing `src/board/cli.js`) lands.
- [ ] **Step 2:** run them; they must pass on the merged Tasks 1–6 (they are integration criteria, not red-first; say so in the commit). Mutation: Task 3's derivation off ⇒ the sibling case lands instead of stopping (red).
- [ ] **Step 3:** append the spec Correction.
- [ ] **Step 4: Commit** `test(control): off-plan writes end to end with real ccloop (#346 acceptance 3-5); spec Correction 1`.
