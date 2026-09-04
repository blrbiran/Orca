# Task 11 report — conflict trunk (1): materialisation, the reconciliation contract, S4 / S20

Run: session `c2fd0c3b-0aaf-4a1b-960e-2d6cab3f7ad3`, 2026-09-04. BASE `1ab2882`.
Commits created: `9e5ff19`, `a5c9d93` (both on `main`, not pushed).

---

## 1. What was implemented

**`src/scheduler/reconcile.ts` (new, 422 lines at `9e5ff19`)** — the first half of spec §5's
conflict main line.

| Export | What it is |
|---|---|
| `ConflictBlock` | one `<<<<<<< / ======= / >>>>>>>` region: `path`, `startLine`, `endLine`, `ours`, `theirs` |
| `MaterialisedConflict` | §5.2's conflict after step 2 — **extends `land.ts`'s `ConflictState`** with `conflictCommit` and `blocks` |
| `materialiseConflict(copy, wTip, incomingRef)` | §5.2 steps 1–2: fetch both parents into the copy, re-run the merge there, commit the conflicted tree, enumerate the blocks |
| `ReconciliationPlan` / `planReconciliation(a, b)` | §5.3: the two sides' `requiredChecks` union, or an escalation when it is empty |
| `synthesizeReconcileContract(a, b, contracts, runsDir, conflict)` | §5.2's synthesized contract, written into `runsDir`, plus the §5.2 "both sides' intent" refusal |

**`tests/scheduler/sandbox.ts`** — two additions, in the shared home ruling R1 established:

- `contractObject(s, taskId, spec)` — `writeContract`'s file read back as an object, so no test
  hand-writes a contract shape that could drift from ccloop's `.strict()` schema (finding F2).
- `seedConflictingCopy(s, runId)` + `ConflictFixture` — the exact state `land.ts`'s failed merge
  leaves: target repo on W, a task clone whose attempt edited the same two regions, and
  `refs/orca/<run-id>` in the target repo. **The clone is taken before the target repo commits its
  side**, deliberately, so W's tip is genuinely absent from the copy's object store (see M-FETCH).

**Criteria** — `tests/scheduler/reconcile.test.ts` (4), `scenarios/S20.test.ts` (2),
`scenarios/S4.test.ts` (1). Net **+7 tests: 220 → 227**.

### Deviations from the brief's declared interfaces (all deliberate, all argued)

1. **`ConflictState` → `MaterialisedConflict`.** `land.ts` already exports `ConflictState` for the
   four facts a failed `git merge` leaves. The brief's type is exactly those four plus
   `conflictCommit` and `blocks`, so it **extends** land's rather than shadowing it. Two
   same-named interfaces with different fields in one directory is the drift this project's rubric
   treats as a defect; a rename is the cheaper half of the trade.
2. **`requiredChecksUnion` is imported from `writeSet.ts`, not redeclared or re-exported.** Measured
   fact 1 / Task 5's ruling. It is not re-exported from `reconcile.ts` either — a re-export creates a
   second import path for one symbol, which is the same drift in a milder form. `S4.test.ts` imports
   it from `writeSet.js`.
3. **`synthesizeReconcileContract` is `async`.** It writes a file; every other I/O in
   `src/scheduler/**` is `node:fs/promises`. The **result type** is exactly the brief's
   `{ path: string } | { escalate: string }`.
4. **It takes a fifth argument, `conflict: MaterialisedConflict`.** ccloop's schema requires
   `context.repoPath`, `context.targetPaths` (`.min(1)`), `buildTestCommands` (`.min(1)`) and
   `safetyPolicy.maxFilesTouched` — and the four-argument signature can supply **none** of them.
   Writing a placeholder `repoPath` is precisely the silent degradation §0.1 forbids, and the wrong
   placeholder here is "the person's own repository", which §4.2.1 forbids outright. With the
   conflict in hand every required field is *derived*: `repoPath` = the copy, `targetPaths` =
   the conflicted paths, `maxFilesTouched` = their count.
