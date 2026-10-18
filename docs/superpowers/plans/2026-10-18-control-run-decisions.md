# Control Run Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task Orca's control path lands writes its decisions (the agent's reported ones, plus the reconcile template) into `<repo>/.decisions/<runId>.jsonl` inside the commit that lands the work, and a decision the gate refuses becomes a 需要人确认 item that a human approves or rejects in the Web UI.

**Architecture:** One adapter (`reportedDecisionsOf`) reads the `decisions` value out of a run's result. One shared function (`writeRunLedger`) turns it plus any code-authored decisions into validated ledger lines and pending items. Three landing paths call it: `stepD`'s merge, `finishReconcile`'s rebuilt tree, and the empty-result ledger-only commit. Pending items are staged on the run body before the compare-and-swap. They are inserted into a new `pending_decisions` table, insert-if-absent, in the same transaction that marks the run landed. Two human-only control verbs, `approve-pending-decision` and `reject-pending-decision`, settle them. One ref-based reader, `readLedgerAtRef`, serves the group/task decisions view.

**Tech Stack:** TypeScript (ESM, Node `node:sqlite`), zod, vitest (root `vitest.config.ts` and `web/vite.config.ts`), React 19 + i18next in `web/`, git CLI through `src/scheduler/gitExec.ts`.

**Spec:** `docs/superpowers/specs/2026-10-18-control-run-decisions-design.md`. §10 overrides earlier sections where they disagree, and §7a's controller calls apply. Read with `docs/handoff/goal.md` §1.1–§1.2. The debug-task design `docs/superpowers/specs/2026-10-18-correction-debug-task-design.md` §12.3 is read for the correction target only.

## Global Constraints

- Anchor: plan written against Orca `main` at `ddc4cbdf`. Every `file:line` below was read at that commit. Re-measure before you rely on one (CLAUDE.md Rule 14).
- Ledger file: `<repo>/.decisions/<runId>.jsonl`, `runId` = the control run's `run-<uuid>`. A reconcile writes to `reconcile-<runId>.jsonl`. No `group-<groupId>` file (§10.6).
- Orca supplies `ev`, `id`, `at`, `run` and `evidence`. Agent-supplied values for those five fields are dropped silently, never refused (§7a).
- `evidence` = `["run <runId>", "attempt <attemptSha>", "<ccloop evidence string>"]` (§10.6). It never names the landing commit.
- Decision ids: agent entry `i` → `<ledgerRun>/agent-<i>`; the reconcile template → `<ledgerRun>/1`. Pending ids: `pending-<ledgerRun>-<i>` (§10.5).
- `kind` and `scope` outside `DECISION_KINDS` / `DECISION_SCOPES` (`src/ledger/types.ts`) are refused **by name**. They are never coerced.
- Entries are filtered **before** `appendEvents`. A batch-level throw turns the whole agent batch into pending items with the reason, and the landing proceeds (§10.4).
- A refused decision never fails a task. A refused decision is never dropped silently (§9).
- Approve and reject are `"human-only"` in `VERB_ACCESS`. An agent gets 403 `control-verb-human-only`.
- `undo.how` example form in tests: `git revert --no-edit <40-hex sha>` (§10.3). Do not widen `undoHowIsExecutable`.
- Integration is tested with `local` only. `push-target`, `push-branch` and `github-pr` are **untested** here, so say so in the final report (Rule 12, §10.7).
- The integration-conflict reconcile (`integrationResolve.ts`) is **not** touched (§10.6 cut).
- Rule 17: reject writes the corrections store through `correctionsDir(env)` (`src/corrections/paths.ts`). Every test that reaches it passes a `mkdtemp` directory as `correctionsDir` / `ORCA_CORRECTIONS_DIR`, never the real `~/.orca`.
- Rule 14, running a criterion: `npx vitest run <file> > "$SCRATCH/<name>.log" 2>&1; echo "exit=$?"`, then read the whole log. No `grep`/`tail` on a verification run.
  - Web criteria: `npm exec --workspace web -- vitest run <tests/file>`, same redirect.
  - Typecheck: `npm run typecheck`.
- Rule 9/15: every named mutation runs in a `git clone --local` copy and is **seen red** there. The main worktree diff must be byte-identical before and after (`git diff | wc -c`, `git diff --cached | wc -c`).
- Rule 13: every commit message ends with the session attribution trailer. Never push (Rule 15: push stays with the human). Since `be13bef6` the gate lets the controller `git merge --ff-only` into `main`, `git branch -d` a merged branch and `git worktree remove` without force; forced forms stay blocked.
- Code, comments, test names: English. Panel copy: en and zh entries in `web/src/locales/{en,zh}.ts`.

## Review Focus

