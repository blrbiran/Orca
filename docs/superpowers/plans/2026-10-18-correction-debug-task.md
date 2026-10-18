# Correction Debug Task Implementation Plan

> **Depends on the control-run decisions plan (`docs/superpowers/plans/2026-10-18-control-run-decisions.md`, spec
> `docs/superpowers/specs/2026-10-18-control-run-decisions-design.md`), which is implemented and merged FIRST.** This
> plan consumes these from it by name and re-plans none of them (table "Consumed from the decisions plan" below):
>
> - the shared landing-commit ledger writer `writeRunLedger`, as `stepD` and `finishReconcile` call it;
> - `readLedgerAtRef`, `ledgerSources` and `findDecision`;
> - the pending items `pending-<ledgerRun>-<i>`;
> - the run-result adapter `reportedDecisionsOf` and `ExecutionReport.decisions`;
> - the widened correction schema and `correction-target-not-a-decision`;
> - the reject verb `reject-pending-decision`.
>
> Before Task 1, the precondition command in Global Constraints must exit 0.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recorded correction opens one independent debug group, in code and spending nothing. The group's agent
reproduces the problem with a failing test and then fixes it. Its landing commit carries the closing ledger rows, so the
correction counts as closed once those rows reach the integration target.

**Architecture:** A new control verb `correction-debug-open` reads the stored correction and the evidence it names
(decision or pending entry, original run, diff, contract). It turns them into an in-memory `ControlPlanV1` with one
task and imports that plan through `writeImportedPlan`, in a new mode that writes no estimate row. Two pieces of Orca
code join the existing driver: a reproduce-first check in `stepC`, and a closing-rows contribution to the decisions
plan's landing writer. Closed-ness is computed on read from the target ref, never stored. Two human-only verbs,
`correction-record` and `correction-close`, plus a corrections list, give the web UI and the agent path the whole flow.

**Tech Stack:** TypeScript (ESM, Node), zod, node:sqlite control store, git CLI, vitest (root `tests/**/*.test.ts`;
web `web/tests/**/*.test.tsx`), React 19 + i18next (web).

**Spec:** `docs/superpowers/specs/2026-10-18-correction-debug-task-design.md`. §12 overrides earlier sections where they
disagree, and §9a holds where §12 is silent. It builds on `2026-10-18-control-run-decisions-design.md` §10. Executors
read both specs, plus `docs/handoff/goal.md` §1.1/§1.2.

## Global Constraints