5. **The execution budget is the max of the two sides**, and a side that declares none is refused.
   §0.1 forbids substituting a number nobody chose, so there are no invented constants in the
   synthesized contract. `maxAttempts` is the one pinned value (1): §5.1 routes a failed
   verification back to a human, so a second attempt would spend budget on a decision already owed
   to someone else. `intentOf` deliberately does **not** require each side to supply `maxAttempts`,
   because nothing consumes it.
6. **`planReconciliation(a, b)` returns a discriminated union** `{escalate: true, why} |
   {escalate: false, requiredChecks}`, so `.escalate` reads on both branches exactly as the brief's
   criterion writes it.

### What was NOT pulled forward

`rebuildMergeCommit` and `writeBoundThenCommit` are Task 12's and are absent. Nothing in
`run.ts` calls `reconcile.ts` yet, so a conflict still escalates at `run.ts:404-419` exactly as
before — S3 (the end-to-end reconcile-and-land scenario) is Task 12's.

**Materialisation was demonstrable end-to-end without any part of Task 12** — the criterion reads
the marker out of the conflict commit with `git show`, and the conflict commit is a complete object
in the copy. No Task 12 seam was needed.

---

## 2. TDD evidence

### RED (criteria before implementation)

```
$ npx vitest run tests/scheduler/reconcile.test.ts \
    tests/scheduler/scenarios/S4.test.ts tests/scheduler/scenarios/S20.test.ts
EXIT=1
 ❯ tests/scheduler/scenarios/S4.test.ts (0 test)
 ❯ tests/scheduler/scenarios/S20.test.ts (0 test)
 ❯ tests/scheduler/reconcile.test.ts (0 test)
Error: Failed to load url ../../src/scheduler/reconcile.js (resolved id: ../../src/scheduler/reconcile.js)
  in /Users/biran/code/skills/loop/Orca/tests/scheduler/reconcile.test.ts. Does the file exist?
 Test Files  3 failed (3)
      Tests  no tests
```

Expected: the module does not exist. This is the weakest form of red, which is why every individual
assertion was afterwards aimed at by a named mutation (§3) rather than left resting on it.

### GREEN

```
$ npx vitest run tests/scheduler/reconcile.test.ts \
    tests/scheduler/scenarios/S4.test.ts tests/scheduler/scenarios/S20.test.ts
EXIT=0
 ✓ tests/scheduler/scenarios/S4.test.ts (1 test) 106ms
 ✓ tests/scheduler/scenarios/S20.test.ts (2 tests) 190ms
 ✓ tests/scheduler/reconcile.test.ts (4 tests) 2617ms
 Test Files  3 passed (3)
      Tests  7 passed (7)
```

### Full gate, on the committed state (`a5c9d93`)

```
$ npm run verify > verify-final.txt 2>&1
EXIT=0  wall_seconds=15
 npm test          : Test Files  39 passed (39)   Tests  227 passed (227)   Duration 6.10s
 verify:scheduler  : Test Files  32 passed (32)   Tests  108 passed (108)   Duration 5.90s
```

Every earlier task's criteria still pass (227 = the 220 recorded at `1ab2882` plus this task's 7).

### English-only scan of the new files

```
$ LC_ALL=C grep -n '[^\x00-\x7F]' src/scheduler/reconcile.ts tests/scheduler/reconcile.test.ts \
    tests/scheduler/scenarios/S4.test.ts tests/scheduler/scenarios/S20.test.ts
```
35 hits, all of them `§`, `—`, `⚠️` or `🔴` in comments — the same glyphs the existing
`src/scheduler/**` uses. **No CJK.** No `.decisions/*.jsonl` file was touched.

---

## 3. Mutations

All run inside `git clone --local /Users/biran/code/skills/loop/Orca <copy>` with the main tree's
`node_modules` symlinked in. Patches below are the literal `git diff` from the copy, pasted whole.