1. **A target repo whose `.gitignore` lists `.decisions/`.** Expected: the decision file still lands in the commit (`git add -f`). Test in Task 5.
2. **`decisions` present but not an array** (an object, a string). Expected: one pending item, index 0, reason `decisions-not-array`, and the task lands. Test in Task 2 (unit) and Task 5 (landing).
3. **Approve while another run of the group is `reconciling`.** Expected: the approve commit would move the tip under a paid reconciliation and force it to re-run (`driverLanding.ts:86-90`, rule N2). So it is refused `decision-approve-reconciling` and the item stays pending. Test in Task 9.
4. **A run whose landing never completes** (blocked at D after its pending items were staged, e.g. `cas-failed`). Expected: no row in `pending_decisions`, and its entries are listed as 未落地的决定. Test in Task 5.
5. **Two approvals on the same run's file, one after the other.** Expected: both lines are on the group branch, and the second approve appends to the first's file rather than overwriting it. Test in Task 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/control/reportedDecisions.ts` (new) | The one adapter: the run result's `decisions` value → `ReportedDecisions`. |
| `src/control/runLedger.ts` (new) | Normalize, filter and write a run's ledger lines; the pending-entry and evidence shapes. |
| `src/control/ledgerTree.ts` (new) | git plumbing: export a tree's `.decisions/`, build a tree with added ledger files through a temp index, and make a ledger-only commit on `orca/<g>` by CAS. |
| `src/control/pendingDecisions.ts` (new) | `pending_decisions` table access. |
| `src/control/ledgerAtRef.ts` (new) | `readLedgerAtRef` and the ordered working tree → target → group branch lookup. |
| `src/control/decisionCommands.ts` (new) | Apply functions for `approve-pending-decision` and `reject-pending-decision`. |
| `src/panel/groupDecisions.ts` (new) | The group decisions read view. |
| `src/control/driverLanding.ts` | `stepD` and `finishReconcile` write the ledger and stage pending items; `markLanded` inserts them. |
| `src/control/executionDriver.ts` | The `stepE` ledger-only commit for an empty result. |
| `src/control/driveRecord.ts` | Drive fields `stagedPending`, `ledgerCommit`, and reconcile `conflictBlocks`. |
| `src/control/executionPort.ts` | `ExecutionReport.decisions?: unknown`. |
| `src/scheduler/ledgerWiring.ts`, `src/scheduler/run.ts` | `reconcileDecision` takes `otherTaskIds: string[]`. |
| `src/control/migrations.ts`, `src/control/store.ts` | Schema 14. |
| `src/control/webProtocol.ts`, `src/panel/humanOnly.ts`, `src/panel/controlApi.ts`, `src/control/webService.ts`, `src/control/errors.ts` | The two verbs, their routes and their error codes. |
| `src/corrections/schema.ts`, `src/corrections/fields.ts` | The `{ runId, pendingId }` correction target. |
| `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts` | Route rows for the two verbs. |
| `web/src/ControlGroupView.tsx`, `web/src/TaskDetail.tsx`, new `web/src/RunDecisions.tsx`, `web/src/controlApi.ts`, `web/src/controlTypes.ts`, `web/src/locales/{en,zh}.ts` | Badge, buttons, 纠正, 未落地的决定, "no agent decisions reported". |

---

### Task 1: The adapter, and a fake port that reports decisions

**Files:**
- Create: `src/control/reportedDecisions.ts`
- Modify: `src/control/executionPort.ts:17-22` (add `decisions?: unknown` to `ExecutionReport`, with a one-line comment that it is optional like `progress`)
- Modify: `tests/control/fixtures/driverPort.ts` (option `decisions?: (workItemId: string) => unknown`; when it returns a value other than `undefined`, the terminal report carries `decisions`)
- Modify: `tests/control/fixtures/driverHarness.ts` (pass `HarnessOptions.decisions` through)
- Test: `tests/control/reportedDecisions.test.ts`

**Interfaces:**
- Produces:
  - `export type ReportedDecisions = { kind: "absent" } | { kind: "array"; entries: unknown[] } | { kind: "malformed"; value: unknown }`
  - `export function reportedDecisionsOf(result: unknown): ReportedDecisions`. It reads only the top-level `decisions` property of an object. This is the **only** place Orca knows where `decisions` lives.
  - `HarnessOptions.decisions?: (workItemId: string) => unknown`

- [ ] **Step 1: Write the failing tests**

```ts
it("reads an absent decisions field as not reported", () => {
  expect(reportedDecisionsOf({ events: [] })).toEqual({ kind: "absent" });
  expect(reportedDecisionsOf(null)).toEqual({ kind: "absent" });
});
it("passes an array through unchanged, empty included", () => {
  expect(reportedDecisionsOf({ decisions: [] })).toEqual({ kind: "array", entries: [] });
  const e = [{ question: "q" }];
  expect(reportedDecisionsOf({ decisions: e }).entries).toBe(e);
});
it("names a non-array decisions value as malformed", () => {
  expect(reportedDecisionsOf({ decisions: { question: "q" } })).toEqual({ kind: "malformed", value: { question: "q" } });
});
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/reportedDecisions.test.ts`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement `reportedDecisionsOf`, the `ExecutionReport.decisions` field and the fixture option.**
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: 3 passed.
- [ ] **Step 5: Mutation.** Make `{ decisions: {…} }` return `kind: "array"`. Expected: the third test goes red.
- [ ] **Step 6: Commit.** `feat(control): read reported decisions through one adapter`.

---

### Task 2: `writeRunLedger`, the shared filter and writer

**Files:**
- Create: `src/control/runLedger.ts`
- Test: `tests/control/runLedger.test.ts`. It uses `mkdtemp` decisions directories only, with no git.

**Interfaces:**
- Consumes: `ReportedDecisions` (Task 1); `appendEvents`, `RUN_ID` (`src/ledger/writer.ts`); `validateLine` (`src/ledger/validateLine.ts`); `DECISION_KINDS`, `DECISION_SCOPES` (`src/ledger/types.ts`); `DecisionEvent` (`src/ledger/schema.ts`); `ccloopEvidence` (`src/scheduler/ledgerWiring.ts:339`).
- Produces:
  - `export const agentDecisionId = (ledgerRun: string, entryIndex: number): string` → `` `${ledgerRun}/agent-${entryIndex}` ``
  - `export const pendingIdOf = (ledgerRun: string, entryIndex: number): string` → `` `pending-${ledgerRun}-${entryIndex}` ``
  - `export interface PendingEntry { pendingId: string; ledgerRun: string; entryIndex: number; entry: unknown; reason: string; at: string; evidence: string[] }` (also a zod `pendingEntrySchema`, `.strict()`)
  - `export function normalizeAgentEntry(entry: unknown, ctx: { ledgerRun: string; entryIndex: number; at: string; evidence: string[]; undoHow?: string }): { ok: true; event: DecisionEvent } | { ok: false; reason: string }`
  - `export async function writeRunLedger(decisionsDir: string, input: { ledgerRun: string; reported: ReportedDecisions; codeAuthored: DecisionEvent[]; at: string; evidence: string[] }): Promise<{ writtenIds: string[]; pending: PendingEntry[] }>`
  - `export function runEvidence(runId: string, attemptSha: string, ccloop: string): string[]`
  - `export async function ccloopEvidenceString(ccloopBin: string): Promise<string>`. It returns `ccloopEvidence(bin)[0]` when that works. Otherwise it returns `ccloop <version>` from the nearest `package.json` named `ccloop` above the bin, else `ccloop unknown`. It never throws, because evidence must not block a landing.

Rules `normalizeAgentEntry` applies, in this order (the reason strings are part of the contract and the panel shows them):
1. Not a plain object → `entry-not-object`.
2. Delete `ev`, `id`, `at`, `run`, `evidence`, then set Orca's values. Set `undo.how` from `ctx.undoHow` when it is given.
3. `kind` not in `DECISION_KINDS` → `` `kind-unknown:${JSON.stringify(kind)}` ``. `scope` not in `DECISION_SCOPES` → `` `scope-unknown:${JSON.stringify(scope)}` ``.
4. `validateLine(JSON.stringify(event))`: `rejected` → `` `rejected: ${reasons.join("; ")}` ``; `downgraded` → `` `tier-0: ${reasons.join("; ")}` ``.

`writeRunLedger` does the following:
- If `codeAuthored` is non-empty, it appends that first, in its own `appendEvents` call. A throw there propagates, because Orca's own template failing is a bug and must fail loud.
- It then appends the agent entries that passed, as one batch. If that batch throws, every one of those entries becomes pending with reason `` `batch-refused: ${message}` ``.
- `kind: "malformed"` gives one pending entry: index 0, reason `decisions-not-array`, `entry` = the value.
- `kind: "absent"` and an empty array write nothing and return no pending entries.
- An empty batch is never passed to `appendEvents`, which refuses an empty batch (`writer.ts:28`).

- [ ] **Step 1: Write the failing tests.** Each test names the assertion its mutation turns red.

```ts
const at = "2026-10-18T00:00:00.000Z", run = "run-0c6f…", ev = runEvidence(run, "a".repeat(40), "ccloop 0.0.0");
const good = (over = {}) => ({ question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface", ...over });

it("writes two agent decisions with Orca's id, at, run and evidence", async () => {
  const out = await writeRunLedger(dir, { ledgerRun: run, reported: { kind: "array", entries: [good(), good({ id: "forged", run: "x", at: "y", evidence: ["z"] })] }, codeAuthored: [], at, evidence: ev });
  const lines = readLines(dir, run);                     // JSON.parse of each line of <dir>/<run>.jsonl
  expect(lines.map((l) => l.id)).toEqual([`${run}/agent-0`, `${run}/agent-1`]);    // M2: let the agent's id through -> red
  expect(lines[1]).toMatchObject({ run, at, evidence: ev });
  expect(out.pending).toEqual([]);
});
it("refuses a kind outside the enum by name and still writes the good entry", async () => {
  const out = await writeRunLedger(dir, { ledgerRun: run, reported: { kind: "array", entries: [good({ kind: "opinion" }), good()] }, codeAuthored: [], at, evidence: ev });
  expect(out.pending.map((p) => [p.pendingId, p.reason])).toEqual([[`pending-${run}-0`, 'kind-unknown:"opinion"']]);   // M1
  expect(readLines(dir, run).map((l) => l.id)).toEqual([`${run}/agent-1`]);      // M3: filter-before-batch removed -> good entry lost -> red
});
it("refuses a scope outside the enum by name", /* reason 'scope-unknown:"galaxy"' */);
it("turns a non-executable undo.how into a tier-0 pending item", /* undo.how "revert it" -> reason starts "tier-0: undo.how is not executable" , no file written */);
it("turns empty alternatives and a missing because into rejected pending items", /* reason starts "rejected: " */);
it("turns a batch-level throw into pending items for the whole batch", /* pre-write <run>.jsonl holding a line with id `${run}/agent-0` -> both entries pending, reason starts "batch-refused: refusing to append: duplicate decision id" */);
it("writes nothing for an absent or empty report", /* no file exists; pending [] */);
it("names a non-array decisions value as one pending item", /* reason "decisions-not-array", entryIndex 0 */);
it("writes code-authored decisions before agent ones", /* codeAuthored with id `${run}/1` -> line order [`${run}/1`, `${run}/agent-0`] */);
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/runLedger.test.ts`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement** the functions above in `src/control/runLedger.ts`.
- [ ] **Step 4: Run them and confirm they pass.** Expected: 9 passed.
- [ ] **Step 5: Mutations, in a `git clone --local` copy.** Each one must be seen red:
  - **M1:** delete the step-3 kind check. The "opinion" reason becomes zod's text, so the `toEqual` goes red.
  - **M2:** keep the agent's `id`.
  - **M3:** pass all entries to `appendEvents` unfiltered.
  - **M4:** drop the `batch-refused` catch. The batch test throws.
- [ ] **Step 6: Commit.** `feat(control): filter and write a run's reported decisions`.

---

### Task 3: The reconcile template takes `otherTaskIds: string[]`

**Files:**
- Modify: `src/scheduler/ledgerWiring.ts:56-102` (`reconcileDecision`)
- Modify: `src/scheduler/run.ts:544-552` (pass `[other.taskId]`)
- Test: `tests/scheduler/reconcileDecisionText.test.ts`

**Interfaces:**
- Produces: `reconcileDecision(roundId: string, seq: number, taskId: string, otherTaskIds: string[], conflict: Pick<MaterialisedConflict, "conflictedPaths" | "conflictCommit" | "copyPath" | "wTip"> & { blocks: Array<Pick<ConflictBlock, "path" | "startLine" | "endLine">> }, workBranch: string, at: string): DecisionEvent`. The question text uses `` `conflicted with ${otherTaskIds.join(", ")} in ` ``. Narrowing the parameter type keeps `run.ts`'s full `MaterialisedConflict` assignable.

- [ ] **Step 1: Capture the golden output at the base commit, before any edit.** Use a fixed fixture: `conflictedPaths ["shared.txt"]`, one block `shared.txt:1-5`, `conflictCommit "c".repeat(40)`, `copyPath "/tmp/copy"`, `wTip "d".repeat(40)`, `incomingRef "refs/x"`, `ours/theirs []`. Call `reconcileDecision("r", 1, "a", "b", fixture, "orca/g", "2026-10-18T00:00:00.000Z")` with `npx tsx -e` and paste `JSON.stringify(result)` into the test as a literal `GOLDEN`.
- [ ] **Step 2: Write the failing tests.**

```ts
it("is byte-identical to the old scheduler's text with one other task", () => {
  expect(JSON.stringify(reconcileDecision("r", 1, "a", ["b"], fixture, "orca/g", AT))).toBe(GOLDEN);
});
it("names every other task, comma-separated", () => {
  expect(reconcileDecision("r", 1, "a", ["b", "c"], fixture, "orca/g", AT).question).toContain("conflicted with b, c in shared.txt");
});
```

- [ ] **Step 3: Run them and confirm they fail.** Expected: FAIL to typecheck or compare, because a `string[]` is passed where a `string` is expected.
- [ ] **Step 4: Implement the signature change** and update `run.ts`.
- [ ] **Step 5: Run the test file, `tests/scheduler/scenarios/S3.test.ts` and `npm run typecheck`.** Expected: all pass.
- [ ] **Step 6: Mutation.** Use `otherTaskIds.join(" and ")`. Expected: only the second test goes red. The golden still passes with one id, which is the intended pin. Then use `otherTaskIds[0]`. Expected: the second test goes red.
- [ ] **Step 7: Commit.** `refactor(ledger): the reconcile template names every other task`.

---

### Task 4: Schema 14, the `pending_decisions` table and its store module

**Files:**
- Modify: `src/control/migrations.ts`. Set `schemaVersion = "14"` and add `schema13To14`, appended to `initialSchema`. `migrateSchema` handles `"13"`, and every earlier branch also execs `schema13To14`.
- Modify: `src/control/store.ts:88`. Add `"13"` to the accepted older versions.
- Create: `src/control/pendingDecisions.ts`
- Modify the version pins from `"13"` to `"14"` and the "future" probe from `'14'` to `'15'`, in:
  - `tests/control/schema10.test.ts`, `schema9.test.ts`, `schema8.test.ts`
  - `requirementRecords.test.ts:29`, `agentUpdates.test.ts:258`, `tokenPolicyMigration.test.ts:11,24`, `shutdownHealing.test.ts:131`
  - `fixtures/savedResultWorld.ts:70,80`
  - Re-run the `grep -rn "\"13\"\|'13'\|value='14'" tests` sweep first: Rule 14 says re-measure.
- Test: `tests/control/pendingDecisions.test.ts`, plus a 13→14 case in `tests/control/schema10.test.ts`

The new table:

```sql
CREATE TABLE IF NOT EXISTS pending_decisions(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
  run_id TEXT NOT NULL REFERENCES runs(id), ledger_run TEXT NOT NULL, entry_index INTEGER NOT NULL CHECK(entry_index >= 0),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')), body TEXT NOT NULL, UNIQUE(ledger_run, entry_index)) STRICT;
CREATE INDEX IF NOT EXISTS pending_decisions_group ON pending_decisions(group_id, state);
```

`run_id` is the control run that landed the work, which is the DB row. `ledger_run` is the file's run id (`run_id` or `reconcile-<run_id>`). `body` is the `PendingEntry` JSON, plus `approvedId?` or `correctionId?` once settled.

**Interfaces:**
- Consumes: `PendingEntry`, `pendingEntrySchema` (Task 2).
- Produces:
  - `export interface PendingDecisionRow { pendingId: string; groupId: string; runId: string; state: "pending" | "approved" | "rejected"; entry: PendingEntry; approvedId: string | null; correctionId: string | null }`
  - `export function insertPendingDecisions(store: ControlStore, groupId: string, runId: string, pending: readonly PendingEntry[]): void`. It runs `INSERT … ON CONFLICT(id) DO NOTHING` and is called inside the caller's transaction.
  - `export function listPendingDecisions(store: ControlStore, groupId: string): PendingDecisionRow[]`, ordered by `run_id, ledger_run, entry_index`.
  - `export function readPendingDecision(store: ControlStore, pendingId: string): PendingDecisionRow | null`
  - `export function settlePendingDecision(store: ControlStore, pendingId: string, outcome: { state: "approved"; approvedId: string } | { state: "rejected"; correctionId: string }): void`

- [ ] **Step 1: Write the failing tests.**
  - `insertPendingDecisions` twice with the same entries leaves 1 row per id, and the first body wins.
    - Mutation: change `DO NOTHING` to `DO UPDATE`. Expected: the body assertion goes red.
  - `settlePendingDecision` flips the state and is read back through `readPendingDecision`.
  - Schema: a fresh store is at `"14"` with the table present. A store set to `'13'` opens, migrates and keeps its rows byte-identical (pattern of `schema10.test.ts:20-31`). `'15'` is refused with `control-schema-unsupported`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/pendingDecisions.test.ts tests/control/schema10.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the files above, plus every file whose version pin you changed.** Expected: all pass.
- [ ] **Step 5: Commit.** `feat(control): schema 14 stores pending decisions`.

---

### Task 5: `stepD` lands the run's decisions in its merge commit

**Files:**
- Modify: `src/control/driveRecord.ts`. Add `stagedPending: z.array(pendingEntrySchema).default([])` and `ledgerCommit: commitSchema.nullable().default(null)` to `driveRecordSchema`. Both are defaulted so old bodies parse.
- Modify: `src/control/driverLanding.ts:82-115` (`stepD`), `:43-51` (`markLanded`)
- Create: `src/control/ledgerTree.ts`. Only `stageAndRecord` is needed now. Task 6 adds the tree functions.
- Test: `tests/control/driverDecisions.test.ts`. It uses `driverHarness` with `decisions` from Task 1.

**Interfaces:**
- Consumes: `reportedDecisionsOf`, `writeRunLedger`, `runEvidence`, `ccloopEvidenceString`, `insertPendingDecisions`, `savedReport` (`executionDriver.ts:742`).
- Produces:
  - `export async function runLedgerInputs(deps: ExecutionDriverDeps, runId: string): Promise<{ reported: ReportedDecisions; evidence: string[]; at: string }>` in `driverLanding.ts`. It reads `savedReport`, `drive.attemptSha` and `deps.ccloopBin`, and takes `at` from `deps.now?.() ?? new Date()`.
  - `export function stagePending(deps: ExecutionDriverDeps, runId: string, pending: PendingEntry[]): void`. It replaces `drive.stagedPending` inside `write(...)`.
  - `markLanded` additionally calls `insertPendingDecisions(store, run.groupId, runId, run.drive.stagedPending)` and clears `stagedPending`, in its existing transaction.

The `stepD` produce step changes from `merge --no-ff -m …` to this sequence:
1. `merge --no-ff --no-commit incomingRef` (conflict → abort → `null`, as today).
2. `writeRunLedger(join(landing, ".decisions"), { ledgerRun: runId, reported, codeAuthored: [], at, evidence })`.
3. If `writtenIds.length > 0`: `git add -f .decisions/<runId>.jsonl`. `-f` handles Review Focus 1.
4. `git commit --no-edit -m "orca: land <runId>"` with `ORCA_IDENTITY`. MERGE_HEAD makes it the same two-parent merge, so `findLanding` is unchanged.
5. `stagePending(...)` before the produce returns, which puts it before the CAS.

The recovery path (`findLanding` hit) skips produce, so it never appends twice. It reaches `markLanded`, which inserts the pending items staged before the crash.

- [ ] **Step 1: Write the failing tests.** Every assertion reads git, not a return value (§10.7).

```ts
it("lands two reported decisions inside the landing merge commit", async () => {
  const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good(), good()] }); try {
    const runId = await t.claim(); await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
    const landed = t.body(runId).drive.landedCommit;
    const lines = git(t.repo, "show", `${landed}:.decisions/${runId}.jsonl`).split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual([`${runId}/agent-0`, `${runId}/agent-1`]);             // mutation D1: drop the append -> red
    expect(lines[0].evidence.slice(0, 2)).toEqual([`run ${runId}`, `attempt ${t.body(runId).drive.attemptSha}`]);
    expect(git(t.repo, "rev-parse", `${landed}^2`)).toBe(t.body(runId).drive.attemptSha);
  } finally { await t.h.dispose(); }
});
it("lands the task and records a bad-kind entry as pending, not in the ledger", /* decisions [good({kind:"opinion"}), good()] -> file holds only agent-1; listPendingDecisions(store,"g") has pending-<run>-0 with reason 'kind-unknown:"opinion"'; mutation D2: skip insertPendingDecisions in markLanded -> red */);
it("lands a non-executable undo.how as pending (tier 0) and the task as landed", /* undo.how "revert it"; no .decisions/<run>.jsonl in landed tree (git cat-file -e fails); pending reason starts "tier-0:" */);
it("records a non-array decisions value as one pending item and lands", /* Review Focus 2 */);
it("leaves the landed tree exactly as before when no decisions are reported", /* decisions absent: `git ls-tree -r --name-only landed` has no .decisions/ entry */);
it("lands the decision file even when the target ignores .decisions/", /* commit `.gitignore` with ".decisions/" on main before claim; file present in landed tree; Review Focus 1; mutation: drop -f -> red */);
it("does not append twice when it finds a landing it already made", /* the existing recovery scenario of driverLanding.test.ts:56-71 with decisions; after recovery `git show` has 2 lines, pending rows unchanged; mutation D3: run produce on the recovery path -> red */);
it("does not duplicate lines or pending items on a moved-tip retry", /* beforeCas moves the tip once (driverLanding.test.ts:38-54 pattern); final landed file has exactly the run's lines once; pending count 1 for one bad entry */);
it("inserts no pending item for a run whose landing never completed", /* beforeCas leaves a stale ref lock (driverLanding.test.ts:76+ pattern) -> run blocked at D; listPendingDecisions empty; Review Focus 4 */);
```

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/driverDecisions.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `tests/control/driverDecisions.test.ts tests/control/driverLanding.test.ts tests/control/driverRecovery.test.ts tests/control/driveRecord.test.ts`.** Expected: all pass. `driverLanding.test.ts:27`'s message assertion still holds.
- [ ] **Step 5: Mutations D1, D2, D3** (named in the test comments), plus **D4**: make `stagePending` append to `stagedPending` instead of replacing it. The moved-tip test's pending count goes red. Run them in a clone and confirm each is seen red.
- [ ] **Step 6: Commit.** `feat(control): a landing merge carries the run's decisions`.

---

### Task 6: `finishReconcile` builds its tree with both ledger files

**Files:**
- Modify: `src/control/driveRecord.ts`. Add `conflictBlocks: z.array(z.object({ path: z.string().min(1), startLine: safeInteger, endLine: safeInteger }).strict()).optional()` to `reconcileRecordSchema`.
- Modify: `src/control/driverLanding.ts`.
  - `beginReconcile:182-184`: persist `conflict.blocks` as `conflictBlocks`.
  - `finishReconcile:329-372`.
  - `readLoopState:227` gains a sibling `readLoopStateRaw(loopDir): unknown`.
- Modify: `src/control/ledgerTree.ts`
- Modify: `tests/control/fixtures/fake-ccloop-run.mjs`. A `decisions` knob in the table is written as `decisions` into `loop-state.json`.
- Test: `tests/control/driverReconcileDecisions.test.ts`. It uses the `twoConflicting` pattern of `driverReconcile.test.ts:34-55`.

**Interfaces:**
- Produces (in `ledgerTree.ts`):
  - `export async function exportLedgerDir(repo: string, treeish: string, into: string): Promise<void>`. It writes every top-level `.decisions/*.jsonl` of `treeish` into `into` (`git ls-tree --name-only <treeish> .decisions/`, then `git show`).
  - `export async function treeWithLedgerFiles(repo: string, baseTree: string, fromDir: string, names: string[]): Promise<string>`. It uses a temp index (`GIT_INDEX_FILE=<tmp>` through `git(…, { env })`): `read-tree`, then `hash-object -w` per file, then `update-index --add --cacheinfo 100644,<blob>,.decisions/<name>`, then `write-tree`. The temp index file is removed in `finally`.
- Consumes: `reconcileDecision` (Task 3), `writeRunLedger` (Task 2), `stagePending` (Task 5).

`finishReconcile` changes after the marker check and before `rebuildMergeCommit`:
1. `exportLedgerDir(record.copyPath, tree, tmp)`.
2. `writeRunLedger(tmp, …)` for `runId`. Its inputs are `runLedgerInputs`, the original run's report and `attemptSha`.
3. `writeRunLedger(tmp, …)` for `record.reconcileRunId`:
   - `codeAuthored = [{ ...reconcileDecision(record.reconcileRunId, 1, run.taskId, record.otherTaskIds ?? [record.otherTaskId], { conflictedPaths, conflictCommit, copyPath, wTip: record.old, blocks: record.conflictBlocks }, "orca/<groupId>", at), evidence }]`
   - `reported = reportedDecisionsOf(readLoopStateRaw(loopDir))`
   - `evidence = runEvidence(record.reconcileRunId, attemptSha, ccloop)`
4. `tree = await treeWithLedgerFiles(record.copyPath, tree, tmp, namesWritten)`.
5. `stagePending(deps, runId, [...pendingA, ...pendingB])` before `landOnTip`.
6. The swapped branch of the final `write` inserts `stagedPending` the same way `markLanded` does. Extract a shared helper `landedWithPending(store, run)` so the two paths cannot diverge.

A record with no `conflictBlocks` was written before this field existed. For one, the template is **not** written, so no false "0 block(s)" line is put on the ledger. One line goes to stderr: `orca-driver: <runId>: reconcile decision skipped: record predates conflictBlocks`.

- [ ] **Step 1: Write the failing tests.**
  - `it("lands a reconciliation whose merge holds the run's file and the reconcile run's file")`:
    - The run reports one decision, and the fake reconcile reports one.
    - `git show <landed>:.decisions/reconcile-<runId>.jsonl` gives ids `[reconcile-<runId>/1, reconcile-<runId>/agent-0]`, and line 1 has `kind: "reconcile"`.
    - `git show <landed>:.decisions/<runId>.jsonl` gives `[<runId>/agent-0]`.
    - `<landed>^2` is the run's attempt.
    - Mutation **R1**: `finishReconcile` hands the unmodified `tree` to `rebuildMergeCommit`. Expected: red.
  - `it("the reconcile line has the shared template's text")`. Its `question` equals the text of `reconcileDecision` called with the same inputs (§7: shared function, not a copy).
  - `it("re-lands on a moved tip without duplicating pending items")`. The fake reconcile reports one bad entry. `beforeCas` moves the tip once, and the second landing (reconciled or clean) leaves exactly one `pending_decisions` row per id.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/driverReconcileDecisions.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `tests/control/driverReconcileDecisions.test.ts tests/control/driverReconcile.test.ts tests/control/driverReconcileN.test.ts`.** Expected: all pass.
- [ ] **Step 5: Mutation R1, seen red.**
- [ ] **Step 6: Commit.** `feat(control): a reconciled landing carries both runs' decisions`.

---

### Task 7: The empty result's ledger-only commit, and the boundary non-port

**Files:**
- Modify: `src/control/ledgerTree.ts`
- Modify: `src/control/executionDriver.ts` (`stepE:758-777`, inside `if (run.state === "landed")` before `archiveRun`)
- Test: `tests/control/driverDecisionsEmpty.test.ts`

**Interfaces:**
- Produces: `export async function commitLedgerOnGroupBranch(input: { repo: string; roots: WorkspaceRoots; groupId: string; worktreeName: string; message: string; write: (decisionsDir: string) => Promise<string[]>; beforeCas?: () => Promise<void> }): Promise<{ kind: "swapped"; commit: string } | { kind: "moved" } | { kind: "nothing" }>`. It:
  1. Detaches a worktree at `<workspacesRoot>/<worktreeName>` on the tip of `refs/heads/orca/<g>`.
  2. Runs `write`, which returns the names it wrote.
  3. If there are none, returns `nothing`.
  4. Otherwise runs `git add -f`, makes a single-parent commit with `ORCA_IDENTITY`, and calls `compareAndSwap` (`workspace.ts:126`).
  5. Removes the worktree in `finally`.
- Consumes: Task 2; `stagePending` (Task 5); `landedWithPending(store, run)` (extracted in Task 6).

`stepE`, for `drive.landedCommit === null && drive.ledgerCommit === null`:
1. Compute the run's ledger.
2. If the tip already has `.decisions/<runId>.jsonl` (`git cat-file -e`), adopt the tip's newest first-parent commit whose subject is `orca: decisions <runId>` as `ledgerCommit`. This is crash recovery.
3. Otherwise call `commitLedgerOnGroupBranch` with message `orca: decisions <runId>` and worktree name `ledger-<runId>`:
   - `moved`: return `false`, and the next round retries.
   - `nothing`: insert pending directly.
   - `swapped`: set `ledgerCommit` and insert `stagedPending` in one `write`.
4. `landedCommit` stays `null`, so acceptance evidence (`executionDriver.ts:769`) is unchanged for an empty result (D14 kept).

- [ ] **Step 1: Write the failing tests.**
  - `it("records an empty result's decisions in a ledger-only commit on the group branch")`:
    - `files: () => ({})` and one good decision.
    - After settle, `git show refs/heads/orca/g:.decisions/<runId>.jsonl` has 1 line, `drive.ledgerCommit` is that commit, and `drive.landedCommit` is `null`.
    - The acceptance outbox row is absent, as today.
    - Mutation **E1**: skip the commit. Expected: red.
  - `it("makes no ledger-only commit when there is nothing to write")`. With decisions absent, the commit count on `orca/g` is unchanged.
  - `it("still blocks an out-of-bounds run and writes no decision")` (§3.2 boundary, §7):
    - The task writes outside `targetPaths` and reports one decision.
    - The run is blocked with `out-of-bounds:`.
    - `git ls-tree -r refs/heads/orca/g` has no `.decisions/` entry, and `pending_decisions` is empty.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/driverDecisionsEmpty.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, together with `tests/control/driverSettle.test.ts`.** Expected: all pass.
- [ ] **Step 5: Mutation E1, seen red.**
- [ ] **Step 6: Commit.** `feat(control): an empty result's decisions land in a ledger-only commit`.

---

### Task 8: `readLedgerAtRef` and the group decisions view

**Files:**
- Create: `src/control/ledgerAtRef.ts`
- Create: `src/panel/groupDecisions.ts`
- Modify: `src/control/webProtocol.ts`. Add `groupDecisionsViewSchema` next to `repositoryIntegrationSchema` (`:1754`).
- Modify: `src/panel/controlApi.ts`. Add the route `GET /api/control/groups/:groupId/decisions` inside `registerControlReadRoutes`, so both the web and the socket (agent read path) get it.
- Modify: `web/src/controlTypes.ts` with the mirrored type, and `tests/panel/webParity.test.ts` with a parity line.
- Test: `tests/control/ledgerAtRef.test.ts`, `tests/panel/groupDecisionsApi.test.ts`

**Interfaces:**
- Produces:
  - `export async function readLedgerAtRef(repo: string, ref: string): Promise<Array<{ path: string; value: unknown }> | null>`. It reads every `.decisions/**/*.jsonl` (archives included) at `ref`, and returns `null` when the ref does not resolve. Unparseable lines are skipped, as `readLedgerLeniently` does.
  - `export type DecisionWhere = "working-tree" | "target" | "group-branch"`
  - `export async function ledgerSources(store: ControlStore, repo: string, groupId: string): Promise<Array<{ where: DecisionWhere; ref: string | null }>>`. The order is:
    1. the working tree (`ref: null`);
    2. `refs/heads/<target>` for `local`, or `refs/remotes/<remote>/<target>` for the push schemes (from `readGroupIntegration`; omitted under `keep`);
    3. `refs/heads/orca/<groupId>`.
  - `export async function findDecision(repo: string, sources: …, id: string): Promise<{ where: DecisionWhere; value: unknown } | null>`. The first source holding the id wins.
  - `export async function readGroupDecisionsView(store: ControlStore, repo: string, groupId: string): Promise<GroupDecisionsViewV1>`
  - `GroupDecisionsViewV1 = { schema: "orca-group-decisions-v1"; groupId; projectKey: string | null; pendingCount: number; tasks: Array<{ taskId; runs: Array<{ runId; reported: "absent" | "array" | "malformed"; decisions: Array<{ id; where: DecisionWhere; question; chose; kind; scope }>; pending: Array<{ pendingId; reason; question: string | null; chose: string | null; undoHow: string | null; state }>; unlanded: Array<{ entryIndex; question: string | null; chose: string | null }> }> }> }`

How the view builds its fields:
- **Landed runs** (`landedCommit` or `ledgerCommit` non-null): `decisions` are the rows of `<runId>.jsonl` and `reconcile-<runId>.jsonl`, each labelled with the first source holding it.
- **`unlanded`**: a run whose state is not in `{starting, start-pending, accepted, unknown, collected, reconciling, landed}` and that has neither commit lists its `savedReport` entries here. A run with no saved report lists none. This is read time, from the report already stored in the control DB (§10.4).
- **`projectKey`**: `projectKeyOf(repo)`, or `null` when it throws a `CorrectRejection`.

- [ ] **Step 1: Write the failing tests.**
  - `ledgerAtRef.test.ts`:
    - `it("reads ledger lines at a ref that is not checked out, archives included")`. Build commits with plumbing (`integrationGit.test.ts:37-49` `commitOn` pattern).
    - `it("returns null for a ref that does not exist")`.
    - `it("labels an id by the first source holding it")`. The same id on the target and the group branch gives `"target"`.
  - `groupDecisionsApi.test.ts`, with `driverHarness`, the group's integration set to `LOCAL_MERGE`, and a remote URL added so `projectKey` resolves:
    - `it("shows a landed decision as group-branch before integration and as target after")`. Run the driver until landed, then GET: the row has `where: "group-branch"`. Then `integratePendingGroups` (`integrationGit.test.ts` deps pattern), then GET: the row has `where: "target"`, and `git show main:.decisions/<runId>.jsonl` holds it (§7 integration criterion).
    - `it("lists pending items with their reason and counts them")`.
    - `it("says a run reported no decisions")`. The fake reports no field, so the result is `reported: "absent"`.
    - `it("lists a blocked run's reported entries as unlanded")`. Use `behaviour: () => "failed"` with decisions.
    - `it("answers on the socket channel too")`. An agent principal GETs the route and gets 200, the agent read path (goal.md §1.2).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus `tests/panel/webParity.test.ts`.** Expected: all pass.
- [ ] **Step 5: Mutation.** Swap source order 2 and 3. Expected: the "after integration" assertion goes red.
- [ ] **Step 6: Commit.** `feat(panel): a group's decisions, read from refs`.

---

### Task 9: `approve-pending-decision` (human-only)

**Files:**
- Modify: `src/control/webProtocol.ts`.
  - Verb in `commandVerbSchema`.
  - `approvePendingDecisionPayloadSchema = z.object({ pendingId: idSchema, undoHow: nonemptyString }).strict()`.
  - Raw and effective variants with a group target (pattern of `:905`, `:962`).
- Modify: `src/panel/humanOnly.ts`. `"approve-pending-decision": "human-only"`.
- Modify: `src/panel/controlApi.ts`. Route `{ path: "/api/control/groups/:groupId/decisions/approve", verb: "approve-pending-decision", target: fromParams }` and the switch case.
- Create: `src/control/decisionCommands.ts`
- Modify: `src/control/webService.ts`. `async approvePendingDecision(command)`, shaped like `resolveIntegrationConflict` (`:665-672`).
- Modify: `src/control/errors.ts`. Durable codes, in both `durableCommandErrorStatuses` and `v1WebErrorCodes`:
  - `pending-decision-not-found` (404)
  - `pending-decision-settled` (409)
  - `decision-undo-not-executable` (400)
  - `pending-decision-entry-invalid` (400)
  - `decision-approve-reconciling` (409)
  - `decision-approve-tip-moved` (409)
  - `integration-busy` is reused.
- Modify: `skills/orca-control/SKILL.md` (row `| \`POST groups/<groupId>/decisions/approve\` | approve-pending-decision | \`{"pendingId":"pending-run-x-0","undoHow":"git revert --no-edit <sha>"}\` |`, and add it to the owner-only list at `:151`), `tests/entry/skill.test.ts` (`schemaByVerb`).
- Test: `tests/control/approveDecision.test.ts`, plus a case in `tests/panel/humanOnly.test.ts`.

**Interfaces:**
- Consumes:
  - `readPendingDecision`, `settlePendingDecision` (Task 4)
  - `normalizeAgentEntry` (Task 2)
  - `findDecision`, `ledgerSources` (Task 8)
  - `commitLedgerOnGroupBranch` (Task 7)
  - `preflightWebCommand`, `applyWebCommand`
  - `readGroupIntegration`
- Produces:
  - `export type ApprovePendingDecisionCommand = Extract<RawAuthorityCommandV1, { verb: "approve-pending-decision" }>` (and `RejectPendingDecisionCommand` likewise, used in Task 10), in `decisionCommands.ts`. This follows `integrationCommands.ts:15`.
  - `export type ApprovePrepared = { kind: "already-present"; id: string } | { kind: "committed"; id: string; commit: string } | { kind: "refused"; code: string; detail?: string }`
  - `export async function prepareApproval(store: ControlStore, roots: WorkspaceRoots, repo: string, command: ApprovePendingDecisionCommand): Promise<ApprovePrepared>`
  - `export function applyApprovePendingDecision(deps: { store: ControlStore }, command, prepared: ApprovePrepared): CommandSuccessV1 | CommandErrorBodyV1`. It throws `prepared`'s refusal inside the transaction, so the refusal is booked. When `committed` lands while the integration state is `blocked` or `conflict`, it resets the integration to idle with the same field reset as `applyRetryIntegration` (`integrationCommands.ts:158`), extracted to `resetIntegrationForRetry(current)` and used by both. It marks the row approved and returns `result: { kind: "pending-decision-approved", pendingId, decisionId }`.

`prepareApproval` checks, in this order:
1. Row missing → `pending-decision-not-found`. State `approved` → `no-op-command`. State `rejected` → `pending-decision-settled`.
2. `normalizeAgentEntry(entry, { …, undoHow })`:
   - a `tier-0:` reason → `decision-undo-not-executable` (detail: the reason);
   - any other reason → `pending-decision-entry-invalid` (detail: the reason).
   - `evidence` gains `` `undo.how by ${actorId} via approve-pending-decision ${commandId}` `` (goal.md §1.1: who wrote what is visible).
3. `findDecision(repo, ledgerSources, agentDecisionId(ledgerRun, entryIndex))` found → `already-present` (§10.5 crash recovery).
4. The group's integration state is `resolving` → `integration-busy`. Any active run of the group is `reconciling` → `decision-approve-reconciling` (Review Focus 3).
5. `commitLedgerOnGroupBranch` with message `orca: approve <pendingId>`, worktree name `approve-<pendingId>`, and a `write` that calls `appendEvents(dir, ledgerRun, [event])`. Retry on `moved` up to 3 times, then `decision-approve-tip-moved`.

`webService.approvePendingDecision` calls `preflightWebCommand` first. A replay, a stale revision or an archived group (`commandLedger.ts:173`) answers before any git runs, so an archived group is refused `group-archived` with the item still pending (§10.5).

- [ ] **Step 1: Write the failing tests.** All of them use `driverHarness` with a landed run that has one tier-0 pending item. The approve is sent through `t.service.approvePendingDecision(t.h.command("approve-pending-decision", {...}))`, and through HTTP for the access cases.

```ts
it("approve writes the decision with the human's undo.how on the group branch", async () => {
  const r = await approve({ pendingId, undoHow: `git revert --no-edit ${"e".repeat(40)}` });
  expect(r).toMatchObject({ result: { kind: "pending-decision-approved", decisionId: `${runId}/agent-0` } });
  const line = JSON.parse(git(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`).split("\n").at(-1)!);
  expect(line).toMatchObject({ id: `${runId}/agent-0`, undo: { how: `git revert --no-edit ${"e".repeat(40)}` } });
  expect(readPendingDecision(t.h.store, pendingId)!.state).toBe("approved");
});
it("refuses an undo.how that still fails the gate, keeping the item pending", /* undoHow "revert it" -> error.code decision-undo-not-executable; state "pending"; branch unchanged */);
it("only marks approved when the line is already on the branch (a crash between git and DB)", /* approve once, reset row state to 'pending' by SQL, approve again with a new commandId -> commit count on orca/g unchanged, state approved */);
it("re-arms a blocked local integration so the approved line reaches the target", /* LOCAL_MERGE, set integration state 'blocked'; approve; state 'idle'; integratePendingGroups; git show main:.decisions/<run>.jsonl has the line */);
it("is refused while another run of the group is reconciling", /* set a sibling run body state 'reconciling'; code decision-approve-reconciling; Review Focus 3 */);
it("appends a second approval to the same run file", /* two tier-0 entries; approve both; file on orca/g has both ids in order; Review Focus 5 */);
it("refuses an archived group by name and keeps the item pending", /* archive-group then approve -> group-archived */);
```

  - In `tests/panel/humanOnly.test.ts`, extending the `integrationApi.test.ts:103-112` pattern: `it("refuses approve-pending-decision from an agent on the socket and a member over the Web")`. Expected: `[403, "control-verb-human-only"]` for both.
    - Mutation **A1**: set `VERB_ACCESS["approve-pending-decision"] = "any"`. Expected: red.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/control/approveDecision.test.ts tests/panel/humanOnly.test.ts tests/entry/skill.test.ts`