- **Precondition (Rule 4), run before Task 1; it must print `exit=0`:**
  `npx tsx scripts/check-debug-task-preconditions.ts > "$LOGS/pre.log" 2>&1; echo "exit=$?"`. Task 1 Step 1 creates
  this script. It imports every name in the table below and asserts on each one:
  - `typeof` each function is `"function"`: `readLedgerAtRef`, `ledgerSources`, `findDecision`, `readPendingDecision`,
    `reportedDecisionsOf`, `writeRunLedger`, `normalizeAgentEntry`, `runEvidence`, `exportLedgerDir`,
    `treeWithLedgerFiles`, `prepareRejection`, `applyRejectPendingDecision` and `savedReport`.
  - `VERB_ACCESS["reject-pending-decision"] === "human-only"`.
  - `CORRECTION_FIELDS` includes `"runId"` and `"pendingId"`.
  - `correctionSchema.safeParse({…, runId, pendingId})` with no `decisionId` succeeds. The same row with both
    `decisionId` and `pendingId` fails.
  - `durableCommandErrorStatuses["correction-target-not-a-decision"] !== undefined`, or the `CorrectRejection` constant
    by that name exists. Whichever form T10 used decides how Task 11 maps the code.

  If any name differs in the merged decisions plan, edit **only that table and the script**: every task refers to these
  names through the table.
  If a capability is missing outright, stop and report it (CLAUDE.md Rule 1, step 3: the dependency order is the
  human's).
- `LOGS` is the executor's scratch directory. Every verification run is redirected to a file and the whole file is
  read back, never piped through `grep`/`tail` (Rule 14): `<cmd> > "$LOGS/<name>.log" 2>&1; echo "exit=$?"`.
- Single test file: `npx vitest run <path>`. Web test file: `npm --workspace web exec -- vitest run <path>`. Whole gate:
  `npm run verify`.
- **Every new branch gets a test that fails without it, and a named mutation (`M-<task>.<n>`) seen red** (Rule 9).
  Mutations run **only** in `git clone --local <repo> "$LOGS/mut-clone"`. The main worktree is never touched. Restoration
  is proven by `git -C "$LOGS/mut-clone" diff | wc -c` and `git -C "$LOGS/mut-clone" diff --cached | wc -c`, both `0`
  (Rule 15). Task 15 runs the whole table; each task also runs its own.
- No assertion may read back a value the test itself wrote before the call under test (Rule 9 corollary 2). Git
  assertions read `git show <commit>:<path>`, not a function's return value.
- Rule 17: tests set `ORCA_CORRECTIONS_DIR` to a `mkdtemp` directory and use temp git repos and temp control dirs.
  `tests/setup/relocateUserData.ts` already fails a run that touches the real `~/.orca`. New directories and files keep
  the store's explicit modes (`CORRECTIONS_DIR_MODE` 0700, `CORRECTIONS_FILE_MODE` 0600, `src/corrections/paths.ts`).
- Published text is never edited (Rule 13). Corrections to specs and to published code comments go in a dated
  `*** ERRATUM (2026-10-18, …) ***` note **beside** the original, matching `src/corrections/record.ts`.
- Exact copy pinned by the spec: agent-written suffix `（agent 写，人未填）`; Orca-generated suffix `（Orca 生成，人未填）`;
  generated `undo.how` = `git revert --no-edit <attemptSha>` with the 40/64-hex sha; skipped-reproduction label `未复现`.
- Group ids: `debug-<correctionId>`, then `debug-<correctionId>-2`, `-3`, …. The spec says nothing more about the group
  id itself. The fix run id stays `deriveFixRunId(row, id)` (`src/corrections/fields.ts:77`), unchanged.
- Integration is tested with `local` only. `push-target`, `push-branch` and `github-pr` closing are **untested**, and the
  final report must say so (Rule 12; handoff §4.2 item 16).
- Paid runs: none in this plan's tests. The one paid end-to-end run (spec §8) is listed as `awaitingHuman` in Task 15.
- Code, comments, spec errata and commit messages are in English. The only Chinese text is the spec-pinned UI and ledger
  copy above, plus the zh locale. Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never push (Rule 15: push stays with the human). Since `be13bef6` the gate lets the controller `git merge --ff-only` into `main`, `git branch -d` a merged branch and `git worktree remove` without force; forced forms stay blocked.

### Consumed from the decisions plan (names as that plan defines them; the precondition script pins them)

Ids used throughout:

- Agent ledger entry: `<ledgerRun>/agent-<i>`.
- Reconcile template: `<ledgerRun>/1`, where `ledgerRun` is `<runId>` or `reconcile-<runId>`.
- Pending item: `pending-<ledgerRun>-<i>`.

| Name (module) | Signature / shape | Decisions-plan task | Used by |
|---|---|---|---|
| widened correction schema (`src/corrections/schema.ts`, `fields.ts`) | `decisionId?`, `runId?`, `pendingId?`. `superRefine` requires exactly one of `decisionId` or both `runId`+`pendingId`. `CORRECTION_FIELDS` appends `"runId","pendingId"`. Existing ids are unchanged, which that plan's `pendingTarget.test.ts` pins. Readers skip pending-target rows. `orca correct --close` on one is refused with `correction-target-not-a-decision` | T10 | T1, T2, T6, T9, T11 |
| `readLedgerAtRef` (`src/control/ledgerAtRef.ts`) | `readLedgerAtRef(repo: string, ref: string): Promise<Array<{ path: string; value: unknown }> \| null>`. `null` means the ref does not resolve. Archives are included | T8 | T10 |
| `ledgerSources`, `findDecision`, `DecisionWhere` (same module) | `ledgerSources(store, repo, groupId): Promise<Array<{ where: DecisionWhere; ref: string \| null }>>`, ordered working tree → target → `refs/heads/orca/<groupId>`. `findDecision(repo, sources, id): Promise<{ where; value } \| null>`. `DecisionWhere = "working-tree" \| "target" \| "group-branch"` | T8 | T3, T6 |
| pending store (`src/control/pendingDecisions.ts`) | `readPendingDecision(store, pendingId): PendingDecisionRow \| null`. `PendingDecisionRow = { pendingId; groupId; runId; state; entry: PendingEntry; approvedId; correctionId }`. `PendingEntry` (`src/control/runLedger.ts`) `= { pendingId; ledgerRun; entryIndex; entry: unknown; reason; at; evidence }` | T4, T2 | T3 |
| run-result adapter (`src/control/reportedDecisions.ts`) | `reportedDecisionsOf(result: unknown): ReportedDecisions` reads the top-level `decisions` key. `ExecutionReport.decisions?: unknown` (`src/control/executionPort.ts`). The stored report is read with `savedReport(store, runId)` (`src/control/executionDriver.ts:742`) | T1 | T8 (adds the `debug` sibling) |
| landing writer (`src/control/runLedger.ts`, `src/control/ledgerTree.ts`, `src/control/driverLanding.ts`) | `writeRunLedger(decisionsDir, { ledgerRun, reported, codeAuthored, at, evidence }): Promise<{ writtenIds; pending }>`; `normalizeAgentEntry`; `runEvidence(runId, attemptSha, ccloop)`; `runLedgerInputs(deps, runId)`. `stepD`: `merge --no-commit` → `writeRunLedger(join(landing,".decisions"), …)` → `git add -f .decisions/<runId>.jsonl` → commit. `finishReconcile`: `exportLedgerDir(copy, tree, tmp)` → `writeRunLedger(tmp, …)` ×2 → `treeWithLedgerFiles(copy, tree, tmp, namesWritten)` | T2, T5, T6 | T9 |
| reject verb (`src/control/decisionCommands.ts`) | verb `reject-pending-decision` (human-only), route `POST /api/control/groups/:groupId/decisions/reject`. `prepareRejection(store, repo, correctionsDir, command, now)` → `{ kind: "recorded"; correctionId } \| { kind: "refused"; … }`. `applyRejectPendingDecision(deps, command, prepared)` → result `{ kind: "pending-decision-rejected", pendingId, correctionId }`. It does **not** open a debug group | T10 | T12 |
| `WebServiceDeps.correctionsDir?: string` (`webService.ts:71`, passed by `controlAssembly.ts:202`) | the corrections store directory for the control service | T10 | T6, T10, T11 |

## Review Focus

1. **A correction whose decision is only on an unintegrated group branch.** `findDecision` answers
   `where: "group-branch"`. The debug group branches from the target, so `appendEvents` check 5 would refuse
   the `overturned` row at landing, after money was spent. Expected: the open is refused up front with
   `correction-decision-not-integrated`, and the correction stays recorded. Pinned in Task 6.
2. **Integration by `squash`.** The landing commit is never an ancestor of the target, so §12.1's literal
   `merge-base --is-ancestor` would never close the correction. Expected: closed exactly when the target ref's tree
   holds the closing rows. Pinned in Task 10 with a `local`/`squash` fixture.
3. **A debug group with no estimate row.** Panel and summary readers, the archive guard, and `createEstimate`'s
   `MAX(estimate_version)` must work on a group that has never been estimated. Expected: the group view renders, the
   first `estimate` creates version 1, and archive works. Pinned in Task 5.
4. **The reproduce check leaving the run's workspace dirty or on the wrong commit.** Step D merges `attemptSha`, and any
   leftover working-tree change would ride into the copy. Expected: after the check, `HEAD == attemptSha`, the same
   symbolic ref is checked out, and `git status --porcelain` is empty. Pinned in Task 8.
5. **The debug group's closing rows when the human already closed it by hand.** Possible after a stop followed by
   unarchive and start, or with the CLI `--close`, which knows no control DB. Expected: no second
   `decision`/`overturned` pair is written. `alreadyCommitted` finds the rows, and the group records
   `closing.state = "closed-by-human-first"`. Pinned in Task 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/check-debug-task-preconditions.ts` (new) | Precondition gate over the consumed names (Rule 4) |
| `src/corrections/target.ts` (new) | `correctionTargetOf`: the one place that reads which target a correction names |
| `src/metrics/{resolve,compute,collect,types,report}.ts` | Exclude pending-target corrections from the rates; add their own count line |
| `src/control/debugInput.ts` (new) | Read and freeze the evidence (`DebugInputV1`) for one correction; git and DB reads only |
| `src/control/debugPlan.ts` (new) | Pure transform `DebugInputV1` → `SchedulerControlPlanSource` (goal text, contract, write set, agent layer) |
| `src/control/planImport.ts` | `writeImportedPlan` option `estimate: "deferred"` |
| `src/control/debugGroup.ts` (new) | Verb handler `applyCorrectionDebugOpen`, group-id resolution, `debugGroupLive`, `readDebugMark` |
| `src/control/debugRepro.ts` (new) | Reproduce-first check run from `stepC` |
| `src/control/debugClosing.ts` (new) | Closing rows for a landed debug run, contributed to the landing writer |
| `src/corrections/derive.ts` | `deriveRows` accepts an agent/Orca-authored marker; new `derivePendingRows` |
| `src/corrections/correct.ts` | Extract `closeExistingCorrection` (shared by the CLI `--close` and the `correction-close` verb) |
| `src/control/correctionState.ts` (new) | `correctionClosedState`: computed closed-ness; corrections list read model |
| `src/control/correctionCommands.ts` (new) | Handlers for `correction-record` and `correction-close` |
| `src/control/webProtocol.ts`, `commandLedger.ts`, `errors.ts`, `src/panel/humanOnly.ts`, `src/panel/controlApi.ts`, `src/control/webService.ts`, `src/control/executionDriver.ts` | Verbs, scope, codes, routes, wiring |
| `skills/orca-control/SKILL.md` | Route rows and the corrections read path (agent path) |
| `web/src/{controlApi,controlTypes,CorrectionsView,ControlGroupView,DecisionDetail,App}.tsx/.ts`, `web/src/locales/{en,zh}.ts` | UI |
| `docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md`, `src/corrections/derive.ts:65`, `src/panel/api.ts:290` | Dated corrections; the original text stays verbatim |

---

### Task 1: Precondition gate and the correction target helper

The schema widening, the id-stability criterion and the `--close` refusal (`correction-target-not-a-decision`) are the
decisions plan's Task 10. They are consumed here, not repeated.

**Files:**
- Create: `scripts/check-debug-task-preconditions.ts`, `src/corrections/target.ts`
- Create: `tests/corrections/target.test.ts`

**Interfaces:**
- Consumes: the widened `Correction` (table).
- Produces: `type CorrectionTarget = { kind: "decision"; decisionId: string } | { kind: "pending"; runId: string; pendingId: string }`;
  `correctionTargetOf(row: Correction | CorrectionRow): CorrectionTarget` (throws `CorrectRejection("correction-row-invalid")` on neither or both).

- [ ] **Step 1: Write the precondition script.** It imports each name in the table and asserts its shape with
  `node:assert`. Exit non-zero on the first miss, printing the missing name. Run it and record `exit=0`.
- [ ] **Step 2: Write the failing tests** (`tests/corrections/target.test.ts`):

```ts
it("reads a decision target", () => expect(correctionTargetOf(decisionRow)).toEqual({ kind: "decision", decisionId: "run-…/agent-0" }));
it("reads a pending target", () => expect(correctionTargetOf(pendingRow)).toEqual({ kind: "pending", runId: "run-…", pendingId: "pending-run-…-0" }));
it("reads a pending target whose ledger run is a reconcile", () =>
  expect(correctionTargetOf(reconcilePendingRow)).toEqual({ kind: "pending", runId: "run-…", pendingId: "pending-reconcile-run-…-0" }));
```

- [ ] **Step 3:** Run it (`npx vitest run tests/corrections/target.test.ts`). Expect FAIL: `correctionTargetOf` is not defined.
- [ ] **Step 4:** Implement `correctionTargetOf` in `src/corrections/target.ts`.
- [ ] **Step 5:** Run it. Expect PASS. Mutation **M-1.2**: make `correctionTargetOf` return `decision` for every row.
  Expected: the pending test goes red.
- [ ] **Step 6: Commit** `feat(corrections): read a correction's target in one place`.

### Task 2: Metrics count pending-target corrections on their own line

**Files:**
- Modify: `src/metrics/resolve.ts:66-110` (`resolveOverturned`), `src/metrics/compute.ts:80-110` (`computeMetrics`),
  `src/metrics/collect.ts:170-180`, `src/metrics/types.ts:195-238` (`MetricsReport`, `METRICS_FIELDS`), `src/metrics/report.ts`
- Modify: `web/src/MetricsView.tsx`, `web/src/locales/{en,zh}.ts`
- Test: `tests/metrics/compute.test.ts`, `tests/metrics/resolve.test.ts`, `tests/metrics/report.test.ts`, `web/tests/metricsNotes.test.tsx`

**Interfaces:**
- Consumes: `correctionTargetOf` (T1).
- Produces: `MetricsReport.corrections_on_unrecorded_decisions: number`, inserted in `METRICS_FIELDS` right after
  `"unresolved_decisions"`.

- [ ] **Step 1: Failing tests.**
  - `compute.test.ts` › "a pending-target correction is in neither rate and is counted on its own line". Use a fixture
    with 1 decision, 1 decision-target `wrong` correction, and 1 pending-target `wrong` correction. Assert
    `correction_rate` numerator `1`, repair-rate denominator unchanged from the fixture without the pending row, and
    `corrections_on_unrecorded_decisions === 1`.
  - `resolve.test.ts` › "a pending-target correction is not reported as an unresolved decision".
    `unresolvedDecisions` is `[]` for it.
  - `report.test.ts` › the golden output gains the line. Update the golden in the same step and say so in the commit.
- [ ] **Step 2:** Run. Expect FAIL on the count only (`undefined`). The decisions plan's Task 10 already makes the
  readers skip pending-target rows, so the two "in neither rate" / "not unresolved" tests are expected to **pass on
  first run**. Keep them, because they are the criterion for that skip on this plan's line. They are proven non-vacuous
  by M-2.1.
- [ ] **Step 3:** Implement the count in `computeMetrics`, next to the decisions plan's skip, and point its comment at
  this line. Replace the decisions plan's ad-hoc pending check with `correctionTargetOf(row).kind === "pending"`.
  MetricsView shows the line with the key `metrics.unrecordedDecisionCorrections`.
- [ ] **Step 4:** Run root and web tests. Expect PASS. Mutations: **M-2.1** drop the decisions plan's skip in
  `resolveOverturned`, so the resolve test goes red. **M-2.2** drop the count, so the compute test goes red.
- [ ] **Step 5: Commit** `feat(metrics): report corrections on unrecorded decisions on their own line`.

### Task 3: Freeze the debug input

**Files:**
- Create: `src/control/debugInput.ts`, `tests/control/debugInput.test.ts`

**Interfaces:**
- Consumes: `readCorrections` (`src/corrections/store.ts`), `correctionTargetOf` (T1), `ledgerSources`, `findDecision`,
  `DecisionWhere`, `readPendingDecision`, `PendingEntry` (table), `readRun` (`src/control/budget.ts:29`), `driveRecordSchema` (`src/control/driveRecord.ts`),
  `readArchivedPlan` (`src/control/queries.ts:122`), `groupRepoId` (`src/control/executionDriver.ts`),
  `readGroupIntegration` (`src/control/integrationScheme.ts:187`).
- Produces:

```ts
export const DEBUG_INPUT_SCHEMA = "orca-debug-input-v1";
export const DEBUG_DIFF_INLINE_MAX_BYTES = 65_536;
export interface DebugInputV1 {
  schema: typeof DEBUG_INPUT_SCHEMA;
  correction: Correction;                 // the stored row, verbatim
  decision: DecisionEvent | null;         // decision target
  decisionWhere: DecisionWhere | null;    // which ledger source held it (decisions plan's findDecision)
  pending: PendingEntry | null;           // pending target: readPendingDecision(store, pendingId)!.entry, verbatim
  originalRun: { runId: string; groupId: string; taskId: string; agent: AgentSelection; configHash: string } | null;
  commits: { base: string; attemptSha: string; diff: string } | null; // diff = base..attemptSha, `.decisions/` excluded
  contract: TaskContract | null;          // the original work item's contract (taskContractSchema)
  missing: Array<"run" | "base" | "attemptSha" | "objects" | "contract">; // each omitted piece, named (§12.7)
}
export async function collectDebugInput(deps: { store: ControlStore; repoPath: string; targetRef: string | null }, correction: Correction): Promise<DebugInputV1>;
export function debugRunIdOf(target: CorrectionTarget): string;
// decision: the ledger run `decisionId.split("/")[0]` with a leading `reconcile-` stripped (a reconcile decision is about
// the run it reconciled: `reconcile-<runId>/1` → `<runId>`); pending: `target.runId` (the row's control run)
```

- [ ] **Step 1: Failing tests.** Use a temp repo and a temp control store, seeded through the existing test helpers in
  `tests/control/fixtures` with a `runs` row whose `drive` has `base` and `attemptSha`.
  - "freezes correction, decision, diff and contract for a control-run decision". Assert
    `input.decision!.id === "<run>/agent-0"`, `input.decisionWhere === "target"`, `input.commits!.diff` contains the attempt's changed path and **not**
    `.decisions/`, `input.contract!.objective.taskId === "<task>"`, and `input.missing` is `[]`.
  - "uses base..attemptSha, not base..landedCommit". Seed a `landedCommit` that also contains another task's file;
    assert the diff lacks that file.
  - "a scheduler-era run id has no run": decision `orca-x-1a2b3c4d/1`. Assert `originalRun`, `commits` and `contract`
    are `null`, `missing` equals `["run"]`, and `decision` is present.
  - "unreachable objects are omitted and named". Point `attemptSha` at a sha absent from the repo; assert `commits === null`
    and `missing` contains `"objects"`.
  - "a pending target carries the pending entry". Assert `pending` deep-equals
    `readPendingDecision(store, "pending-<run>-0")!.entry` and `decision === null`.
  - "a reconcile decision resolves to the reconciled run". For decision `reconcile-<run>/1`, assert
    `originalRun.runId === "<run>"`.
- [ ] **Step 2:** Run. Expect FAIL (module missing).
- [ ] **Step 3:** Implement. Find the decision with `findDecision(repo, sources, decisionId)`:
  - When the original run exists: `sources = await ledgerSources(store, repo, originalRun.groupId)`.
  - For a scheduler-era id: `[{ where: "working-tree", ref: null }]`.
  - Store the hit's `where` in `decisionWhere`.

  The diff is `git diff --no-color <base> <attemptSha> -- . ':(exclude).decisions'`, read with `gitChild`
  (`src/control/integrationGit.ts:122`). `cat-file -e` failing means `"objects"`.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-3.1** drop the `.decisions` exclusion. **M-3.2** use `landedCommit`.
  **M-3.3** drop `pending`. **M-3.4** stop naming `"objects"`. Each one turns its own test red.
- [ ] **Step 5: Commit** `feat(control): freeze a correction's evidence for its debug task`.

### Task 4: Build the debug plan (pure)

**Files:**
- Create: `src/control/debugPlan.ts`, `tests/control/debugPlan.test.ts`

**Interfaces:**
- Consumes: `DebugInputV1` (T3), `taskContractSchema` (`src/scheduler/planFile.ts:197`), `canonicalBytes`,
  `sha256Canonical` (`src/control/canonicalJson.ts`), `normalizeControlPlan` (`src/control/planImport.ts`).
- Produces:

```ts
export const DEBUG_TASK_ID = "debug";
export const DEBUG_TEST_DIRS = ["test", "tests", "__tests__", "spec"] as const; // §9a: only those existing at repo root
export const DEBUG_DEFAULT_EXECUTION_POLICY: TaskContract["executionPolicy"]; // used only when the original contract is missing
export function debugGoalText(input: DebugInputV1): string;
export function buildDebugPlanSource(input: DebugInputV1, opts: { repoPath: string; existingTestDirs: string[]; agent: PartialSelection | undefined }): SchedulerControlPlanSource;
export function debugPlanId(groupId: string): string; // `${groupId}-plan`
```

- [ ] **Step 1: Failing tests.**
  - "goal text names the decision, the choice, the reason and the alternative". For `not_my_taste` with
    `chose_instead`, assert the text contains `decision.id`, `decision.chose`, `correction.because`, the
    `chose_instead` value, and the instruction sentence for `not_my_taste` ("change to …"). Assert the same for `wrong`
    and `stale`, each with its own sentence.
  - "goal text tells the agent to reproduce first". It contains the literal steps "add a test that fails on the current
    code" and "declare `reproTests`".
  - "goal text names each missing piece". With `missing: ["run"]`, it contains `commits and contract are unavailable`.
  - "the diff is inlined up to the cap, then named by command". With a diff of `DEBUG_DIFF_INLINE_MAX_BYTES + 1` bytes,
    the inlined part is ≤ the cap and the text contains `git diff <base> <attemptSha> -- . ':(exclude).decisions'`.
  - "write set = targetPaths ∪ allowlistPaths ∪ existing test dirs". Assert `context.targetPaths` deep-equals the sorted
    union. Assert that `tests/` appears only when it is in `existingTestDirs`.
  - "budgets and checks come from the original". `executionPolicy` deep-equals the original's.
    `context.buildTestCommands` and `verification.requiredChecks` deep-equal the original's `buildTestCommands`.
  - "the agent layer is the plan's group `agent`". `source.agent` deep-equals `opts.agent`.
  - "the source normalizes". `normalizeControlPlan({ ...source, repoId, planId })` does not throw, and its single task
    is `DEBUG_TASK_ID`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The contract goes through `taskContractSchema.parse` and its canonical JSON/hash through
  `canonicalBytes`/`sha256Canonical`, as `parseContract` does (`planFile.ts:278-293`). `successConditions` =
  `["the reproduction test added by the debug task fails at the run's base and passes at its attempt", ...original buildTestCommands]`.
  With no original contract, use `DEBUG_DEFAULT_EXECUTION_POLICY` (copy the values from the `TASK_WORK` defaults in
  `src/control/estimator.ts`). Use `targetPaths: ["."]` and `buildTestCommands: ["<to be named by the agent as reproCommand>"]`.
  The human edits the write set before confirming (§4.3).
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-4.1** omit `chose_instead` from the goal. **M-4.2** drop the
  test-dir union. **M-4.3** drop the missing-pieces sentence. **M-4.4** remove the cap. Each one turns its own test red.
- [ ] **Step 5: Commit** `feat(control): build a debug task's plan from its frozen input`.

### Task 5: Import with no estimate (opening spends nothing)

**Files:**
- Modify: `src/control/planImport.ts:258-388` (`writeImportedPlan`)
- Modify, only where the Step 1 tests go red: `src/panel/controlViews.ts`, `src/control/webService.ts:437` (`createEstimate`)
- Test: `tests/control/planImport.test.ts`, `tests/panel/controlReadApi.test.ts`, `tests/control/archiveGroup.test.ts`

**Interfaces:**
- Produces: `writeImportedPlan(deps, input, carry, opts?: { estimate: "preflight" | "deferred" }): { estimateId: string | null; preflight: FrozenEstimateRequest | null }`.
  The default is `"preflight"` and keeps today's behaviour byte for byte. With `"deferred"`, no `estimates` row, no
  `persistEstimateArtifacts` and no `scheduler_wakes` row are written. The reserve follows the non-queued branch
  (`explicitUnallocatedReserve = initialReserve + ESTIMATE_GRANT`), and `estimatorSlot: null`.

- [ ] **Step 1: Failing tests.**
  - `planImport.test.ts` › "a deferred import writes no estimate and reserves nothing anywhere else". Capture
    `committedTokens(store, "all", null)` and `SELECT COUNT(*) FROM scheduler_wakes` before the import. Import in
    deferred mode. Then `SELECT COUNT(*) FROM estimates WHERE group_id=?` is `0`, wakes are unchanged,
    `committedTokens` is unchanged, the group's `ledger.committedRemaining` excludes `ESTIMATE_GRANT`, and
    `explicitUnallocatedReserve` equals the value a `blocked-capability` import of the same plan produces.
  - `planImport.test.ts` › "the preflight default is unchanged". The existing import fixtures' stored bytes are
    byte-equal to their pre-change goldens.
  - `controlReadApi.test.ts` › "a never-estimated group renders". `GET /api/control/groups/<id>` returns 200 with no
    estimate.
  - `webService` estimate test › "the first estimate of a deferred group is version 1".
  - `archiveGroup.test.ts` › "a never-estimated draft archives".
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the option. Change readers only where Step 1 is red (Rule 3).
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-5.1** insert the estimate row in deferred mode (the count test goes
  red). **M-5.2** add `ESTIMATE_GRANT` to `committedRemaining` in deferred mode (the reserve test goes red).
- [ ] **Step 5: Commit** `feat(control): import a plan without queuing an estimate`.

### Task 6: The `correction-debug-open` verb

**Files:**
- Create: `src/control/debugGroup.ts`, `tests/control/debugGroup.test.ts`
- Modify: `src/control/webProtocol.ts` (`commandVerbSchema` :599, the raw and effective variants :882/:937, payload
  schema, success result kind near :1588, `groupSummarySchema` :1060 gains optional `debug`)
- Modify: `src/panel/humanOnly.ts` (`VERB_ACCESS`, `HUMAN_ONLY_FIELDS`), `src/panel/controlApi.ts` (route table near
  :457, dispatch switch near :544), `src/control/webService.ts` (method `openCorrectionDebugGroup(command)`), `src/control/errors.ts` (codes),
  `src/panel/controlConfig.ts` (`listRepositories`), `src/panel/controlViews.ts` (summary `debug`)
- Modify: `skills/orca-control/SKILL.md` (route row), `tests/entry/skill.test.ts` (`schemaByVerb`), `web/src/locales/{en,zh}.ts` (codes)
- Test: `tests/control/debugGroup.test.ts`, `tests/panel/controlApi.test.ts`, `tests/panel/permissions.test.ts`, `tests/panel/refusalCoverage.test.ts`

**Interfaces:**
- Consumes: T1, T3, T4, T5. `readCorrections`, `correctionsDir` (`src/corrections/paths.ts:13`), `projectKeyOf`
  (`src/corrections/projectKey.ts:61`), `alreadyCommitted` (`src/corrections/gitState.ts:209`), `deriveFixRunId`,
  `deps.port.resolveAgent` (`src/control/executionPort.ts:46`), `readDefaultWorkerSelection` = the
  `operatorDefaultSelection` logic in `src/panel/controlApi.ts:120` (move it to `src/control/agentPreferences.ts` and export it).
- Produces:

```ts
// webProtocol.ts
export const correctionDebugOpenPayloadSchema = z.object({
  correctionId: z.string().regex(/^c_[a-f0-9]{16}$/), reopen: z.boolean().optional(), undoHow: nonemptyString.optional(),
}).strict();
// result: { kind: "debug-group-opened"; groupId: string; correctionId: string; created: boolean }
// groupSummary.debug?: { correctionId: string; ordinal: number }
// debugGroup.ts
export interface DebugMark { correctionId: string; ordinal: number; inputHash: string; missing: DebugInputV1["missing"];
  agentFallback: { original: PartialSelection; reason: string } | null; undoHow: string | null; closing: ClosingRecord | null }
// declared here (null at open), filled by Task 9:
export type ClosingRecord = { state: "written"; relPath: string; fixRunId: string } | { state: "refused"; reason: string }
  | { state: "chose-instead-missing" } | { state: "closed-by-human-first"; commit: string };
export function readDebugMark(group: unknown): DebugMark | null;
export function debugGroupIds(store: ControlStore, correctionId: string): string[];   // ordinal order
export function debugGroupIdFor(store: ControlStore, correctionId: string, reopen: boolean): string; // route target resolver
export function debugGroupLive(store: ControlStore, groupId: string): boolean;        // !archived && !groupStopped
export async function applyCorrectionDebugOpen(deps: DebugOpenDeps, command: CorrectionDebugOpenCommand): Promise<WebCommandResult>;
export interface DebugOpenDeps extends WebServiceDeps { listRepositories: () => Array<{ repoId: string; path: string }> }
// uses WebServiceDeps.correctionsDir (decisions plan T10), falling back to correctionsDir(process.env) as that plan's reject does
```

Route: `POST /api/control/corrections/:correctionId/debug-group`, verb `correction-debug-open`. The target is
`{ kind: "group", groupId: debugGroupIdFor(store, correctionId, payload.reopen === true) }`. `VERB_ACCESS` is `"any"`.
`HUMAN_ONLY_FIELDS["correction-debug-open"] = ["undoHow"]`, because an agent-supplied value would be recorded as the
human's.

New durable codes (`errors.ts`), each with an en/zh entry:

| Code | Status | When |
|---|---|---|
| `correction-not-found` | 404 | no stored row with that id |
| `correction-already-closed` | 409 | `alreadyCommitted(repo, .decisions/<fixRunId>.jsonl, id)` finds the rows (§9a) |
| `correction-repository-unknown` | 404 | no configured repository's `projectKeyOf(path)` equals the row's `projectKey` |
| `correction-decision-not-integrated` | 409 | `input.decisionWhere === "group-branch"` (Review Focus 1) |
| `debug-group-not-reopenable` | 409 | `reopen` while the newest debug group is live |

- [ ] **Step 1: Failing tests** (`tests/control/debugGroup.test.ts`, temp repo plus temp control dir plus
  `ORCA_CORRECTIONS_DIR`):
  - "opens one group whose frozen plan holds the correction, decision, diff and contract". After the open,
    `readArchivedPlan(store, "debug-<cid>").plan.tasks[0].originalContractCanonicalJson` contains the decision id and
    the diff's changed path. `readCanonicalRecord(store, mark.inputHash)` parses to a `DebugInputV1` deep-equal to
    `collectDebugInput`'s output.
  - "opening again returns the same group". The same command replays. A new command with the group's current revision
    returns `created: false`. `SELECT COUNT(*) FROM groups WHERE id LIKE 'debug-<cid>%'` is `1`.
  - "opening spends nothing". Estimates count `0`; `committedTokens` unchanged.
  - "agent default = the original claim's agent and model". Fixture: the original claim's agent `codex` differs from
    the operator default `claude`, and the fake port resolves both. Assert `plan.agent` deep-equals
    `{ agent: "codex", model: <original model> }` and `agentFallback === null`.
  - "an unresolvable original agent falls back to the operator default and says why". The fake port throws for
    `codex`. Assert `plan.agent` is absent and `agentFallback.reason` names the port's error code.
  - "refuses a closed correction" (`correction-already-closed`); "refuses an unknown repository"
    (`correction-repository-unknown`); "refuses a decision only on a group branch" (`correction-decision-not-integrated`).
    In each case the corrections store bytes are unchanged (read the file before and after).
  - "a stopped group is returned with its state; Reopen makes -2". Archive `debug-<cid>`. Open without `reopen`, which
    returns it. Open with `reopen: true`, which creates `debug-<cid>-2` with `ordinal: 2`. A second `reopen` while
    `-2` is live → `debug-group-not-reopenable`.
  - `permissions.test.ts` › "an agent may open but may not send `undoHow`" → `control-field-human-only`.
  - `refusalCoverage.test.ts` stays green, with the new codes added to the locales.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. All reads happen before `applyWebCommand`: store row, repository lookup, `collectDebugInput`,
  existing test dirs, and `port.resolveAgent` on the original `{agent, model}`. Any failure is persisted through the
  `expand: () => { throw error }` pattern (`webService.ts:466`). Inside the transaction, re-read the group (`created`
  vs existing), `writeCanonicalRecord(store, groupId, inputHash, …)`, `normalizeControlPlan(buildDebugPlanSource(…))`,
  then `writeImportedPlan(…, null, { estimate: "deferred" })`. Set `group.debug = DebugMark` in the same update.
  `repoId` = the matched configured repository. A route target resolver reads the store, as `recovery-retry`'s does
  (`controlApi.ts:421`).
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-6.1** drop the `decision` from the frozen input (plan test red).
  **M-6.2** skip the existing-group lookup (count test red). **M-6.3** copy the original `configHash` instead of
  re-resolving: `plan.agent` keeps it and the fallback test goes red. **M-6.4** remove `undoHow` from
  `HUMAN_ONLY_FIELDS` (permissions test red). **M-6.5** remove the group-branch guard.
- [ ] **Step 5: Commit** `feat(control): a correction opens its debug group`.

### Task 7: The debug run is a fresh session

**Files:**
- Test only: `tests/control/debugGroup.test.ts` (extend), using the existing confirm/start fakes from
  `tests/control/executionDriver.test.ts`.

**Interfaces:**
- Consumes: T6. `claimWork` (`src/control/budget.ts:120-170`, mints `run-<uuid>`), `claimContinuation`
  (`src/control/continuation.ts:32`).

- [ ] **Step 1: Failing test** › "the debug run has its own run id and no input checkpoint". Open, confirm and start
  with the fake port. Assert the claimed run's `runId` is not the original run's, `inputCheckpoint === null` in its
  start envelope, and `claimContinuation` with the original run as predecessor throws (group/work-item mismatch,
  `continuation.ts:37`).
- [ ] **Step 2:** Run. It is expected to **pass on first run**: no new code is needed (§4.4). Prove it is not vacuous
  with **M-7.1**: in the clone, make `claimWork` reuse `meta.predecessorRunId ?? "run-"+uuid` and pass the original id
  in the test harness. Expect red, then revert.
- [ ] **Step 3: Commit** `test(control): pin that a debug run starts a fresh session`.

### Task 8: Reproduce-first check in `stepC`

**Files:**
- Create: `src/control/debugRepro.ts`, `tests/control/debugRepro.test.ts`
- Modify: `src/control/executionDriver.ts:609-616` (between the out-of-bounds check and the `collected` write)
- Modify: `src/control/reportedDecisions.ts` (add the `debug` sibling adapter) and `src/control/executionPort.ts`
  (`ExecutionReport.debug?: unknown`, a one-line comment saying it is optional like `decisions`)
- Modify: `web/src/locales/{en,zh}.ts`, `tests/panel/refusalCoverage.test.ts` (blocked-reason prefix `debug-repro`)

**Interfaces:**
- Consumes: `reportedDecisionsOf`'s module and `savedReport(store, runId)` (table), `readDebugMark` (T6), `blockRun`
  (`executionDriver.ts:171`), `gitChild`.
- Produces. The adapter sits in `src/control/reportedDecisions.ts`, beside `reportedDecisionsOf`, so that one module
  stays the only place that knows where an agent's reported values live in a run result. The decisions plan's ccloop
  contract task (its Task 12) moves both together:

```ts
// src/control/reportedDecisions.ts
export type ReportedDebug = { kind: "absent" } | { kind: "object"; value: DebugResult } | { kind: "malformed"; value: unknown };
export function reportedDebugOf(result: unknown): ReportedDebug; // reads only the top-level `debug` key, like reportedDecisionsOf
// src/control/debugRepro.ts
export const debugResultSchema = z.object({
  choseInstead: z.string().min(1).optional(),
  reproTests: z.array(z.string().min(1)).optional(),
  reproCommand: z.string().min(1).optional(),
  reproduction: z.literal("not-expressible").optional(),
  reproductionReason: z.string().min(1).optional(),
}).strict();
export type DebugResult = z.infer<typeof debugResultSchema>;
export async function readDebugResult(store: ControlStore, runId: string): Promise<DebugResult>;
// = reportedDebugOf(await savedReport(store, runId)): "object" → value; "absent" → {}; "malformed" → {} and the check
//   answers { kind: "failed", reason: "result-invalid" } unless Orca can compute reproTests (rule 1 below)
export type ReproVerdict = { kind: "passed"; tests: string[]; command: string } | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: "no-tests" | "no-command" | "green-at-base" | "red-at-head" | "result-invalid" };
export async function checkReproduction(input: { workdir: string; base: string; attemptSha: string; result: DebugResult;
  contract: TaskContract; timeoutMs: number }): Promise<ReproVerdict>;
```

Algorithm, in the run's own workspace `join(drive.sourceDir, "repo")`, where its dependencies already are:

1. `tests` = `result.reproTests`. When absent, Orca computes them: paths added (`--diff-filter=A`) in `base..attemptSha`
   under a `DEBUG_TEST_DIRS` root or matching `/(\.test|\.spec|_test)\.[^/]+$|(^|\/)test_[^/]+\.py$/` (Rule 5).
2. `command` = `result.reproCommand ?? contract.context.buildTestCommands[0]`. If the original contract was missing,
   the placeholder from T4 does not count: `no-command`.
3. At `attemptSha`, run `sh -c command` (timeout `contract.executionPolicy.perAttemptTimeoutMs`). A non-zero exit gives `red-at-head`.
4. Remember `git symbolic-ref -q HEAD`. Run `git checkout --detach <base>`, then `git checkout <attemptSha> -- <tests…>`,
   then run the command. Exit `0` gives `green-at-base`.
5. Always, in a `finally`: `git checkout --force <remembered ref or attemptSha>`, then `git clean -fdq -- <tests…>`.

`stepC` reads the result from the report it has just collected: `reportedDebugOf(report)` on the in-memory
`ExecutionReport`. Task 9, at landing, reads the stored copy through `readDebugResult` (`savedReport`), the same way
`runLedgerInputs` reads `decisions`.

In `stepC`, only for a run whose group has a `DebugMark`: `passed`/`skipped` proceed, and `skipped` stores
`drive.debugRepro = { state: "skipped", reason }` so the panel shows `未复现`. `failed` →
`blockRun(deps, runId, "C", "debug-repro:<reason>", { outcome: "repro-failed", attemptSha })`, which
`isTerminallyFailedRun` treats like any failed verification. `drive.debugRepro` is a new optional field in
`driveRecordSchema`, defaulted for old records.

- [ ] **Step 1: Failing tests** (temp repo; command `sh -c 'test -f fixed.txt'` style, so no real toolchain is needed):
  - `reportedDecisions.test.ts` › "reportedDebugOf reads only the top-level debug key". It returns `absent` for
    `{ events: [] }` and for `null`, `object` for a valid value, and `malformed` for `{ debug: "x" }`. Mutation
    **M-8.6**: read `result.decisions.debug`. Expected: red.
  - "red at base and green at head passes".
  - "green at base fails the attempt" → `{ kind: "failed", reason: "green-at-base" }`.
  - "red at head fails" → `red-at-head`.
  - "not-expressible skips with its reason" → `skipped`, and no command runs (spy on a marker file the command would create).
  - "absent reproTests are computed from added test files".
  - "the workspace is restored". After each case, `git rev-parse HEAD` is `attemptSha`, `git symbolic-ref -q HEAD`
    equals the value before, and `git status --porcelain` is `""` (Review Focus 4).
  - driver test (`tests/control/driverLanding.test.ts` harness) › "a failed check blocks the debug run at C and does not
    land". The run's state is `blocked`, `blockedReason` starts with `debug-repro:`, and the group branch tip is unchanged.
  - driver test › "a non-debug run is never checked". `checkReproduction` is not called (an injected spy).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-8.1** skip the base run (green-at-base test red). **M-8.2** skip the
  head run (red-at-head red). **M-8.3** drop the `finally` restore (restore test red). **M-8.4** drop the debug-group
  condition (non-debug test red). **M-8.5** ignore `not-expressible` (skip test red).
- [ ] **Step 5: Commit** `feat(control): Orca checks a debug fix was reproduced before it lands`.

### Task 9: Closing rows ride the debug run's landing commit

**Files:**
- Create: `src/control/debugClosing.ts`, `tests/control/debugClosing.test.ts`
- Modify: `src/corrections/derive.ts` (`DeriveInput`, new `derivePendingRows`)
- Modify: `src/control/driverLanding.ts`, where the decisions plan's `stepD` and `finishReconcile` call `writeRunLedger`.
  Each gets one call more. The empty-result ledger-only commit (`commitLedgerOnGroupBranch`, decisions plan Task 7) gets
  none: an empty result landed no fix, so the correction stays open.
- Test: `tests/corrections/derive.test.ts`

**Interfaces:**
- Consumes: `deriveRows` (`src/corrections/derive.ts:46`), `deriveFixRunId`, `alreadyCommitted`, `readDebugResult`
  (T8), `readDebugMark` (T6), `PendingEntry` (table). From the decisions plan's landing seam (table): the
  `decisionsDir` that `writeRunLedger` was just given, which is `join(landing, ".decisions")` in `stepD` and the
  `exportLedgerDir` tmp dir in `finishReconcile`.
- Produces:

```ts
// derive.ts
export const AGENT_WRITTEN = "（agent 写，人未填）";
export const ORCA_GENERATED = "（Orca 生成，人未填）";
export interface DeriveInput { /* existing */ authored?: { choseInstead: "human" | "agent"; undoHow: "human" | "orca" } }
export function derivePendingRows(input: { correction: Correction; pending: PendingEntry; // PendingEntry.entry is the agent's raw entry
  choseInstead: string; undo: { how: string }; at: string; runId: string; authored: DeriveInput["authored"] }): { decision: DecisionEvent };
// debugClosing.ts (ClosingRecord is Task 6's)
export async function writeDebugClosing(input: { store: ControlStore; run: RunRecord; repo: string; decisionsDir: string;
  attemptSha: string; now: () => Date }): Promise<{ written: string | null /* "<fixRunId>.jsonl" */; record: ClosingRecord }>;
// stepD: after writeRunLedger, `if (written) git add -f .decisions/<written>` (same -f as the decisions plan, Review Focus 1 there)
// finishReconcile: `written` is appended to `namesWritten` before treeWithLedgerFiles
```

The rules (spec §5, §12.5, §12.6):

- `chose_instead` = the row's `chose_instead`. If the row has none, use the debug result's `choseInstead` + `AGENT_WRITTEN`.
  If neither exists → `chose-instead-missing`: no write, and the correction stays open.
- `undo.how` = `mark.undoHow` (human, from the open payload). Otherwise `` `git revert --no-edit ${attemptSha}` `` + `ORCA_GENERATED`.
- A decision target goes through `deriveRows`, giving 2 rows. A pending target goes through `derivePendingRows`,
  giving 1 `decision` row: `question` = the entry's `question`, `alternatives: [{ option: entry.chose, why_not: "人在 correction <id> 里推翻了它：<because>" }]`,
  `kind`/`scope` from the entry, `undo.cost`/`blast_radius` inherited, and `evidence: ["correction <id>", "pending <pendingId>"]`.
  No `overturned` row.
- Before deriving, `alreadyCommitted(repo, .decisions/<fixRunId>.jsonl, correction.id)` → `closed-by-human-first`, no write.
- Writing: `appendEvents(decisionsDir, fixRunId, rows)` directly, **not** through `writeRunLedger`. Closing rows
  never become pending items: those are for agent-reported entries. A throw becomes
  `{ state: "refused", reason: err.message }`, and the landing proceeds without the file. The `decisionsDir` holds the
  landing base's `.decisions/`, so check 5 sees the original decision. The record is staged on the run beside the
  decisions plan's `stagedPending` (new drive field `stagedDebugClosing`, defaulted `null`). It is copied to
  `group.debug.closing` by the decisions plan's shared helper `landedWithPending(store, run)` in the landing
  transaction, so a moved-tip retry or a `findLanding` recovery neither repeats nor loses it.

- [ ] **Step 1: Failing tests.**
  - `derive.test.ts` › "human values pass through untouched". Without `authored`, the output is byte-equal to today's
    golden.
  - `derive.test.ts` › "agent and Orca values carry their suffixes". `decision.chose.endsWith(AGENT_WRITTEN)` and
    `decision.undo.how.endsWith(ORCA_GENERATED)`.
  - `debugClosing.test.ts`, using the landing harness through the decisions plan's `stepD` path:
    - "the landing commit holds the closing file". `git show <landedCommit>:.decisions/<fixRunId>.jsonl` parses to
      `[decision, overturned]`; `overturned.correctionId === cid`; `decision.undo.how` equals
      `` `git revert --no-edit ${attemptSha}` `` + `ORCA_GENERATED`.
    - "the same through `finishReconcile`". Same assertion on the reconcile path's landed commit.
    - "a pending target writes one decision row and no overturned". The file has exactly one line, with
      `ev === "decision"`.
    - "a non-executable human undo.how is refused by appendEvent and the correction stays open". Use
      `mark.undoHow = "revert it"`. The file is absent from the landed tree, `closing.reason` contains
      `downgraded to tier 0, this decision is not the agent's to make`, and the run is still `landed`.
    - "chose_instead missing leaves the correction open". `closing.state === "chose-instead-missing"`; the file is absent.
    - "already closed by hand writes nothing" (Review Focus 5).
- [ ] **Step 2:** Run. Expect FAIL.
  - "a moved-tip retry writes the closing file once". Use the decisions plan's `driverDecisions.test.ts` moved-tip
    pattern. The landed file has exactly 2 lines.
- [ ] **Step 3:** Implement. In `stepD` and `finishReconcile`, right after their `writeRunLedger` call(s), call
  `writeDebugClosing` when `readDebugMark(group) !== null`.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-9.1** drop the agent suffix. **M-9.2** take `undo.how` from the agent
  result instead of generating it (the expected-string test goes red). **M-9.3** catch-and-write past the refusal (the
  refused test goes red). **M-9.4** skip the `finishReconcile` contribution. **M-9.5** drop the `alreadyCommitted`
  check. **M-9.6** emit `overturned` for a pending target.
- [ ] **Step 5: Commit** `feat(control): a debug run's landing commit closes its correction`.

### Task 10: Closed-ness is computed from the target; the corrections list

**Files:**
- Create: `src/control/correctionState.ts`, `tests/control/correctionState.test.ts`
- Modify: `src/panel/controlApi.ts` (read route `GET /api/control/corrections`), `skills/orca-control/SKILL.md` (§2
  Reading: `orca control get corrections`), `src/control/integrationPass.ts` (after a debug group's integration
  settles: recompute and record activity `correction-closed`)

**Interfaces:**
- Consumes: `readLedgerAtRef` (table; its `null` for an unresolved ref means `open`), `readGroupIntegration`,
  `readDebugMark`, `debugGroupIds` (T6), `readCorrections`. `integrationTargetRef` produces exactly the target entry of
  the decisions plan's `ledgerSources`; reuse that branch of it if it is factored out, or else factor it out.
- Produces:

```ts
export type CorrectionClosedState = { state: "open" } | { state: "closed"; ref: string; via: "debug-group" | "by-hand" };
export function integrationTargetRef(integration: GroupIntegration | null): string | null;
  // local → refs/heads/<target>; push-target|push-branch|github-pr → refs/remotes/<remote>/<target>; keep (null) → null
export async function correctionClosedState(repo: string, correction: Correction, targetRef: string | null): Promise<CorrectionClosedState>;
  // closed ⇔ readLedgerAtRef(repo, targetRef) holds a decision whose evidence includes `correction <id>`
export interface CorrectionListItemV1 { correction: Correction; repoId: string | null; debugGroups: Array<{ groupId: string; ordinal: number; live: boolean; state: string }>;
  closed: CorrectionClosedState; closing: ClosingRecord | null }
export async function readCorrectionList(deps: { store: ControlStore; correctionsDir: string; listRepositories: () => Array<{ repoId: string; path: string }> }): Promise<CorrectionListItemV1[]>;
```

Decision recorded here (deviation from §12.1's literal predicate): closed-ness is "the target ref's tree holds the
closing decision", not `merge-base --is-ancestor <commit> <ref>`. Under `squash` the landing commit is never an
ancestor, so the literal predicate would never close (Review Focus 2). Reads never fetch. A push scheme is judged on
its local `refs/remotes/<remote>/<target>`, which the integration pass's own fetch keeps current. `keep` with no human
close → open (§12.1).

A `by-hand` close is found the same way, with `targetRef` = the repository's current branch (`git symbolic-ref HEAD`)
when there is no debug group.

- [ ] **Step 1: Failing tests** (temp repo, `local` scheme):
  - "rows on the group branch only leave the correction open". After landing, before integration: `{ state: "open" }`.
  - "after local merge integration it is closed". Run the integration pass; result `{ state: "closed", via: "debug-group" }`.
  - "after local squash integration it is closed" (Review Focus 2).
  - "keep never closes by itself" → `open`.
  - "the list shows a correction with no debug group and its open state". `readCorrectionList` item:
    `debugGroups: []`, `closed.state === "open"`.
  - API › `GET /api/control/corrections` returns the list over both channels (web and socket); the skill doc lists the path.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-10.1** use `alreadyCommitted` (`git log --all`): the group-branch-only
  test goes red, which is §12.1's blocker. **M-10.2** use `merge-base --is-ancestor` (the squash test goes red).
  **M-10.3** map `keep` to the group branch (the keep test goes red).
- [ ] **Step 5: Commit** `feat(control): a correction is closed when its rows are on the target`.

### Task 11: Human-only `correction-record` and `correction-close` verbs

**Files:**
- Create: `src/control/correctionCommands.ts`, `tests/control/correctionCommands.test.ts`
- Modify: `src/corrections/correct.ts:63-215` (extract `closeExistingCorrection`; the CLI `close-existing` branch calls it, behaviour unchanged)
- Modify: `src/control/webProtocol.ts` (two verbs; new target `{ kind: "corrections" }`), `src/control/commandLedger.ts:44-58`
  (scope `@corrections`, `settingRevision` → `0`), `src/panel/humanOnly.ts`, `src/panel/controlApi.ts`,
  `src/control/webService.ts`, `src/control/errors.ts`, `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts`, locales

**Interfaces:**
- Consumes: `recordNewCorrection`, `correctionRowFrom` (`src/corrections/record.ts`), `projectKeyOf`, T6
  (`debugGroupIds`, `debugGroupLive`), T10.
- Produces:

```ts
// correct.ts (extracted, same order of guards as today: midOperation → readOriginalDecision → repo lock → store → alreadyCommitted → append → commit),
// including the decisions plan's T10 refusal of a pending-target row (`correction-target-not-a-decision`), which moves with the code
export async function closeExistingCorrection(input: { repo: string; correctionId: string; choseInstead?: string; undo: UndoArgs; dir: string }): Promise<{ relPath: string; alreadyClosed: boolean }>;
// webProtocol.ts
correctionRecordPayloadSchema = z.object({ repoId: idSchema, decisionId: nonemptyString, kind: z.enum(CORRECTION_KINDS),
  because: nonemptyString, chose_instead: z.string().optional(), again: z.boolean().optional() }).strict();
correctionClosePayloadSchema = z.object({ correctionId: z.string().regex(/^c_[a-f0-9]{16}$/), choseInstead: nonemptyString.optional(),
  undoHow: nonemptyString, undoCost: nonemptyString.optional(), undoBlastRadius: nonemptyString.optional() }).strict();
// results: { kind: "correction-recorded"; correctionId } | { kind: "correction-closed"; correctionId; relPath; alreadyClosed }
```

Routes: `POST /api/control/corrections` (`correction-record`) and `POST /api/control/corrections/:correctionId/close`
(`correction-close`). Both have target `{ kind: "corrections" }` and are `"human-only"`. `by` is `command.actorId`,
the same identity the decisions plan's `prepareRejection` records, so every correction the control service writes names
its author the same way. The scope key is `@corrections` with revision `0` (no CAS). Duplicates are the
store's own `again` check. Every `CorrectRejection` code reachable from these two paths is mapped 1:1 to a
`ControlError` of the same code and registered in `errors.ts` with an en/zh entry: `correction-row-invalid` 400,
`correction-already-recorded` 409, `duplicate-correction-id` 409, `correction-not-found` 404,
`corrections-store-busy` 409, `no-chose-instead` 400, `original-decision-not-found` 404,
`close-argument-conflict` 400, `target-not-a-git-repo` 400, `target-has-no-remote` 400,
`target-remote-not-keyable` 400, `target-mid-git-operation` 409, `repo-locked` 423, `ledger-commit-refused` 409.
`correction-target-not-a-decision` 409 is consumed: register it only if the decisions plan's Task 10 did not; the
precondition script tells which. New: `debug-group-active` 409.

A pending-target correction therefore cannot be closed by hand in this round. Its only closing is its debug group's
landing (Task 9). If that closing is refused, the human reopens with a different `undoHow` (Task 6 Reopen).

`correction-close` refuses `debug-group-active` when any `debugGroupIds(store, id)` is `debugGroupLive` (§12.1, §12.7:
a draft counts as live). The UI then offers "archive it" for a draft and "pause" for a running group, and after either
the close goes through. The CLI `orca correct --close` is **unchanged** (§3.0); it has no control DB to consult.

- [ ] **Step 1: Failing tests.**
  - "record through the verb stores the same row as `/api/corrections`". Send the same input through both paths in two
    temp stores. The row bytes are equal apart from `at` (inject one clock) and `by`. The panel route uses
    `deps.opts.by`; the verb uses `actorId`.
  - "close of a pending-target correction is refused by name" → `correction-target-not-a-decision`, and no ledger
    file is written.
  - "an agent sending either verb is refused" → `control-verb-human-only`, and the corrections file is unchanged.
  - "close with a live debug group is refused; after archiving it closes". First `debug-group-active`; after
    `archive-group`, `git show HEAD:.decisions/<fixRunId>.jsonl` holds the two rows.
  - "the CLI close path is unchanged". The existing `tests/corrections/close.test.ts` and `commit.test.ts` pass
    untouched (run them; no edits).
  - `refusalCoverage.test.ts` green with the new locale entries.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The extraction is a move with no reordering: keep the comments with the code they explain.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-11.1** set `correction-close` to `"any"` in `VERB_ACCESS`. **M-11.2**
  drop the live-group guard. **M-11.3** treat a draft as not live. Each one turns its test red.
- [ ] **Step 5: Commit** `feat(control): record and close corrections from the web UI`.

### Task 12: Rejecting a pending decision opens its debug group

**Files:**
- Modify: `src/control/webService.ts`. Change the decisions plan's reject method, which calls `prepareRejection` and
  then `applyRejectPendingDecision`. `src/control/decisionCommands.ts` itself is **not** changed: its result schema
  `{ kind: "pending-decision-rejected", pendingId, correctionId }` stays as that plan defines it.
- Test: `tests/control/rejectDecision.test.ts` (the decisions plan's file), extended

**Interfaces:**
- Consumes: `prepareRejection`, `applyRejectPendingDecision`, `RejectPendingDecisionCommand` (table);
  `WebControlService.openCorrectionDebugGroup` (T6's service method around `applyCorrectionDebugOpen`); `debugGroupIdFor` (T6).
- Produces: after a **successful** booked reject, the service books a second, separate command:
  - verb `correction-debug-open`;
  - `commandId = \`${rejectCommandId}.debug-open\`` (passes `idSchema`; deterministic, so a replayed reject replays the
    same open instead of minting a new one);
  - same `actorId` and command context;
  - target `{ kind: "group", groupId: debugGroupIdFor(store, correctionId, false) }`, `expectedRevision` = that
    group's current revision (`0` when new);
  - payload `{ correctionId }`.

  The open's outcome is its own command row, readable at `GET /api/control/groups/<debug group>/commands/<commandId>`.
  The corrections list (T10) shows the group or, when there is none, the Open button. The reject response is unchanged.

- [ ] **Step 1: Failing tests.**
  - "reject records the correction and opens debug-<cid>". After the reject call, the group `debug-<cid>` exists,
    `readDebugMark(group).correctionId` equals the reject's `correctionId`, the frozen plan's goal contains the pending
    entry's `question`, and the estimates count is `0`.
  - "a second reject returns the same correction and the same group". The groups count with `debug-<cid>%` is `1`.
  - "a failed open leaves the reject succeeded and the correction recorded". Remove the repo's remote between reject
    and open via an injected hook, so the open is refused `correction-repository-unknown`. The reject's booked outcome
    is still `pending-decision-rejected`, and `readCorrections(dir)` still has the row (anti-goal 1).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS. Mutations: **M-12.1** skip the open call (first test red). **M-12.2** mint a fresh
  command id for the open, so a replayed reject books a second open command and the open-command count goes red
  (add that count assertion to the second test).
- [ ] **Step 5: Commit** `feat(control): rejecting a pending decision opens a debug group`.

### Task 13: Web UI

**Files:**
- Create: `web/src/CorrectionsView.tsx`, `web/tests/correctionsView.test.tsx`
- Modify: `web/src/controlApi.ts` (`ControlAction` union and `controlCommandPath`: `correction-debug-open`,
  `correction-record`, `correction-close`; `readCorrections()`), `web/src/controlTypes.ts`, `web/src/ControlGroupView.tsx`
  (debug badge, frozen-input summary with the missing pieces, `agentFallback` reason, `未复现` with its reason, closing
  state), `web/src/DecisionDetail.tsx` and `web/src/App.tsx` (the record form sends `correction-record`, then
  `correction-debug-open` at once), `web/src/Shell.tsx`/`sections.ts` (a Corrections section), locales
- Test: `web/tests/correctionsView.test.tsx`, `web/tests/decisionDetail.test.tsx`, `web/tests/i18nKeys.test.ts`

**Interfaces:**
- Consumes: T6, T10, T11 routes and result kinds.

- [ ] **Step 1: Failing tests.**
  - "lists corrections without a debug group with an Open button", which sends `correction-debug-open` with
    `expectedRevision: 0` to `/api/control/corrections/<cid>/debug-group`.
  - "a stopped or archived debug group shows Reopen", which sends `reopen: true`.
  - "a failed open keeps the correction and shows the error with Retry". The fake returns
    `correction-repository-unknown`; the row stays, the zh text for that code is shown, and Retry resends the **same**
    command id (`nextCommandId` kept, `controlApi.ts`).
  - "close by hand shows the stop-first hint on debug-group-active".
  - "the group view labels a debug group and shows 未复现 with its reason".
  - "recording from the decision detail sends the open right after the row is stored" (§3.1 panel bullet, which §12.4
    does not withdraw). One `correction-record` call is followed by one `correction-debug-open` call. If the open
    fails, the recorded state stays and the error shows with Retry.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Follow `web/DESIGN.md` and existing component patterns.
- [ ] **Step 4:** Run (`npm --workspace web exec -- vitest run tests/correctionsView.test.tsx tests/decisionDetail.test.tsx tests/i18nKeys.test.ts`).
  Expect PASS. Mutations: **M-13.1** a fresh command id on Retry. **M-13.2** hide Open when `debugGroups` is empty.
- [ ] **Step 5: Commit** `feat(web): corrections list, debug groups, close by hand`.

### Task 14: Dated corrections beside the published text

**Files:**
- Modify (append only): `docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md`, by adding a new final
  section `## 16. ERRATUM (2026-10-18, Orca session a3b2a7a7) — undo.how on the debug-task path; the web app's commit rights`
- Modify (append a note beside the comment): `src/corrections/derive.ts:65`, `src/panel/api.ts:290-295`
- Test: `tests/corrections/derive.test.ts` (no change); the check below

- [ ] **Step 1:** Record the baseline:
  `git show HEAD:docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md > "$LOGS/spec-before.md"`.
- [ ] **Step 2:** Append §16 with three subsections. (a) Ruling 4 (§1 row 4, §5 table `undo.how` row) is narrowed for
  the debug-task path: the human's value if given, else Orca's `git revert --no-edit <attemptSha>` marked
  `（Orca 生成，人未填）`. The manual `--close` still requires `--undo-how`. (b) The gate is lexical for every author:
  it checks shape, not truth (debug spec §12.5). (c) A′ §4.1 ("a web app holding commit rights on every repository is
  refused") is narrowed: the control service commits closing rows on group branches, and the `correction-close` verb
  commits on the repository's current branch, as `--close` does. Each subsection cites the debug spec section and this
  plan's commit subject.
- [ ] **Step 3:** Beside `derive.ts:65` and `api.ts:290`, add
  `// *** ERRATUM (2026-10-18, debug-task plan): … see 2026-09-06 spec §16. ***`, leaving the original lines unchanged.
- [ ] **Step 4: Verify the originals are verbatim.**
  `head -c $(wc -c < "$LOGS/spec-before.md") docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md | cmp - "$LOGS/spec-before.md"; echo "exit=$?"`
  → `exit=0`. For the two code files: `git diff -U0 src/corrections/derive.ts src/panel/api.ts > "$LOGS/erratum.diff"`.
  Read it: every hunk has only `+` lines.
- [ ] **Step 5: Commit** `docs(spec): record where the debug-task path narrows ruling 4 and A' §4.1`.

### Task 15: Mutation table, full gate, hand-off

**Files:** none new. Evidence goes in `$LOGS`.

- [ ] **Step 1:** `git clone --local /Users/biran/code/skills/orca/Orca "$LOGS/mut-clone"`. For each mutation
  named in Tasks 1–13 (M-1.2 … M-13.2): apply it, run its named test file into `$LOGS/mut-<id>.log`, and confirm it FAILS on the named
  assertion (read the whole log). Revert it, then confirm both `diff | wc -c` values are `0`. Record one line per
  mutation (id, file:line, red test, both byte counts) in `$LOGS/mutations.md`. That file is a scratch artifact, not committed.
- [ ] **Step 2:** `npm run verify > "$LOGS/verify.log" 2>&1; echo "exit=$?"` → `exit=0`. Read the whole log. Report
  the test-file and test counts as vitest prints them (Rule 14). A skipped test makes the run not green (Rule 12).
- [ ] **Step 3: Checkpoint (Rule 10).** List what is verified and what is not: the push schemes' closing is untested,
  and the ccloop half (`debug` result fields and `decisions`) is pinned only by fake results until a contract test reads
  ccloop's real output. Put under `awaitingHuman`: the one paid end-to-end run (§8: a throwaway repo, one correction,
  open → estimate → confirm → start → land → integrate `local` → closed) and the review of every controller's call
  listed below.

---

## Controller's calls made in this plan (for the human's review, per §12's 「执行完在最后阶段报给我审核」)

1. **Agent result fields**: `debug.{choseInstead, reproTests, reproCommand, reproduction, reproductionReason}` are read
   by a new adapter `reportedDebugOf` (top-level `debug` key), placed beside the decisions plan's `reportedDecisionsOf`
   in `src/control/reportedDecisions.ts` (`ExecutionReport.debug?: unknown`). Until ccloop carries them, `reproTests` is
   computed from added test files (Rule 5), and a missing `choseInstead` with no human value leaves the correction open
   (`chose-instead-missing`).
2. **"Original base" in §12.8** is read as the debug run's own `drive.base`, the code before the fix (§4.3: "fails on the
   current code"), not the corrected run's base, where the corrected behaviour does not exist yet.
3. **The check runs in the run's own workspace**, not a fresh scratch worktree, so the repository's installed
   dependencies are present. It is restored to `attemptSha` afterwards (Review Focus 4).
4. **Closed-ness predicate** is "the target ref's tree holds the closing decision", not ancestry, so that `squash`
   closes. Reads never fetch.
5. **The human's `undo.how`** reaches the debug path only through the open verb's optional `undoHow`, which is
   human-only by field (`HUMAN_ONLY_FIELDS`). The correction row has no undo field.
6. **Command scopes**: `correction-debug-open` is group-scoped on the group it creates or returns (expected revision 0
   for a new one). `correction-record`/`correction-close` use a new `@corrections` scope with constant revision 0.
7. **The frozen input** is stored as a canonical record. The contract's goal inlines the diff up to 64 KiB and names
   the `git diff` command beyond that.
8. **A decision only on an unintegrated group branch** is refused at open (`correction-decision-not-integrated`) rather
   than failing check 5 after a paid run.
9. **"Stopped"** means `groupStopped()` (any stop intent, pause included) or archived. A draft can only be archived.
10. **The CLI `--close`** does not consult the control DB (it has none), so `debug-group-active` guards the web/agent
    close only. Task 9's `alreadyCommitted` check stops a double close from the debug side.

---

## Cross-plan resolutions (controller, Orca session a3b2a7a7, 2026-10-18)

The two Orca plans `2026-10-18-control-run-decisions.md` (first) and `2026-10-18-correction-debug-task.md` (second) were
aligned by name; six seams were left. These calls bind both plans; where a task's text disagrees, this section wins.
They are the controller's calls under the human's standing instruction for this round and are reported for review.

1. **Who `by` is.** Every path that records a correction (`/api/corrections`, `reject-pending-decision`,
   `correction-record`, `correction-close`) writes `by` = the panel's resolved human identity (the value
   `/api/corrections` already uses, `deps.opts.by`), so the store's duplicate check sees one person as one person. The
   command's `actorId` goes into the ledger `evidence` / activity row, not into `by`. The decisions plan's Task 10 uses
   `deps.opts.by`, not `actorId`.
2. **Closing a pending-target correction by hand.** CLI `orca correct --close` keeps refusing it with
   `correction-target-not-a-decision` (the CLI stays decision-only). The web/agent-path `correction-close` verb (debug
   plan Task 11) **supports** it: it writes the one `decision` row of debug-task spec §12.3 with the human's `undo.how`,
   no `overturned` row. This is the "human can close by hand" of debug-task spec §5.
3. **Staged landing payload.** The decisions plan's `landedWithPending(store, run)` is written so later plans can add
   staged fields: it copies `drive.stagedPending` and, when present, `drive.stagedDebugClosing` (added by debug plan
   Task 9) inside the same landing transaction.
4. **One target-ref helper.** The decisions plan's Task 8 exports `integrationTargetRef(store, groupId): Promise<string | null>`
   from `src/control/ledgerAtRef.ts` and `ledgerSources` uses it; the debug plan's Task 10 imports it (no copy).
5. **`correction-target-not-a-decision`** is a durable `ControlError` code registered in `src/control/errors.ts` with
   en/zh copy by the decisions plan's Task 10; the debug plan's Task 11 consumes it.
6. **Result fields from ccloop.** `ExecutionReport.debug` (debug plan Task 8) travels with `ExecutionReport.decisions`:
   the decisions plan's blocked Task 12 (ccloop contract) covers both keys, and the ccloop design that emits
   `decisions` also emits `debug` (`choseInstead`, `reproTests`, `reproCommand`, `reproduction`).

## Amendment (decisions review withdraw, session b304f167)

Appended by the decisions review withdraw plan (its spec §6); every line above is unchanged. A correction can now be
withdrawn by its author (decisions review withdraw spec §5). The spec left six items for this plan, plus one decision.
What is on the branch `codex/decisions-review-withdraw` (read, not assumed): `src/corrections/withdrawals.ts` exports
`readWithdrawals(dir)` (throws `correction-withdrawals-unreadable` on a damaged file), `withdrawnIds(rows)` (a
`Set<string>` of correction ids), `withdrawCorrection(...)` and the codes `CORRECTION_WITHDRAWN`
(`correction-withdrawn`), `CORRECTION_ALREADY_WITHDRAWN`, `CORRECTION_CLOSED`. The spec's name `isCorrectionWithdrawn`
is not exported; use `withdrawnIds(await readWithdrawals(dir))`. `readCorrections` still returns withdrawn rows
(the withdrawals live in `<correctionsDir>/correction-withdrawals.jsonl`, not in `corrections.jsonl`), so every
consumer below must filter itself. Panel routes: `POST /api/reviews/withdraw`, `POST /api/corrections/withdraw`
(`src/panel/api.ts`).

1. **Task 6 (`correction-debug-open`): refuse a withdrawn correction.** Read the withdrawals in the verb's guard
   order, beside `readCorrections`, and refuse with `correction-withdrawn` (code already defined by the withdraw
   plan; register its en/zh copy here only if it is not yet in `src/control/errors.ts` and the locales). Task 3
   (`debugInput.ts`) takes `correctionsDir` already; it must not freeze the input of a withdrawn correction, so the
   refusal belongs in Task 6 before Task 3's freeze is called.
2. **Task 6 + the withdraw route: archive an unstarted debug group.** On withdraw, if `debugGroupIds(store, id)` has a
   group that is `debugGroupLive` and has not started a run, archive it (`archive-group`; archive deletes nothing).
   A started group is left alone and the withdraw answer says so (a field on the route's answer naming the group id and
   "started: left running"). The withdraw route lives in `src/panel/api.ts`, which has no control store today: this
   needs either the panel's control dependencies on that route or the archive done through the control service by the
   web client after the withdraw answer. Choose when implementing Task 6; either way the withdrawal row is written
   first and a failed archive leaves the correction withdrawn (the same partial-failure shape as §5.4's 409).
3. **Task 13 (Corrections view) + Task 10 (`GET /api/control/corrections`): list withdrawn corrections out of
   "corrections without a debug group".** Task 10's list route returns each correction's `withdrawn` state (from
   `withdrawnIds`); Task 13's "lists corrections without a debug group with an Open button" test must add a withdrawn
   correction and assert it has no Open button.
4. **Task 11 (`closeExistingCorrection`, `correction-close`): refuse `correction-withdrawn`.** `correct.ts`
   close-existing already refuses it (`CORRECTION_WITHDRAWN`, checked under the store lock before the
   target-not-a-decision refusal). Task 11 extracts that code into `closeExistingCorrection`, so the extraction must
   keep this guard in place and in the same order. Task 11's verb criterion must exercise it through
   `correction-close` as well (withdrawn correction, verb refused with `correction-withdrawn`, ledger and corrections
   file unchanged), not only through the CLI.
5. **Task 13: show the withdrawn state in the Corrections view.** A withdrawn correction renders as withdrawn (who and
   when come from the withdrawal row), with no Open and no Close action. Task 10's list route must carry that data.
6. **Task 11: `correction-record` keeps writing the `reviewed` row, or moves decisions review withdraw §5.4 with it.**
   The `reviewed` row is written by `/api/corrections` today; §5.4's withdrawal of it is done by
   `POST /api/corrections/withdraw`. If `correction-record` stops writing the `reviewed` row, then the withdraw must
   stop writing the matching review withdrawal for a correction recorded that way (it already does so only when the
   caller's state is still `reviewed`). Default: `correction-record` also appends the `reviewed` row, so §5.4 holds
   unchanged.
7. **Task 11 (decision): withdraw becomes a human-only control verb when recording does.** It should: one pattern, the
   same `VERB_ACCESS` entry `"human-only"`, target `{ kind: "corrections" }`, `by` = `deps.opts.by` (Cross-plan
   resolution 1). Until Task 11 lands, the panel route stays the only entry. If Task 11 adds `correction-withdraw`, the
   panel route and the verb share `withdrawCorrection(...)`, and item 2 (archive of the unstarted group) moves into the
   verb's handler, where the control store is at hand.

The out-of-repo write of `correction-withdrawals.jsonl` is registered in the withdraw spec §5.1 (path, the panel
withdraw route as the writer, `0600`). The debug design only reads it.