| Mutation | Deletes | Fed | Result |
|---|---|---|---|
| **`M-RECON`** 🔴 | §5.2's "both sides must contribute their intent" check | S20 | **RED** (2 of 2) |
| **`M-EMPTYCHK`** 🔴 | §5.3's empty-union check | S4 | **RED** |
| `M-NOCOMMIT` | the `add -A` + `commit` that materialises the conflict | reconcile.test | **RED** (2 of 4) |
| `M-FETCH` | the fetch of both parents into the copy | reconcile.test | **RED** (4 of 4) |
| `M-BLOCK1` | block enumeration past the first region (`break`) | reconcile.test | **RED** |
| `M-SWAP` | `ours`/`theirs` orientation | reconcile.test | **RED** |
| `M-SLUG` | the taskId path sanitiser | reconcile.test | 🔴 **PASSED first, see §3.1** → RED after fix |
| `M-REPOPATH` | `repoPath` = the copy | reconcile.test | **RED** |
| `M-HALFUNION` | the union in `verification.requiredChecks` (one side only) | reconcile.test | **RED** |
| `M-ONESIDEDGOAL` | side B's goal/successCondition from the synthesized goal | reconcile.test | **RED** |
| `M-ALWAYSESC` | the gate's condition (refuse everything) | S20 | **RED** |
| `M-CONSTMSG` | the taskIds from the refusal message | S20 | **RED** (2 of 2) |
| `M-ALWAYSUNION` | `planReconciliation`'s condition (escalate always) | S4 | **RED** |

### 3.1 🔴 `M-SLUG` passed, and that made an assertion decoration

The path-escape criterion originally used `taskId = "../../escape"`. `M-SLUG` (below) **passed**:

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -295,7 +295,7 @@ function intentOf(contract: unknown): SideIntent | null {
  * place §2.3 exists to keep contracts out of.
  */
 function slug(taskId: string): string {
-  return taskId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
+  return taskId;
 }
```
```
M-SLUG EXIT=0
 ✓ tests/scheduler/reconcile.test.ts (4 tests) 2511ms
```

**Why:** the filename is `contract-reconcile-<a>-<b>.json`, so `path.join`'s first `..` only pops
the literal segment `contract-reconcile-..` back off. Two levels land inside `runsDir` with or
without the sanitiser. **Three levels leave it.** Fixed in `a5c9d93` (`"../../../escape"`), and
re-run against a fresh clone at `a5c9d93`:

```
M-SLUG EXIT=1
   × ... keeps the contract inside runsDir even when a taskId is shaped like a path escape
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/reconcile.test.ts:111:59
    111|       expect("path" in r && r.path.startsWith(s.runsDir)).toBe(true);
```

This is the exact failure shape the project keeps being bitten by, and it was found only by
actually running the mutation rather than reasoning about it.

### 3.2 `M-RECON` 🔴

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -334,17 +334,9 @@ export async function synthesizeReconcileContract(
   conflict: MaterialisedConflict,
 ): Promise<{ path: string } | { escalate: string }> {
   const intents = [a, b].map((task) => ({ task, intent: intentOf(contracts.get(task.taskId)) }));
-  const oneSided = intents.filter((s) => s.intent === null).map((s) => s.task.taskId);
-  if (oneSided.length > 0) {
-    return {
-      escalate:
-        `cannot synthesize a reconciliation contract for ${a.taskId} x ${b.taskId}: ` +
-        `${oneSided.join(", ")} contributed no goal, successCondition or execution budget, so the contract ` +
-        `would carry only the other side's intent and the reconciler would be the conflicting party ` +
-        `(spec §5.2)`,
-    };
-  }
-  const [sideA, sideB] = intents.map((s) => s.intent!);
+  const [sideA, sideB] = intents.map(
+    (s) => s.intent ?? { goal: "", successCondition: "", perAttemptTimeoutMs: 1, totalRuntimeBudgetMs: 1, tokenBudget: 1 },
+  );
 
   const plan = planReconciliation(contracts.get(a.taskId), contracts.get(b.taskId));
   if (plan.escalate) return { escalate: plan.why };