- [ ] **Step 3: Implement.** Add en/zh entries for every new code (`tests/panel/refusalCoverage.test.ts` enforces it).
- [ ] **Step 4: Run them, plus `tests/panel/refusalCoverage.test.ts tests/control/integrationGit.test.ts`.** Expected: all pass.
- [ ] **Step 5: Mutation A1, and "skip the `findDecision` check".** The crash test's commit count goes red.
- [ ] **Step 6: Commit.** `feat(control): an owner approves a refused decision with an executable undo`.

---

### Task 10: The corrections store's pending target, and `reject-pending-decision` (human-only)

**Files:**
- Modify: `src/corrections/schema.ts`.
  - `decisionId` becomes optional.
  - Add `runId` and `pendingId`, both optional.
  - `superRefine`: exactly one of `decisionId`, or both `runId` and `pendingId` (debug-task design §12.3).
- Modify: `src/corrections/fields.ts:35`. Append `"runId", "pendingId"` to `CORRECTION_FIELDS`. An absent field is omitted, so every existing id is unchanged.
- Modify: the readers `npm run typecheck` flags after the widening, in `src/metrics/*`, `src/memory/*`, `src/corrections/correct.ts` and `src/panel/coverage.ts`.
  - Each one skips pending-target rows, with a one-line comment pointing at the debug-task design §12.3, whose plan adds the "N corrections on unrecorded decisions" line.
  - `orca correct --close` on a pending-target id is refused by name with `correction-target-not-a-decision`.
  - List the readers you touched in the commit body.
