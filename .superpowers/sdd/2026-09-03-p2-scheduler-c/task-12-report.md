# Task 12 report — conflict trunk (2): `commit-tree` rebuild + the `bound` ordering

Run: session `c2fd0c3b-0aaf-4a1b-960e-2d6cab3f7ad3`, 2026-09-04. BASE `a5c9d93`.
Commits created: `b0ac6c0`, `36f2610` (both on `main`, not pushed, no branch or worktree created).

---

## 1. What was implemented

The conflict trunk is closed: a merge that conflicts no longer escalates. `run.ts`'s
`landIntoW` conflict branch now runs spec §5.2's five steps end to end and lands an ordinary
merge commit on W.

| File | Change |
|---|---|
| `src/scheduler/gitExec.ts` (new, 26 lines) | the shared four-line `git()` wrapper — see §7 finding 4 |
| `src/scheduler/reconcile.ts` (+95) | `rebuildMergeCommit` (§5.2 step 4, transcribed), `conflictRefOf` / `pinConflictCommit` (step 5), `markersRemaining` (§5.1's third row), `writeTree` |
| `src/scheduler/ledgerWiring.ts` (new, 100 lines) | `writeBoundThenCommit` (§8.3, transcribed), `reconcileDecision` (§8.1's `reconcile` row) |
| `src/scheduler/run.ts` (+300) | `reconcileAndLand`, `otherSideOf`, `reconciledRefOf`, and the wiring at the conflict branch |
| `src/scheduler/harvest.ts` (+8/−4) | `netChangeSet` exported (one new caller, see §7 finding 5) |
| `tests/scheduler/sandbox.ts` (+153) | `seedLyingPlan`, `ledgerFilesOnBranch`, `blameCommitOfLine`, `conflictRefShas`, `reachableCommits`, `commitParents`; `readLedgerOnBranch` rewritten on top of `ledgerFilesOnBranch` |
| `tests/scheduler/reconcile.test.ts` (+65) | the parents/tree criterion, the `markersRemaining` criterion |
| `tests/scheduler/scenarios/S3.test.ts` (new, 157 lines) | S3 and its three siblings |

**Both given code blocks were transcribed verbatim, comments included.** `rebuildMergeCommit`
(`src/scheduler/reconcile.ts:439-448`, measured at `36f2610`) and `writeBoundThenCommit`
(`src/scheduler/ledgerWiring.ts:15-24`, measured at `36f2610`) differ from the brief only in that `git` is imported
rather than re-declared.

Net tests: **227 → 233** (+5 in `b0ac6c0`, +1 in `36f2610`).

### The reconciliation flow, as wired

1. `otherSideOf` — identify the other party by what an already-landed task in this layer
   actually **wrote** (`netChangeSet` against the layer base), never by what it declared: this
   code path only exists because the declarations were wrong. Anything but exactly one match
   escalates rather than guessing.
2. `materialiseConflict(copy, wTip, incomingRef)` (Task 11) + `pinConflictCommit` — the
   conflicted commit gets `refs/orca/conflict/<run-id>` **inside the copy**.
3. `synthesizeReconcileContract` (Task 11) — the two refusals (S20, S4) run here and escalate.
4. `runTask({...plan, targetRepo: copy}, …, base = conflictCommit)` — an ordinary ccloop task
   in an ordinary clone **of the copy**, whose object store is the only one holding the
   conflict commit.
5. Fetch the reconciled attempt back into the copy; `markersRemaining` on that commit's tree.
6. `appendEvent(copy/.decisions, roundId, reconcileDecision)`, then
   `writeBoundThenCommit(copy, [id], …, build)` where `build` is
   `rebuildMergeCommit(copy, wTip, incomingRef, await writeTree(copy), …)`.
7. `git fetch <copy> <mergeSha>:refs/orca/reconciled/<run-id>` into the target repo, then
   `git merge --ff-only`.

### Three deliberate deviations, each argued

**(a) 🔴 S3 exits 2, not 0.** The plan's criterion says `expect(rc).toBe(0)`. That is not
reachable, and the reason is structural rather than a defect in this implementation:

- Two tasks land in ONE layer only if `pathTrie` calls their declared write sets disjoint —
  `buildGraph` puts an implicit edge between any intersecting pair, which splits them across
  layers, and a later layer's task clones from a W that already contains the earlier one's
  work, so its merge is a fast-forward and cannot conflict.
- For their merges to conflict, both must write the SAME path.
- A path inside both declared sets makes those sets intersect: both claims are then prefixes
  of that path's segments, so one contains the other and `pathTrie.classify` returns non-null.

So **a conflict that reaches §5's trunk at all necessarily carries at least one out-of-bounds
write**, and §7.3's second tier prices "out of bounds, no sibling claims it, land it anyway"
at exit 2 — pinned by S6 and mutation `M-A2`. §6.3 takes the max, so the round exits 2.
S3's own criterion states this in a 🔴 comment and asserts what "exit 0" stood for directly:
the round did **not** escalate, both tasks are on W, the reconciled file carries no markers,
and every ledger line validates. **Registered as an erratum against the spec's §10.2 table**
(S3's "exit 0" contradicts §7.3's second tier); a ruling is needed on which to change.

**(b) The `reconcile` decision lands inside the merge commit, not in a separate commit on W**
(§8.0's second row says C's own decisions get their own commit). This is forced, not chosen:
the merge commit's tree comes from the copy, so a decision committed onto W between the W tip
being captured and the rebuild would **not** be in that tree, and fast-forwarding W onto the
rebuilt commit would silently DELETE the line again — an append-only violation nothing would
report. It also has to precede the `bound` line in the same file for `appendEvent`'s check 5.
§8.0's stated reason for wanting a separate commit is attribution ("blame should say C, not
whoever's task landed next"), and that survives: the rebuilt merge commit is authored by
`orca` and is C's own commit. Argued in a comment at `reconcileDecision`.

**(c) One `reconcile` decision per conflict, not one per block** (§5.5 says "每块判断进台账").
§5.5's per-block judgements are the MODEL's — classify this block textual or semantic — and
v1's reconciliation runs on ccloop's `scripted` adapter, which classifies nothing. Emitting N
identical per-block decisions would be C claiming, in an append-only file that can never be
corrected, that a classification happened. The choice C actually makes is recorded: reconcile
automatically rather than stop at this merge point (§5.4). The blocks are named inside the
decision. A reconciling agent's own per-block decisions belong in its copy's
`.decisions/<its-run-id>.jsonl` (§8.0's first row) — a different file and a different author.

---

## 2. TDD evidence

### RED — criteria before implementation

```
$ npx vitest run tests/scheduler/reconcile.test.ts tests/scheduler/scenarios/S3.test.ts \
    > /tmp/red1.txt 2>&1; echo "EXIT=$?" >> /tmp/red1.txt
EXIT=1
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 4 failed) 1089ms
   × S3: tasks that declared disjoint write sets but actually collided are reconciled and land
     → expected 3 to be 2 // Object.is equality
   × lands an ordinary merge commit whose two parents are the W tip and the incoming ref
     → expected [] to have a length of 1 but got +0
   × the conflicted commit never reaches W
     → expected 0 to be greater than 0
   × the bound line is blamed to the merge commit itself, not to the commit after it
     → expected [] to have a length of 1 but got +0
 ❯ tests/scheduler/reconcile.test.ts (5 tests | 1 failed) 3260ms
   × rebuilds a merge commit whose two parents are exactly the W tip and the incoming ref
     → rebuildMergeCommit is not a function
 Test Files  2 failed (2)
      Tests  5 failed | 4 passed (9)
```

Why each red is the expected one, at BASE `a5c9d93`:

- **exit 3 instead of 2** — the pre-existing conflict branch escalated (`run.ts:404-419`).
  The round log in the same file shows the whole chain: `T1: landed despite writing outside
  its declared write set (spec §7.3): shared.txt` → `T2: merge into orca/w/x conflicted on
  shared.txt`. The fixture really does produce the collision it claims to.
- **no two-parent commit whose second parent is `refs/orca/<T2 run-id>`** — nothing rebuilt one.
- **`Object.keys(conflictRefs).length` is 0** — no conflict ref was pinned in any copy.
- **no `bound` line on W** — nothing wrote one.
- **`rebuildMergeCommit is not a function`** — the weakest form of red, which is why every one
  of these assertions is also aimed at by a named mutation in §4.

### GREEN

```
$ npx vitest run tests/scheduler/scenarios/S3.test.ts > /tmp/g1.txt 2>&1; echo "EXIT=$?"
EXIT=0
 ✓ tests/scheduler/scenarios/S3.test.ts (4 tests) 2121ms
```

The round's own log, which is the readable form of the trunk working:

```
orca: T2: merge into orca/w/x conflicted on shared.txt (W tip 3b803142…, incoming refs/orca/orca-T2-7e1c6f14)
orca: T2: recorded the conflict as e50e0ece… on refs/orca/conflict/orca-T2-7e1c6f14 in …/runs/orca-T2-7e1c6f14/repo (1 block(s) in shared.txt)
orca: T2: reconciliation orca-reconcile-T2-456bd772 reported succeeded
orca: T2: reconciled with T1 and landed b26484c5… on orca/w/x (the conflicted commit stays at refs/orca/conflict/orca-T2-7e1c6f14 in …/runs/orca-T2-7e1c6f14/repo)
```

### Full gate, on the committed state (`36f2610`)

```
$ npm run verify > /tmp/verify_final.txt 2>&1; echo "EXIT=$?"
EXIT=0   WALL=17 s
 npm test          : Test Files  40 passed (40)   Tests  233 passed (233)   Duration 7.16s
 verify:scheduler  : Test Files  33 passed (33)   Tests  114 passed (114)   Duration 7.20s
```

Every earlier task's criteria still pass: 233 = the 227 recorded at `a5c9d93` plus this task's 6.

### English-only scan

```
$ python3 … scan src/scheduler/{gitExec,ledgerWiring,reconcile,run,harvest}.ts \
    tests/scheduler/{sandbox,reconcile.test}.ts tests/scheduler/scenarios/S3.test.ts
```

Distinct non-ASCII: `—` `§` `⚠️` `🔴` `→` `′` `⇒` `⊄` — the same glyphs the existing
`src/scheduler/**` uses. The scan found **30 CJK characters**, all in `run.ts` lines 158 and
461, which are pre-existing spec quotations this task did not touch. A CJK-scan of every line
this task ADDED (`git diff` filtered to `+` lines) returns **0**. One CJK phrase I had
introduced in `reconcile.ts` (a `"临时 ref"` spec quote) was found by this scan and removed
before the commit. No `.decisions/*.jsonl` file in this repository was touched.

---

## 3. 🔴 Proof that `M-OPT`'s shortcut is on the execution path

Before running `M-OPT` I put a temporary `throw` in the branch the shortcut would take, in the
clone, and ran S3. The literal probe patch:

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -15,6 +15,7 @@ import { reconcileDecision, writeBoundThenCommit } from "./ledgerWiring.js";
 import { emptyRequiredChecksPairs, renderPlanReport } from "./planReport.js";
+import { intersect } from "./pathTrie.js";
 import { preflight } from "./preflight.js";
@@ -641,6 +642,14 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
         const result = await landIntoW(plan, run);
+        // M-OPT reachability probe (temporary): is the shortcut branch on the
+        // execution path at all?
+        const mayCollide = [...sameLayerWriteSets(graph, taskId).values()].some(
+          (sibling) => intersect(graph.writeSets.get(taskId) ?? [], sibling).length > 0,
+        );
+        if (!result.merged && !mayCollide) {
+          throw new Error("M-OPT PROBE: the shortcut branch is reached");
+        }
         if (!result.merged) {
```

Real output (`/tmp/probe.out`):

```
orca: T2: landed despite writing outside its declared write set (spec §7.3): shared.txt
orca: the round failed: Error: M-OPT PROBE: the shortcut branch is reached
    at Module.runRound (…/mut/src/scheduler/run.ts:651:17)
    at …/mut/tests/scheduler/scenarios/S3.test.ts:34:8
 Test Files  1 failed (1)
      Tests  4 failed (4)
EXIT=1
```

The throw fires, from inside `runRound`, on S3's round. The shortcut branch is reached with
`result.merged === false` and `mayCollide === false` — i.e. it is exactly the state the
shortcut would short-circuit, not dead code. `M-OPT` below therefore measures a live path.

---

## 4. Mutations

All run inside `git clone --local /Users/biran/code/skills/loop/Orca <copy>` with the main
tree's `node_modules` symlinked in and `ORCA_CCLOOP_BIN` pointed at the real ccloop build
(the sibling-directory default does not resolve from a clone). Patches are the literal
`git diff` from the copy. `M-OPT` / `M-TREE` / `M-BOUND` / `M-REUSE` ran in a clone at
`b0ac6c0`; `M-MARKERS-*` in a second clone at `36f2610`.

| Mutation | Deletes / adds | Fed | Result |
|---|---|---|---|
| **`M-OPT`** 🔴 | adds "the write sets did not intersect, so skip the merge-conflict handling" | **S3** | **RED** (4 of 4) |
| **`M-TREE`** 🔴 | §5.2 step 4's parent order (deliberately wrong parents, right tree) | **S3** + unit | **RED** (2 of 4 S3, 1 of 5 unit) |
| **`M-BOUND`** 🔴 | §8.3's ordering (build first, record the `bound` on W afterwards) | **S3** | **RED** (1 of 4 — only the blame criterion) |
| `M-REUSE` | rebuilding at all (land the conflicted commit, whose parents are already right) | **S3** | **RED** (3 of 4) |
| `M-MARKERS-FN` | `markersRemaining`'s body (always `[]`) | reconcile.test | **RED** |
| `M-MARKERS-INV` | `markersRemaining`'s body (always `paths`) | **S3** | **RED** (3 of 4) |
| `M-MARKERS-CALL` | only the escalation the check drives (`if (false)`) | **S3** | 🔴 **PASSED — see §4.6** |

### 4.1 `M-OPT` 🔴 — the one the spec says will be "helpfully" optimised away

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -15,6 +15,7 @@ import { reconcileDecision, writeBoundThenCommit } from "./ledgerWiring.js";
 import { emptyRequiredChecksPairs, renderPlanReport } from "./planReport.js";
+import { intersect } from "./pathTrie.js";
 import { preflight } from "./preflight.js";
@@ -641,7 +642,13 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
         const result = await landIntoW(plan, run);
-        if (!result.merged) {
+        // M-OPT: the write-set criterion already said these two do not
+        // intersect, so this cannot really be a conflict -- skip the
+        // merge-conflict handling.
+        const mayCollide = [...sameLayerWriteSets(graph, taskId).values()].some(
+          (sibling) => intersect(graph.writeSets.get(taskId) ?? [], sibling).length > 0,
+        );
+        if (!result.merged && mayCollide) {
           log(
```
```
M-OPT EXIT=1
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 4 failed) 1105ms
   × S3: tasks that declared disjoint write sets but actually collided are reconciled and land
     → expected null to be 'b1\n' // Object.is equality
   × lands an ordinary merge commit whose two parents are the W tip and the incoming ref
     → expected [] to have a length of 1 but got +0
   × the conflicted commit never reaches W          → expected 0 to be greater than 0
   × the bound line is blamed to the merge commit … → expected [] to have a length of 1 but got +0
```

🔴 **The failure is `b.txt` missing from W** — `git merge --abort` has already run, so the
shortcut drops T2's entire result while the round reports the same exit code (2) and prints
nothing about it. That is §3.4 rule 3's whole point: the criterion is an optimisation, and
taking it as a premise turns "we were slower than necessary" into "we silently lost work".

### 4.2 `M-TREE` 🔴

```diff
diff --git a/src/scheduler/reconcile.ts b/src/scheduler/reconcile.ts
@@ -442,7 +442,7 @@ export async function rebuildMergeCommit(
   const incoming = (await git(copy, ["rev-parse", incomingRef])).trim();
   const sha = await git(copy, [
     "-c", "user.name=orca", "-c", "user.email=orca@invalid",
-    "commit-tree", reconciledTree, "-p", wTip, "-p", incoming, "-m", message,
+    "commit-tree", reconciledTree, "-p", incoming, "-p", wTip, "-m", message,
   ]);
```
```
M-TREE EXIT=1
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 2 failed)
   × lands an ordinary merge commit whose two parents are the W tip and the incoming ref
     → expected [] to have a length of 1 but got +0
   × the bound line is blamed to the merge commit itself, not to the commit after it
     → expected [] to have a length of 1 but got +0
 ❯ tests/scheduler/reconcile.test.ts (5 tests | 1 failed)
   × rebuilds a merge commit whose two parents are exactly the W tip and the incoming ref
     → expected [ …(2) ] to deeply equal [ …(2) ]
       Array [
       -   "118e9edf510043ae19f86ed429085b88a2ec225e",
           "da311a46f759435017bee67aa09f09be4fce5f9e",
       +   "118e9edf510043ae19f86ed429085b88a2ec225e",
       ]
```

**The S3 content criterion stayed GREEN.** The tree is right, both files land, the ledger
validates, the round exits 2 — and W's history has stopped saying that this task's work was
ever a branch of its own, and `git log --first-parent` now walks into the incoming attempt.
That is exactly why the criterion measures parents as an ordered list rather than a set.

### 4.3 `M-BOUND` 🔴 — the failure that stays green

First attempt at this mutation moved the `git add -A .decisions` out with the `bound` line,
which made the reconcile *decision* miss the tree too and crashed on `appendEvent`'s check 5
(`bound references unknown decision id`). That is a red, but not §8.3's red. Refined so that
only the `bound` line moves after the build — the ordering §8.3 actually warns about:

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -400,23 +400,16 @@ async function reconcileAndLand(
   await appendEvent(join(copy, ".decisions"), ctx.roundId, decision);
 
-  const mergeSha = await writeBoundThenCommit(
+  // M-BOUND: merge first, then record. (The decision itself is still staged
+  // here; only the `bound` line moves after the build, which is exactly the
+  // ordering §8.3 warns an implementer will write.)
+  await git(copy, ["add", "-A", ".decisions"]);
+  const mergeSha = await rebuildMergeCommit(
     copy,
-    [decision.id],
-    reconcileTask.taskId,
-    ctx.roundId,
-    // §5.2 step 4. The tree is written HERE, inside the callback, because
-    // writeBoundThenCommit has just staged the bound line: a tree computed
-    // before that call would be the reconciled tree without it, and the blame
-    // answer would then name whatever commit recorded it next.
-    async () =>
-      rebuildMergeCommit(
-        copy,
-        state.wTip,
-        state.incomingRef,
-        await writeTree(copy),
-        `orca: land ${run.runId} (reconciled with ${other.taskId})`,
-      ),
+    state.wTip,
+    state.incomingRef,
+    await writeTree(copy),
+    `orca: land ${run.runId} (reconciled with ${other.taskId})`,
   );
 
   await git(plan.targetRepo, ["fetch", copy, `${mergeSha}:${reconciledRefOf(run.runId)}`]);
@@ -425,6 +418,15 @@ async function reconcileAndLand(
   await git(plan.targetRepo, ["merge", "--ff-only", reconciledRefOf(run.runId)]);
 
+  // M-BOUND (second half): the bound line is recorded onto W after the merge.
+  await appendEvent(join(plan.targetRepo, ".decisions"), ctx.roundId, {
+    ev: "bound",
+    id: decision.id,
+    taskId: reconcileTask.taskId,
+    runId: ctx.roundId,
+  });
+  await commitLedgerOnW(plan, `orca: bind ${decision.id} to the reconciliation of ${taskId}`);
+
   await disposeWorkdir(reconcileRun, { keepWorkdirs: ctx.keepWorkdirs, log: ctx.log });
```
```
M-BOUND EXIT=1
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 1 failed) 2172ms
   × the bound line is blamed to the merge commit itself, not to the commit after it
     → expected '39a2f13c76ee087ab32e416f4791d2059d5fd…' to be 'e2261539541c2bb1e3cfd13c1e5ada81da576…'
       Expected: "e2261539541c2bb1e3cfd13c1e5ada81da576459"
       Received: "39a2f13c76ee087ab32e416f4791d2059d5fd965"
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

🔴 **Three of four criteria stay green.** The round exits 2, both tasks land, every ledger
line validates, the merge commit's parents are right — and `git blame` on the `bound` line
answers with the following commit. This is §8.3's "一切照绿" reproduced exactly, and the only
thing that catches it is a criterion that measures the blame answer rather than the call order.

### 4.4 `M-REUSE` — the conflicted commit really would look legitimate

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -409,14 +409,12 @@ async function reconcileAndLand(
-    async () =>
-      rebuildMergeCommit(
-        copy,
-        state.wTip,
-        state.incomingRef,
-        await writeTree(copy),
-        `orca: land ${run.runId} (reconciled with ${other.taskId})`,
-      ),
+    // M-REUSE: the conflicted commit already has the right parents, so reuse
+    // it instead of rebuilding a merge commit from the reconciled tree.
+    async () => {
+      await writeTree(copy);
+      return conflict.conflictCommit;
+    },
```
```
M-REUSE EXIT=1
   × S3: … reconciled and land
     → expected '<<<<<<< HEAD\nt1\n=======\nt2\n>>>>>>…' not to contain '<<<<<<<'
       + <<<<<<< HEAD
       + t1
       + =======
       + t2
       + >>>>>>> refs/orca/orca-T2-14cf9b63
   × the conflicted commit never reaches W → expected true to be false
   × the bound line is blamed to the merge commit itself → expected [] to have a length of 1
```

Note which criterion stayed **green**: "lands an ordinary merge commit whose two parents are
the W tip and the incoming ref". The conflicted commit genuinely has those parents (Task 11's
concern 4), so a parents-only criterion would have accepted conflict markers into W's history
as a legitimate-looking merge. That is what "the conflicted commit never reaches W" is for.

### 4.5 `M-MARKERS-FN` and `M-MARKERS-INV`

```diff
@@ -463,6 +463,8 @@ export async function markersRemaining(copy: string, commit: string, paths: string[]) {
+  // M-MARKERS-FN: nothing ever has markers left.
+  return [];
   const remaining: string[] = [];
```
```
M-MARKERS-FN EXIT=1
   × names the files a reconciled commit still has conflict markers in
     → expected [] to deeply equal [ 'src/a.ts' ]
```

```diff
@@ -463,6 +463,8 @@ export async function markersRemaining(copy: string, commit: string, paths: string[]) {
+  // M-MARKERS-INV: every path still has markers.
+  return [...paths];
   const remaining: string[] = [];
```
```
M-MARKERS-INV EXIT=1
orca: T2: escalating — the reconciliation of T2 x T1 passed both tasks' required checks but
  left conflict markers in shared.txt; the conflict is at refs/orca/conflict/orca-T2-46af5f1b in …
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 3 failed)
   × S3: … reconciled and land → expected 3 to be 2
```

Together these prove the check runs on the production path and that its result is acted on.

### 4.6 🔴 `M-MARKERS-CALL` PASSED — an un-reddened branch, reported rather than hidden

```diff
@@ -368,8 +368,10 @@ async function reconcileAndLand(
+  // M-MARKERS-CALL: the check still runs, but the escalation it drives is
+  // removed -- if the result is never acted on, the call is decoration.
   const remaining = await markersRemaining(copy, reconcileRun.attemptSha, conflict.conflictedPaths);
-  if (remaining.length > 0) {
+  if (false) {
```
```
M-MARKERS-CALL EXIT=0
 ✓ tests/scheduler/scenarios/S3.test.ts (4 tests) 2136ms
```

**Deleting the escalation stays green.** No shipped fixture produces a reconciliation that
leaves markers behind: S3's synthesized contract runs the union of both tasks' required
checks, and both of those rewrite the conflicted file, so the branch is never taken. The
guard's own logic has a criterion (`M-MARKERS-FN`) and its call site is live
(`M-MARKERS-INV`), but **the "markers remain ⇒ escalate" branch itself has none.** The fixture
that would give it one is a lying plan whose two tasks' required checks do NOT rewrite the
conflicted path; it is not built. Suggested for Task 15's list.

---

## 5. Restoration proof

Baseline taken at `b0ac6c0` before the first clone; re-taken after both sandboxes were deleted.

```
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > before.txt      # 102 files
$ … M-OPT / M-TREE / M-BOUND / M-REUSE in $SC/mut (clone at b0ac6c0) …
$ /bin/rm -f  $SC/mut/node_modules ; /bin/rm -rf $SC/mut
$ … commit 36f2610 in the main tree …
$ … M-MARKERS-* in $SC/mut2 (clone at 36f2610) …
$ /bin/rm -f  $SC/mut2/node_modules ; /bin/rm -rf $SC/mut2
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > after.txt
$ diff before.txt after.txt
73c73
< ff8fee0167d7981e985a4298a94a20800bb0205b55fe1b3f0dee4124e16fb5e4  tests/scheduler/reconcile.test.ts
---
> cafcb5e056f406dbbcaf8a216ab07d302a02800b134ab1ae08beaaf3b9b532b1  tests/scheduler/reconcile.test.ts
DIFF_EXIT=1
```

The single delta is the intended commit `36f2610`, made between the two manifests — not
mutation residue:

```
$ /usr/bin/git diff --stat b0ac6c0 36f2610
 tests/scheduler/reconcile.test.ts | 33 ++++++++++++++++++++++++++++++++-
 1 file changed, 32 insertions(+), 1 deletion(-)
```

The worktree is provably clean at HEAD:

```
$ /usr/bin/git status --short       # (no output), exit 0
$ /usr/bin/git diff | wc -c         0
$ /usr/bin/git diff --cached | wc -c 0
```

Both symlinks were removed with `/bin/rm -f` before the directories were deleted; both
deletions verified by an `ls` that exits non-zero.

## 6. ccloop untouched

```
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short   # (no output)
STATUS_EXIT=0
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse --short HEAD
7f2c5f6
```

Nothing in ccloop was read or written this round beyond spawning `dist/cli.js` as a
subprocess, which is what §1.4 prescribes.

## 7. Measured durations and numbers

| Thing | Value | Command |
|---|---|---|
| `npm run verify` (committed state `36f2610`) | **exit 0**, 17 s wall | `npm run verify > f 2>&1; echo $?` with `date +%s` either side |
| `npm test` inside it | 40 files / 233 tests, 7.16 s | vitest's own Duration line |
| `verify:scheduler` inside it | 33 files / 114 tests, 7.20 s | vitest's own Duration line |
| S3's four criteria (one round, three ccloop spawns) | 4.2 s / 4.6 s across the two verify passes | vitest per-file timing |
| the two new `reconcile.test.ts` criteria | 0.62–0.92 s each (each builds a git sandbox) | vitest per-test timings |
| files changed `a5c9d93..36f2610` | 8 files, +861 / −43 | `git diff --stat` |

**Money spent: not reported.** No tool in this session gave a per-task figure; the session-total
hook line is a session number, not this task's.

## 8. Self-review

Read the whole diff cold. Findings, in the order they matter:

1. 🔴 **One branch has no criterion, found by running a mutation and seeing it pass**: §4.6's
   `M-MARKERS-CALL`. Reported rather than left to be discovered. The two halves either side of
   it are reddened; the branch between them is not.
2. **Assertions that read back a value the test itself wrote: none.** Checked each new
   assertion. The closest is the parents criterion's `expect(parents).toEqual([f.wTip, …])` —
   `f.wTip` comes from the fixture and `parents` comes back out of `git rev-list` on an object
   `rebuildMergeCommit` built, so it is not a round-trip; `M-TREE` reddens it. Likewise
   `expect(… ${sha}^{tree}).toBe(tree)`: `tree` is read from git and passed in, and the
   assertion measures whether `commit-tree` used it — a `commit-tree HEAD^{tree}` mutation
   would redden it (not run; `M-TREE` reddens the line above it first, see 4 below).
3. **A criterion whose stated purpose is not what it measures: none found**, with one
   qualification. S3's headline criterion is titled "reconciled and land" and its first
   assertion is an exit code, which is the one thing that could be argued to measure the round
   rather than the reconciliation. That is why the content, ledger and parents assertions
   follow it — and `M-TREE` / `M-BOUND` both show the exit-code assertion staying green while
   others redden, so it is not carrying the criterion on its own.
4. **Assertions whose red is masked by an earlier one in the same criterion.** Named honestly:
   - `expect((await git(…, [\`rev-parse\`, \`${sha}^{tree}\`])).trim()).toBe(tree)` — under
     `M-TREE` the parents assertion two lines above fires first. A "use the wrong tree"
     mutation would isolate it; not run.
   - S3's `expect(lines.every(…validateLine…)).toBe(true)` — every mutation tried either kept
     the ledger valid or removed the lines entirely, so the `some(kind === "reconcile")`
     assertion above it fires first. A "write a `reconcile` decision with a non-executable
     `undo.how`" mutation would isolate it; not run.
   - The parents criterion's `expect(parents[0]).not.toBe(incoming)` — `M-TREE` empties
     `found` in the helper before it runs.
5. **`netChangeSet` is now exported** from `harvest.ts` for `otherSideOf`. One new caller of an
   existing function, chosen over a second, subtly different `git diff` in `run.ts`. Its doc
   comment says why.
6. **A shared `git()` home exists now** (`gitExec.ts`), used by `reconcile.ts` (converted, one
   line) and `ledgerWiring.ts`. `land.ts` and `run.ts` still carry their own — converting them
   is a change to two files with no other reason to be touched (Rule 3). Net: **three
   definitions, down from the four this task would otherwise have left.** Said out loud, as
   instructed, rather than done silently.
7. **`otherSideOf`'s "not exactly one match" escalation has no criterion.** It is a Rule 12
   guard on a state S3's two-task fixture cannot produce (a three-task layer where two
   already-landed tasks both wrote the conflicted path would). Registered.
8. **`reconcileAndLand`'s three other escalation paths** — synthesize refused (S4/S20 cover the
   refusal, not this call site), reconciliation ended non-`succeeded`, reconciliation published
   no attempt commit — are likewise un-reddened Rule 12 guards. `M-MARKERS-INV` proves the
   escalation *machinery* (exit 3, copy kept, message printed) works; the other three branches
   share it.
9. **`git merge --ff-only` is asserted only implicitly.** If the rebuilt commit's first parent
   ever stopped being W's tip, this fails loudly rather than creating a second merge — but no
   criterion drives it there. `M-TREE` comes closest and passes the ff anyway, because the
   swapped parent is still an ancestor.

## 9. Concerns

1. 🔴 **S3's "exit 0" is not reachable** (§1(a)). This is a genuine inconsistency between the
   spec's §10.2 scenario table and its own §7.3, and I decided it in favour of §7.3 because
   §7.3 has shipped code, a scenario (S6) and a mutation (`M-A2`) behind it while S3's exit
   code has none. **A controller ruling is wanted**: either §10.2's S3 row is corrected to
   exit 2, or §7.3's second tier stops contributing 2 when the out-of-bounds write is the one
   that got reconciled — the second is a real design change and I did not make it.
2. 🔴 **§5.4's escalation file still has no owner.** Task 11 raised this; Task 12's brief does
   not mention it either. §5.4 requires `<runsDir>/escalations/<run-id>.md` carrying both
   intents, the conflict blocks and an executable `undo.how`. Every escalation path added here
   prints the copy path and the conflict ref name (§5.4's third point) and returns exit 3
   (second point), but **nothing writes the file** (first point). All the material is in hand
   at the escalation sites. Still assigned to nobody's criteria.
3. **The reconcile decision's `undo.how` is `git branch -f <W> <wTip>`**, which discards the
   merge — correct for this decision, and it passes `undoHowIsExecutable`. But if a later task
   lands on top of it, that undo also discards the later task. `blast_radius` says "the single
   merge commit this reconciliation puts on W", which is then an understatement. §8.6 already
   accepts W's history being imperfect; registered rather than fixed.
4. **The reconciliation clone relies on `git clone --local` carrying unreferenced objects.**
   Measured, not assumed (experiment in the scratchpad, since deleted): a clone of a repo
   whose only name for a commit is `refs/orca/conflict/x` still has the object
   (`git cat-file -e` exits 0), because `--local` copies the whole object store rather than
   negotiating refs. The conflict ref is pinned anyway, both because §5.2 step 5 asks for it
   and because an unreferenced commit is one `git gc` away from gone.
5. **`bound.taskId` is the reconciliation task's id (`reconcile-<taskId>`), not the pair.** The
   synthesized contract's `objective.taskId` carries the pair (`reconcile-<a>-<b>`); the plan
   task's id does not, because it becomes the run id and a taskId is a free string out of a
   plan file — splicing a second one in doubles the chance of a run id `allocateRunId` must
   refuse. Judgement call, argued in a comment, reversible.
6. **The round now spawns ccloop three times for a two-task plan** whenever a conflict occurs.
   That is the design (§5.2 reuses the whole pipeline), but it is worth stating that a layer
   where every pair collides costs O(landings) extra spawns.

---
---

# Task 12 — fix round 1

Run: same session `c2fd0c3b-0aaf-4a1b-960e-2d6cab3f7ad3`, 2026-09-04.
Commit created: `e93e907` (on `main`, not pushed).
Base for this round: `36f2610`. `npm run verify` exits 0 at `e93e907`;
**238 tests** (was 233), scheduler gate 119 (was 114).

## F1 — S3's parents criterion could not fail; it now can

**What was wrong.** `landingCommitOf` selects the merge commit with
`ps.length === 2 && ps[1] === incoming`, so every assertion the old criterion
made about `parents[1]`, `parents.length` and `parents[0]`'s membership in the
parents map was already guaranteed by the selection. Its comment claimed parent 0
was "the W tip the landing started from" — a measurement the code never made.

**What it does now** (`tests/scheduler/scenarios/S3.test.ts`, the criterion
renamed to *"lands a merge commit whose first parent is the W tip and whose tree
is the reconciled one"*). The selector is now documented as a **locator, not a
measurement**, and the three things asserted are things it did not fix:

1. `expect(t2.parents[0]).toBe(t1.sha)` — the expected first parent derived
   **independently** of the reconciliation, as T1's own landing commit found
   from T1's incoming ref.
2. `firstParents` (from `git rev-list --first-parent <workBranch>`) **contains**
   `t2.parents[0]` and **does not contain** `t2.incoming` — the same fact the
   way git states it; a parent swap flips both halves together.
3. The merge commit's **tree**, which nothing about its parents constrains,
   measured at the merge commit itself (`a.txt`, `b.txt`, no markers in
   `shared.txt`) rather than at W's tip, which is the ledger commit above it.

New sandbox helper: `firstParentCommits(repo, revision)`.

### The mutations, and an honest note on the first of them

**`M-FIRSTPARENT`** (the one the coordinator named) — **RED, but not by the new
assertions.** Literal patch:

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -430,7 +430,9 @@ async function reconcileAndLand(
     async () =>
       rebuildMergeCommit(
         copy,
-        state.wTip,
+        // M-FIRSTPARENT: the layer base is the commit this task actually
+        // started from, so use it as the merge's first parent.
+        ctx.layerBase,
         state.incomingRef,
         await writeTree(copy),
         `orca: land ${run.runId} (reconciled with ${other.taskId})`,
```
```
M-FIRSTPARENT EXIT=1
orca: the round failed: Error: Command failed: git merge --ff-only refs/orca/reconciled/orca-T2-17b3885a
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 3 failed) 1941ms
   × S3: … reconciled and land → expected 3 to be 2
   × lands a merge commit whose first parent is the W tip … → expected [] to have a length of 1
   × the bound line is blamed to the merge commit itself … → expected [] to have a length of 1
```

🔴 **Reported as asked**: it reddens, but by **crashing** — W's tip is not an
ancestor of a commit parented on the layer base, so `git merge --ff-only` fails
before any of the new assertions run. That is a real safety property (§5.2 step
4's first parent has to be W's tip or the landing cannot be a fast-forward at
all), but it does **not** demonstrate that the replacement assertions are
falsifiable. So I ran two more.

**`M-CONFLICTPARENT`** — first parent = the conflicted commit, which already has
the W tip as *its* first parent, so the fast-forward works and nothing crashes:

```diff
@@ -430,7 +430,10 @@ async function reconcileAndLand(
       rebuildMergeCommit(
         copy,
-        state.wTip,
+        // M-CONFLICTPARENT: the conflicted commit already has the W tip as its
+        // own first parent, so use it as the merge's first parent -- the
+        // fast-forward still works, so nothing crashes.
+        conflict.conflictCommit,
         state.incomingRef,
```
```
M-CONFLICTPARENT EXIT=1
   × lands a merge commit whose first parent is the W tip …
     → expected [ [ …(2) ], [ …(2) ] ] to have a length of 1 but got 2
   × the conflicted commit never reaches W → expected true to be false
```
RED, but the **locator** fires first: the conflicted commit is now reachable
from W and it *also* has `incoming` as its second parent, so two commits match.
Still not an isolation of assertion 1.

**`M-EXTRAPARENT`** — the isolation. It is also the most realistic of the three:
it is what an implementer gets by recording the ledger line as its own commit on
top of the W tip and merging that (a design I considered and rejected).

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -427,14 +427,26 @@ async function reconcileAndLand(
-    async () =>
-      rebuildMergeCommit(
+    // M-EXTRAPARENT: record the ledger line as its own commit on top of the W
+    // tip first, and merge THAT -- the fast-forward still works, the conflicted
+    // commit still never reaches W, and the bound line is still in the merge's
+    // tree.
+    async () => {
+      const tree = await writeTree(copy);
+      const ledgerCommit = (
+        await git(copy, [
+          "-c", "user.name=orca", "-c", "user.email=orca@invalid",
+          "commit-tree", tree, "-p", state.wTip, "-m", "orca: the reconciliation ledger line",
+        ])
+      ).trim();
+      return rebuildMergeCommit(
         copy,
-        state.wTip,
+        ledgerCommit,
         state.incomingRef,
-        await writeTree(copy),
+        tree,
         `orca: land ${run.runId} (reconciled with ${other.taskId})`,
-      ),
+      );
+    },
```
```
M-EXTRAPARENT EXIT=1
 ❯ tests/scheduler/scenarios/S3.test.ts (4 tests | 2 failed) 2175ms
   × lands a merge commit whose first parent is the W tip and whose tree is the reconciled one
     → expected 'a08d3673f672485cf0ad0c5e5430b1ca2d907…' to be '9871efe731f0306000619a87db6919dcfd185…'
       Expected: "9871efe731f0306000619a87db6919dcfd185923"
       Received: "a08d3673f672485cf0ad0c5e5430b1ca2d907494"
 ❯ tests/scheduler/scenarios/S3.test.ts:123:27
    123|     expect(t2.parents[0]).toBe(t1.sha);
```

🔴 **The red is on line 123 — `expect(t2.parents[0]).toBe(t1.sha)`, the exact
assertion the old criterion could not make.** The round lands, the exit code is
2, the tree assertions pass, the conflicted commit still never reaches W. (The
blame criterion reddens too, because `git blame` now attributes the bound line
to the intermediate commit — an independent confirmation that it measures what
it claims.) **The replacement is strictly better than what it replaced.**

## F2 — the three escalation branches

### (a) Markers remain — fixture built, `M-MARKERS-CALL` now RED

`seedUnreconcilableLyingPlan` + `createFileIfMissingCheck`: both tasks create
`shared.txt` **only if it is missing** — an ordinary shape. In each task's own
attempt worktree the file is absent and gets written (so they still collide); in
the reconciliation worktree it is present *as the conflicted text*, so every
required check is a no-op and ccloop reports `succeeded` over a tree full of
markers. Criterion: `S3escalations.test.ts`, *"refuses to land a reconciliation
that still has conflict markers in it"*.

Observed on the unmutated tree — the branch is genuinely taken:
```
orca: T2: reconciliation orca-reconcile-T2-0813c83d reported succeeded
orca: T2: escalating — the reconciliation of T2 x T1 passed both tasks' required checks
  but left conflict markers in shared.txt; the conflict is at refs/orca/conflict/orca-T2-0b26ed8b in …
```

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -386,8 +386,10 @@ async function reconcileAndLand(
   // express, because neither task's checks were written to notice a marker.
+  // M-MARKERS-CALL: the check still runs, but the escalation it drives is
+  // removed.
   const remaining = await markersRemaining(copy, reconcileRun.attemptSha, conflict.conflictedPaths);
-  if (remaining.length > 0) {
+  if (false) {
```
```
M-MARKERS-CALL EXIT=1     (it PASSED in the first round; the gap is closed)
   × refuses to land a reconciliation that still has conflict markers in it
     → expected 2 to be 3 // Object.is equality
   ✓ refuses to land when the reconciliation run itself did not succeed
```
Note the second criterion stays **green** — the two branches are independent.

### (b) The reconciliation did not succeed — fixture built, `M-RECONOUTCOME` RED

`seedLyingPlanWhoseReconciliationFails`: T2's last required check is
`test ! -e a.txt`, true in T2's own attempt worktree (it clones at the layer
base, before T1 landed) and false in the reconciliation's (its base is the
conflict commit, which already has T1's file). `maxAttempts` is pinned to 1 in
the synthesized contract, so the rejected verification is terminal —
**`exhausted`**, observed:

```
orca: T2: reconciliation orca-reconcile-T2-b7200b3d reported exhausted
orca: T2: escalating — the reconciliation of T2 x T1 ended exhausted; the conflict is at …
```

⚠️ The failing check is deliberately **last**, so the two writes above it still
run and still clear the markers. Without that, this criterion and (a) would be
reddened by the same guard and neither would isolate anything.

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -360,7 +360,9 @@ async function reconcileAndLand(
   ctx.log(`orca: ${taskId}: reconciliation ${reconcileRunId} reported ${reconcileRun.outcome}`);
 
-  if (reconcileRun.outcome !== "succeeded" || reconcileRun.attemptSha === null) {
+  // M-RECONOUTCOME: ccloop published an attempt either way, so land whatever
+  // it produced rather than reading its terminal status.
+  if (reconcileRun.attemptSha === null) {
```
```
M-RECONOUTCOME EXIT=1
   ✓ refuses to land a reconciliation that still has conflict markers in it
   × refuses to land when the reconciliation run itself did not succeed
     → expected 2 to be 3 // Object.is equality
```
Again the other criterion stays green. Each branch has its own red.

### (c) `otherSideOf` — 🔴 **REACHABLE**, and now exercised directly

Saying it plainly, as asked: **it is reachable, not an unobservable guard.**

- **More than one match** — three tasks in one layer that all lie about the same
  path. The first two land (the second through §5.2 itself), and the third's
  conflict then has two candidate counterparties.
- **Zero matches** — the conflicting change on W's side came from something
  other than a same-layer attempt (C's own ledger commits also touch W), or from
  a task that landed a *reconciled* tree no longer containing the path, since
  this measures attempts and not landings.

Per the ruling, a unit-level criterion rather than a three-task scenario:
`otherSideOf` is now exported and takes the three values it reads
(`targetRepo`, `layerBase`, `landed: {taskId, runId}[]`, `conflictedPaths`)
instead of the whole `ReconcileContext`. `tests/scheduler/otherSide.test.ts`
builds attempt refs by hand — exactly the shape `landIntoW` leaves behind — and
pins all three answers: the one-match case (with a second landed task that wrote
*elsewhere*, so it is not "whichever landed first"), the two-match refusal
naming both candidates, and the zero-match refusal.

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -272,7 +272,8 @@ export async function otherSideOf(
     if (changed.some((path) => conflicted.has(path))) touched.push(taskId);
   }
-  if (touched.length !== 1) {
+  // M-OTHERSIDE: one candidate is enough; take the first.
+  if (touched.length === 0) {
```
```
M-OTHERSIDE EXIT=1
   ✓ names the one already-landed task in this layer that wrote a conflicted path
   × refuses to pick a side when two already-landed tasks both wrote a conflicted path
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/otherSide.test.ts:77:31
```

## F3 — the success log no longer prints something false

`src/scheduler/run.ts`. The parenthetical "(the conflicted commit stays at
`<ref>` in `<copy>`)" was true only on the `--keep-workdirs` path and false
seven lines before `disposeWorkdir` removed that copy. Dropped. Where the
conflicted commit was recorded is already printed above, at the moment it was
true, and the disposal line says whether the copy was kept. The comment at the
change records why, so it is not re-added.

## F4 — the fourth deviation, recorded

**S3's "the conflicted commit never reaches W" uses reachability from W, not the
brief's `allRefShas(targetRepo)`.** `reachableCommits(repo, workBranch)` answers
"is this commit in W's history", which catches the commit arriving under any ref
*and* being merged — the property the criterion names. The brief's literal form
would additionally catch the commit merely entering the target repository's
**object store** while W stays clean; that weaker containment is not measured
here. (Containment does hold by construction: the reconciled attempt is consumed
as a *tree*, never as a parent, so neither it nor the conflicted commit is in
the fetch closure.) Listed here as the fourth deviation alongside §1's three.

## Restoration proof (this round)

```
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > before2.txt      # 104 files
$ … M-FIRSTPARENT / M-CONFLICTPARENT / M-EXTRAPARENT / M-MARKERS-CALL /
    M-RECONOUTCOME / M-OTHERSIDE in $SC/mut3 (git clone --local at e93e907) …
$ /bin/rm -f  $SC/mut3/node_modules   # then ls → No such file or directory
$ /bin/rm -rf $SC/mut3                # then ls → No such file or directory
$ /usr/bin/git ls-files -z | xargs -0 shasum -a 256 > after2.txt
$ diff before2.txt after2.txt
DIFF_EXIT=0
```

**Byte-identical, zero deltas** (no commit intervened this round, unlike round 1).

```
$ /usr/bin/git status --short        # (no output), exit 0
$ /usr/bin/git diff | wc -c          0
$ /usr/bin/git diff --cached | wc -c 0
```

## ccloop untouched

```
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short   # (no output)
STATUS_EXIT=0
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse --short HEAD
7f2c5f6
```

## Measured numbers (fix round)

| Thing | Value | Command |
|---|---|---|
| `npm run verify` at `e93e907` | **exit 0**, 19 s wall | `npm run verify > f 2>&1; echo $?` with `date +%s` either side |
| `npm test` inside it | 42 files / **238** tests | vitest's Duration/summary lines |
| `verify:scheduler` inside it | 35 files / **119** tests | same |
| diff `36f2610..e93e907` | 5 files, +352 / −30 | `git diff --stat` |
| the two new escalation scenarios | 1.68 s and 1.83 s (one ccloop round each, three spawns) | vitest per-test timings |
| the three `otherSide.test.ts` criteria | 0.37–0.45 s each (no ccloop spawn) | vitest per-test timings |

Money spent: **not reported** — no tool gave a per-task figure.

## What remains open after this round

1. **§5.4's escalation file** — assigned to Task 13 by the coordinator. All
   three escalation paths now print the copy path and the conflict ref name and
   return exit 3; none writes `<runsDir>/escalations/<run-id>.md`.
2. **The two masked assertions registered in round 1** (`reconcile.test.ts:149`
   and `S3.test.ts`'s `every(validateLine)`) stay registered, per the ruling.
3. **New, from this round**: `M-FIRSTPARENT` reddens by crashing rather than by
   assertion, so "the first parent must be an ancestor W can fast-forward from"
   is enforced by `git merge --ff-only` and observed only as a round failure.
   `M-EXTRAPARENT` covers the assertion side. No action taken; recorded so a
   later reader does not mistake the crash for the criterion.