```
```
M-RECON EXIT=1
 ❯ tests/scheduler/scenarios/S20.test.ts (2 tests | 2 failed) 155ms
   × S20: a reconciliation contract that names only one side's taskId is refused, and the run escalates
     → expected false to be true // Object.is equality
   × S20: a side that declares no execution budget is refused for the same reason
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/scenarios/S20.test.ts:41:31
      41|       expect("escalate" in r).toBe(true);
```
Without the check, the conflicting task is dispatched to reconcile its own conflict with a contract
carrying only its own goal — which is what S20 exists to measure.

### 3.3 `M-EMPTYCHK` 🔴

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -232,14 +232,6 @@ export type ReconciliationPlan =
  */
 export function planReconciliation(a: unknown, b: unknown): ReconciliationPlan {
   const requiredChecks = requiredChecksUnion(a, b);
-  if (requiredChecks.length === 0) {
-    return {
-      escalate: true,
-      why:
-        "neither side declares any verification.requiredChecks, so their union is empty and any " +
-        "reconciliation would pass by having nothing to check (spec §5.3)",
-    };
-  }
   return { escalate: false, requiredChecks };
 }
```
```
M-EMPTYCHK EXIT=1
 ❯ tests/scheduler/scenarios/S4.test.ts (1 test | 1 failed) 80ms
   × S4: an empty requiredChecks union refuses automatic reconciliation and escalates
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/scenarios/S4.test.ts:25:63
      25|       expect(planReconciliation(noChecks, noChecks).escalate).toBe(true);
```
The reconciliation "succeeds" by having nothing to check. **The S4 fixture is a contract that is
deliberately invalid by ccloop's rules** (`requiredChecks: []` against
`z.array(z.string()).min(1)`, `ccloop/src/contract/schema.ts:65`), and the criterion says so in a
🔴-marked comment so a later reader does not conclude the branch is dead code.

### 3.4 `M-NOCOMMIT` — the strongest red in the set

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -193,8 +193,6 @@ export async function materialiseConflict(
     );
   }
 
-  await git(copy, ["add", "-A"]);
-  await git(copy, [...ORCA_IDENTITY, "commit", "-m", CONFLICT_COMMIT_MESSAGE]);
   const conflictCommit = (await git(copy, ["rev-parse", "HEAD"])).trim();
```
```
M-NOCOMMIT EXIT=1
   × materialises the conflict as a commit, because a fresh worktree cannot show it
     → expected 'one\ntwo-target\nthree\nfour\nfive\ns…' to contain '<<<<<<<'
   × enumerates one block per conflicting region, with each side's lines kept apart
     → expected [] to deeply equal [ 'src/a.ts', 'src/a.ts' ]

- Expected
+ Received
- <<<<<<<
+ one
+ two-target
...
+ nine-target
+ ten
```
The received text is W's tip verbatim: exactly what an agent spawned the ordinary way would see,
which is the failure the whole of §5.2 exists to prevent.

### 3.5 `M-FETCH`

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -134,8 +134,6 @@ export async function materialiseConflict(
   wTip: string,
   incomingRef: string,
 ): Promise<MaterialisedConflict> {
-  await git(copy, ["fetch", "--no-tags", "origin", `+${incomingRef}:${incomingRef}`, wTip]);
-
   // Checked rather than assumed: `git fetch <sha>` is refused by servers that
```
```
M-FETCH EXIT=1
 ❯ tests/scheduler/reconcile.test.ts (4 tests | 4 failed) 1682ms
   → orca: the work branch tip 5171a12f… is not in /var/folders/…/runs/r1/repo after fetching it
     from origin, so the conflict cannot be re-created there (spec §5.2 step 1)
 ❯ Module.materialiseConflict src/scheduler/reconcile.ts:145:11
```
Also the proof that the `cat-file -e` guard earns its place: the failure names *which* of the two
parents is missing instead of surfacing as `checkout: unknown revision`.