- Modify: `webProtocol.ts`. Add `rejectPendingDecisionPayloadSchema = z.object({ pendingId: idSchema, because: nonemptyString.optional() }).strict()`, the verb, and its variants.
- Modify: `humanOnly.ts`. `"reject-pending-decision": "human-only"`.
- Modify: `controlApi.ts`. Route `/api/control/groups/:groupId/decisions/reject`.
- Modify: `SKILL.md` and `skill.test.ts`, as in Task 9.
- Modify: `webService.ts`, `decisionCommands.ts`.
- Modify: `WebServiceDeps` (`webService.ts:71`). Add `correctionsDir?: string`. `src/panel/controlAssembly.ts:202` passes `correctionsDir(process.env)`.
- Modify: `errors.ts`. Add `pending-decision-correction-failed` (409, detail: the `CorrectRejection` code).
- Test: `tests/control/rejectDecision.test.ts`, `tests/corrections/pendingTarget.test.ts`

**Interfaces:**
- Consumes: `projectKeyOf` (`src/corrections/projectKey.ts:61`), `correctionRowFrom`, `recordNewCorrection`, `readCorrections`.
- Produces:
  - `export async function prepareRejection(store: ControlStore, repo: string, correctionsDir: string, command: RejectPendingDecisionCommand, now: () => Date): Promise<{ kind: "recorded"; correctionId: string } | { kind: "refused"; code: string; detail?: string }>`. It works as follows:
    - The state checks are the same as in Task 9 (`rejected` → this rejection's existing correction is found and returned, so it is idempotent; `approved` → `pending-decision-settled`).
    - It looks for an existing row with the same `projectKey` and `pendingId`. If found, it returns that correction (§10.5: a second reject finds the first).
    - Otherwise it records `{ projectKey, runId, pendingId, kind: "wrong", because, by: command.actorId }`.
    - `because` = (the human's line, if any, then `"\n"`), then `` `question: ${q}\nchose: ${c}` `` from the pending entry (strings, or `"(missing)"`).
  - `applyRejectPendingDecision(deps, command, prepared)` marks the row rejected with its `correctionId` and returns `result: { kind: "pending-decision-rejected", pendingId, correctionId }`.
- **Not in this plan:** opening the debug group. That is the debug-task plan (`correction-debug-open`, debug-task design §3.1/§12.4). It reads `correctionId` from this verb's result.

- [ ] **Step 1: Write the failing tests.** Every test sets `const dir = await mkdtemp(join(tmpdir(), "orca-corrections-"))` and passes it as `correctionsDir`. The harness repo gets `git remote add origin https://example.invalid/o/r.git` so `projectKeyOf` resolves.
  - `pendingTarget.test.ts`:
    - `it("keeps every existing correction id byte-identical")`. A stored fixture row with `decisionId` gives the same `deriveCorrectionId` as at the anchor; capture the literal at the base commit first, as in Task 3.
    - `it("accepts { runId, pendingId } and refuses decisionId together with pendingId")`.
  - `rejectDecision.test.ts`:
    - `it("reject records a wrong-kind correction naming the run and the pending item")`. The `readCorrections(dir)` row is `{ runId, pendingId, kind: "wrong" }`, and `because` contains `question: ` and the human's line. The row state is `rejected`.
    - `it("a second reject finds the first correction instead of recording another")`. `readCorrections(dir).length` stays 1, and the same `correctionId` is returned.
    - `it("rejects with no line of the human's")`. `because` starts with `question: `.
    - `it("refuses reject from an agent with the human-only code")`, over HTTP on the socket: `[403, "control-verb-human-only"]`.
    - `it("names a repository with no remote")`. Without the remote, the code is `pending-decision-correction-failed`, the detail is `target-has-no-remote`, and the row stays pending.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus `npm run typecheck`, `tests/corrections`, `tests/metrics` and `tests/panel/correctApi.test.ts`.** Expected: all pass, with nothing skipped (Rule 12).
- [ ] **Step 5: Mutation.** Drop the existing-row lookup. Expected: the "second reject" test goes red because the length becomes 2.
- [ ] **Step 6: Commit.** `feat(control): an owner rejects a refused decision as a correction`.

---

### Task 11: The Web UI

**Files:**
- Create: `web/src/RunDecisions.tsx`
- Modify: `web/src/controlApi.ts`.
  - `fetchGroupDecisions(groupId)`.
  - `ControlAction` variants for both verbs.
  - `controlCommandPath` cases `${group}/decisions/approve` and `${group}/decisions/reject`.
- Modify: `web/src/controlTypes.ts`. The verb union (`:492`).
- Modify: `web/src/TaskDetail.tsx`. A `<RunDecisions>` section per run, after `TaskResults` (`:233`).
- Modify: `web/src/ControlGroupView.tsx`.
  - A group badge in the header when `pendingCount > 0`.
  - The task row badge.
  - A new `onCorrectDecision?: (projectKey: string, decisionId: string) => void` prop.
- Modify: `web/src/App.tsx`. Wire `onCorrectDecision` to open the decision's detail the way `openDecisionRow` does (`App.tsx:888`).
- Modify: `web/src/locales/en.ts`, `zh.ts`.
- Test: `web/tests/controlDecisions.test.tsx`

**Interfaces:**
- Consumes: `GroupDecisionsViewV1` (Task 8), and the verbs of Tasks 9 and 10.
- Produces:
  - `RunDecisions(props: { groupId: string; revision: number; run: GroupDecisionsViewV1["tasks"][number]["runs"][number]; projectKey: string | null; onCommand: (a: ControlAction) => void; onCorrect?: (projectKey: string, decisionId: string) => void; archived: boolean })`
  - Copy keys: `control.decisions.{needsHuman, approve, reject, undoHowLabel, rejectBecauseLabel, correct, correctUnavailable, notIntegrated, unlanded, notReported, malformed}`. zh values: 需要人确认, 批准, 驳回, 纠正, 尚未集成, 未落地的决定, "这次运行没有报告任何决定". en values: "Needs human confirmation", "Approve", "Reject", "Correct", "Not yet integrated", "Decisions that did not land", "This run reported no decisions".

Behaviour:
- **Pending row.** It shows the agent's `question`/`chose` and the reason. A text field is prefilled with the agent's `undoHow` (goal.md §1.1: prefilled, the human may change it). Approve sends `{ pendingId, undoHow }`. Reject has an optional one-line field and sends `{ pendingId, because? }`, with `because` omitted when the field is empty, never `""`.
- **Decision row.** It has the 纠正 button. When `where === "working-tree"` and `projectKey !== null`, it calls `onCorrect`. Otherwise the button is disabled and the note `correctUnavailable` names why. `where !== "working-tree"` rows also carry `notIntegrated` when `where === "group-branch"`.
- **`reported === "absent"`.** It shows `notReported` in so many words (§3.1).

- [ ] **Step 1: Write the failing tests** (pattern of `web/tests/gitScheme.test.tsx`).
  - `it("shows 需要人确认 on the task and on the group when an item is pending")`.
  - `it("Approve sends the prefilled undo.how, edited")`. The `onCommand` payload equals `{ pendingId, undoHow: "<edited>" }` and the verb is `approve-pending-decision`.
  - `it("Reject without a line omits because")`. The payload is `{ pendingId }`.
  - `it("the 纠正 action opens the correction for a working-tree decision")` and `it("the 纠正 action is disabled, with a note, for a not-yet-integrated decision")`.
  - `it("lists a blocked run's entries under 未落地的决定")`.
  - `it("says the run reported no decisions")`.
  - Mutation: render Approve without the prefilled value. Expected: the second test goes red.
- [ ] **Step 2: Run them and confirm they fail.** `npm exec --workspace web -- vitest run tests/controlDecisions.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run check --workspace web` and `npx vitest run tests/panel/refusalCoverage.test.ts tests/panel/webParity.test.ts`.** Expected: all pass, with i18n key parity (`web/tests/i18nKeys.test.ts`) green.
- [ ] **Step 5: Agent path end to end.** One root test, `tests/panel/decisionsAgentPath.test.ts`:
  - On the socket channel an agent GETs `/api/control/groups/g/decisions` and sees the pending item.
  - Its approve and reject POSTs get `403 control-verb-human-only`.
  - An owner's Web POSTs succeed.

  This is the §10.7 "agent path" criterion.
- [ ] **Step 6: Commit.** `feat(web): pending decisions, approve, reject and correct in the panel`.

---

### Task 12 (BLOCKED on ccloop): A contract test against ccloop's real output

**Status: blocked.** It waits on the ccloop design that makes the agent emit `decisions` and carries them into ccloop's result (spec §3.1, §8, Rule 16). Do **not** edit ccloop from this plan. §3.1 is **not done** until this task is green (§10.7).

**Files (when unblocked):**
- Modify: `src/control/ccloopPort.ts:36-37` (`collectionSchema` / `collectionV4Schema`), and `:242` (`collect` returns `decisions` when present). If ccloop puts the array elsewhere, change **only** `reportedDecisionsOf`'s input at its two call sites. The adapter stays the single reader.
- Modify: `src/control/driverLanding.ts` `readLoopStateRaw`'s consumer, if ccloop's `run` result carries the reconciling agent's decisions somewhere other than `loop-state.json`.
- Bump the ccloop pin in `package.json` (`verify:ccloop-pin`).
- Test: `tests/control/decisionsContract.test.ts`, gated like `tests/control/webCcloopSmoke.test.ts` (`verify:web-control:consumer`).

**Interfaces:**
- Consumes: the ccloop design's documented field path, and §10.3's instruction text, which belongs in ccloop's execute phase. The text tells the agent what counts as a decision, and that `undo.how` must take the form `git revert --no-edit <sha>`.

- [ ] **Step 1: Write the failing test.** Run real ccloop on a scripted task that reports one decision. Assert `reportedDecisionsOf(report)` is `{ kind: "array" }` with one entry whose `question` matches. Then assert the landed commit's `.decisions/<runId>.jsonl` holds it with Orca's `id`.
- [ ] **Step 2: Run it and confirm it fails against the current pin.** Expected: `kind: "absent"`.
- [ ] **Step 3: Implement the port change.**
- [ ] **Step 4: Run it and confirm it passes, then run `npm run verify`.**
- [ ] **Step 5: Commit.** `feat(control): read ccloop's reported decisions`.

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