### 3.6 `M-BLOCK1` / `M-SWAP`

```diff
@@ -101,6 +101,7 @@ function parseConflictBlocks(path: string, content: string): ConflictBlock[] {
       start = -1;
       split = -1;
+      break;
     }
```
```
M-BLOCK1 EXIT=1
   × enumerates one block per conflicting region, with each side's lines kept apart
     → expected [ 'src/a.ts' ] to deeply equal [ 'src/a.ts', 'src/a.ts' ]
```

```diff
@@ -96,8 +96,8 @@ function parseConflictBlocks(path: string, content: string): ConflictBlock[] {
-        ours: lines.slice(start + 1, split),
-        theirs: lines.slice(split + 1, index),
+        ours: lines.slice(split + 1, index),
+        theirs: lines.slice(start + 1, split),
```
```
M-SWAP EXIT=1
   × enumerates one block per conflicting region, with each side's lines kept apart
     → expected [ [ 'two-copy' ], [ 'nine-copy' ] ] to deeply equal [ [ 'two-target' ], [ 'nine-target' ] ]
```

### 3.7 `M-REPOPATH` / `M-HALFUNION` / `M-ONESIDEDGOAL`

```diff
@@ -376,7 +376,7 @@ export async function synthesizeReconcileContract(
-      repoPath: conflict.copyPath,
+      repoPath: runsDir,
```
```
M-REPOPATH EXIT=1
   × writes the synthesized contract into runsDir, outside the target repo
     → expected '/var/folders/…' to be '/var/folders/…' // Object.is equality
 ❯ tests/scheduler/reconcile.test.ts:77:40   expect(written.context.repoPath).toBe(f.copyPath);
```

```diff
@@ -404,7 +404,7 @@ export async function synthesizeReconcileContract(
-      requiredChecks: plan.requiredChecks,
+      requiredChecks: requiredChecksUnion(contracts.get(a.taskId), null),
```
```
M-HALFUNION EXIT=1
     → expected [ 'true' ] to deeply equal [ 'false', 'true' ]
 ❯ tests/scheduler/reconcile.test.ts:79:58
```

```diff
@@ -355,8 +355,7 @@ export async function synthesizeReconcileContract(
     `${a.taskId} counts as done when: ${sideA.successCondition}\n\n` +
-    `${b.taskId} was trying to: ${sideB.goal}\n` +
-    `${b.taskId} counts as done when: ${sideB.successCondition}\n\n` +
+
     `Both intents must survive. Where a block cannot satisfy both, it is a semantic conflict and belongs ` +
```
```
M-ONESIDEDGOAL EXIT=1
     → expected 'Reconcile the merge conflict between …' to contain 'inline the helper'
 ❯ tests/scheduler/reconcile.test.ts:81:38
```

### 3.8 `M-ALWAYSESC` / `M-CONSTMSG` / `M-ALWAYSUNION` — the negative halves

These three exist because "refuse everything" would satisfy the positive assertions of S20 and S4
while destroying the feature.

```diff
@@ -334,7 +334,7 @@ export async function synthesizeReconcileContract(
-  const oneSided = intents.filter((s) => s.intent === null).map((s) => s.task.taskId);
+  const oneSided = intents.map((s) => s.task.taskId);
```
```
M-ALWAYSESC EXIT=1
     → expected true to be false   ❯ S20.test.ts:50:32  expect("escalate" in ok).toBe(false);
```

```diff
@@ -338,8 +338,8 @@ export async function synthesizeReconcileContract(
       escalate:
-        `cannot synthesize a reconciliation contract for ${a.taskId} x ${b.taskId}: ` +
-        `${oneSided.join(", ")} contributed no goal, successCondition or execution budget, so the contract ` +
+        `cannot synthesize a reconciliation contract: ` +
+        `one side contributed no goal, successCondition or execution budget, so the contract ` +
         `would carry only the other side's intent and the reconciler would be the conflicting party ` +
```
```
M-CONSTMSG EXIT=1  (2 of 2 S20 criteria)
     → expected 'cannot synthesize a reconciliation co…' to contain 'T2'
```

```diff
@@ -232,7 +232,7 @@ export type ReconciliationPlan =
 export function planReconciliation(a: unknown, b: unknown): ReconciliationPlan {
   const requiredChecks = requiredChecksUnion(a, b);
-  if (requiredChecks.length === 0) {
+  if (true) {
```
```
M-ALWAYSUNION EXIT=1
     → expected true to be false
 ❯ S4.test.ts:30:65  expect(planReconciliation(noChecks, withChecks).escalate).toBe(false);
```

---

## 4. Restoration proof

Baseline taken at `9e5ff19` before the first clone, re-taken after the sandbox was deleted:

```
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > before.txt      # 99 files
$ ...mutations in $SC/mut (a git clone --local copy), node_modules symlinked...
$ /bin/rm -f  $SC/mut/node_modules      # symlink removed first, per G8
$ /bin/rm -rf $SC/mut
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > after.txt
$ diff before.txt after.txt
71c71
< 4745ce83808ccf379814dac2f7d21f0cf6fbe7a96a39dbdc47a715091a06c873  tests/scheduler/reconcile.test.ts
---
> 1b4af9776c267118dbcf9c689011687371511154c5d4323601b76f471fa107bd  tests/scheduler/reconcile.test.ts
```

**The single delta is the intended `a5c9d93`** (the `M-SLUG` criterion fix, §3.1), committed between
the two manifests — not mutation residue. The worktree itself is provably clean at that commit:

```
$ /usr/bin/git status --short          # (no output)
$ /usr/bin/git diff | wc -c            0
$ /usr/bin/git diff --cached | wc -c   0
```

`M-SLUG`'s re-run and the last three mutations were executed in a **second** clone taken at
`a5c9d93`, which was deleted the same way.

## 5. ccloop untouched

```
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short   # (no output), exit 0
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse --short HEAD
7f2c5f6
```
The only ccloop file read this round was `src/contract/schema.ts` (read-only, to build a contract
its `.strict()` schema accepts).

## 6. Measured durations

| Thing | Value | Command |
|---|---|---|
| `npm run verify` (committed state) | **exit 0**, 15 s wall | `npm run verify > f 2>&1; echo $?` with `date +%s` either side |
| `npm test` inside it | 39 files / 227 tests, 6.10 s | vitest's own Duration line |
| `verify:scheduler` inside it | 32 files / 108 tests, 5.90 s | vitest's own Duration line |
| the 4 new `reconcile.test.ts` criteria | 2.5–2.6 s (≈0.62 s each; each builds a git sandbox) | vitest per-test timings |
| S4 / S20 | 106 ms / 190 ms | vitest per-test timings |

Money spent: **not reported** — no tool in this session gave a per-task figure. (The session-total
hook line is a session number, not this task's.)

## 7. Self-review

Read the whole diff cold. Findings:

1. 🔴 **One decorative assertion found and fixed** — §3.1. It is worth stating plainly that it was
   found by *running* the mutation; reading the code did not reveal it.
2. **Assertions that read back what the test just wrote: none.** Every assertion in all seven
   criteria sits after the call under test. The closest thing is
   `expect(written.context.targetPaths).toEqual([f.path])`, and `f.path` comes from the sandbox
   fixture while `written` comes off disk through the production path — checked, it is not a
   round-trip of a value this test set.
3. **Assertions whose red is masked by an earlier one in the same criterion** (CLAUDE.md Rule 9's
   warning). Named honestly rather than left to be discovered:
   - `expect(c.conflictedPaths).toEqual([f.path])` (criterion 1) — the marker assertion above it
     fires first under every mutation tried. The mutation that would isolate it is "return the
     unsorted / empty path list", not run.
   - `expect(c.blocks[0].startLine).toBeLessThan(c.blocks[1].startLine)` — `M-BLOCK1` kills the
     array length two lines earlier. A "startLine off by the block's own height" mutation would
     isolate it; not run.
   - `expect(written.objective.goal).toContain("rename the helper")` — `M-ONESIDEDGOAL` removed
     side **B**; side A's half is not independently reddened.
   - `expect(path).not.toContain("..")` — `M-SLUG` reddens the `startsWith` line before it.
   None of these is decoration (each measures something the production code decides); they are
   simply not *individually* proven. **Suggested for Task 15's re-run list.**
4. **Third copy of the four-line `git()` wrapper** (`land.ts:18`, `run.ts:23`, now
   `reconcile.ts:22`). Task 10's review already recorded the duplication as a deferred minor;
   consolidating it means editing two files this task has no other reason to touch (Rule 3). Flagged
   with a comment at the definition, not silently repeated.
5. **`parseConflictBlocks` is a hand-written marker parser.** Its known limits, stated: a data line
   that itself starts with `=======` inside the "ours" half would be read as the split, and a
   second `<<<<<<<` before the matching `>>>>>>>` restarts the block. The diff3 / zdiff3 `|||||||`
   variant is not parsed — it is *prevented*, by pinning `merge.conflictStyle=merge` on the merge
   invocation, because the copy inherits the developer's global config like any repository. The
   pinning is a constant with a `why` comment; it is not covered by a mutation.
6. **`materialiseConflict` fails loud in three places**: W's tip missing after the fetch, the merge
   succeeding where the target repo said it conflicted, and a merge failure with no unmerged paths
   (a non-content failure — "cannot merge", an untracked-file refusal). Only the first is reddened,
   by `M-FETCH`. The other two are Rule 12 guards on states the fixture cannot produce.

## 8. Concerns

1. 🔴 **§5.4's escalation file has no owner.** Spec §5.4 requires
   `<runsDir>/escalations/<run-id>.md` carrying both intents, the conflict blocks and an executable
   `undo.how`. Task 11's brief does not mention it; neither does Task 12's. The plan's coverage
   table says "§5.0–§5.4 | Task 11 ＋ Task 12", so it is currently assigned to nobody's criteria.
   `synthesizeReconcileContract`'s `escalate` string and `MaterialisedConflict.blocks` are exactly
   the material it needs, so the seam is there — but **it will be silently dropped unless a ruling
   places it.**
2. **The fifth parameter is a real interface change** (deviation 4 above). If the controller prefers
   the brief's four-argument shape, the cost is that the synthesized contract cannot name the
   repository it runs in, and Task 12 would have to rewrite `repoPath` the way `runTask` does — at
   which point the file written to `runsDir` is a document nobody should read. I judged that worse.
   Reversible either way; Task 12 is the only consumer.
3. **`git fetch origin <sha>` was verified to work on this machine's local clones** (measured, not
   assumed: the experiment is in §3.5's mutation, where deleting the fetch is what fails). It is
   guarded by an explicit `cat-file -e` check so a git build or transport that refuses it fails with
   a named diagnosis rather than an opaque checkout error. If reconciliation ever runs against a
   non-local remote, that guard is where it will surface.
4. **The conflict commit is a two-parent merge commit** (parents `[wTip, incomingRef]`, tree
   conflicted) because that is what `git commit` after a conflicted merge produces, and it is the
   honest object: it *is* the merge, unresolved. Task 12's rebuild differs from it in the **tree**,
   not in the parents. Task 12's "the conflicted commit never reaches W" criterion is therefore
   load-bearing in a stronger sense than it may look — this object would fast-forward-merge
   plausibly if anything ever pointed W at it. Flagging it explicitly for Task 12.
5. **Nothing calls `reconcile.ts` yet.** Until Task 12 wires it into `run.ts`, the whole module is
   reachable only from tests. That is the plan's own split, but it means the module has no
   production path and `M-*` mutations here are unit-level by construction; S3 is where the trunk
   is measured end to end.
