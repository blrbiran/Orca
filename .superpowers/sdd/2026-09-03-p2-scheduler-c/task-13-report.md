# Task 13 report: ledger wiring (§8) + exit-code reduction (§6.3)

Commit: `7e9f3c5` (`feat(scheduler): wire the ledger and pin the exit-code precedence at 3 > 2 > 1 > 0`), on top of `e93e907`.

## What was implemented

1. **`src/scheduler/exitCode.ts`** (new): `ExitContribution = 0|1|2|3` and `reduceExitCode`, implementing spec §6.3's `3 > 2 > 1 > 0` precedence as an explicit `PRECEDENCE` table walked in order, rather than the `Math.max` `run.ts` carried before (faithful only because `harvest.ts` happens to emit just 0/2/3 today). `run.ts` now imports and calls it; the old `roundExitCode` function is deleted.

2. **`src/scheduler/ledgerWiring.ts`** (extended):
   - `boundaryDecision` — spec §7.3's second-tier decision (`disposition` judges "out of bounds, no sibling collision, land anyway" but Task 9 never wrote it down). `kind: "boundary"`, `scope: "task"`.
   - `writeEscalationFile` / `escalationFilePath` / `EscalationFacts` / `EscalationSide` / `intentOfContract` — spec §5.4's escalation file at `<runsDir>/escalations/<run-id>.md`: both sides' intent (when known), the conflict blocks, and an executable `undo.how`.
   - `ccloopEvidence` / `findCcloopRoot` — spec §9.1's evidence requirement: walks up from `ccloopBin` to find the repo root (`package.json` + `.git`), reads its declared version and `git rev-parse HEAD`.

3. **`src/scheduler/run.ts`** (wiring):
   - `reconcileAndLand`'s failure return type widened with `otherTaskId: string | null` and `conflictBlocks: string[]`, populated at all four of its failure returns, so the single downstream escalation-writing call site can build real content without reaching back into the function's internals.
   - Three escalation-file call sites: the disposition out-of-bounds/intersecting-sibling refusal (`verdict.exitContribution === 3`), the `!reconciled.landed` convergence point (covers the empty-required-checks-union refusal, the one-sided-contract refusal, an unidentifiable other side, a failed reconciliation run, and markers left behind — all four of `reconcileAndLand`'s failure returns), and the round's uncaught-exception handler.
   - Boundary decisions are collected per task (`pendingBoundaries`) during the per-task loop and committed only **after** the whole layer has landed — see "A regression I caused and fixed" below for why.
   - `roundId` hoisted to a `let` above the try block so the exception handler can name the round; `evidence` computed once per round (via `ccloopEvidence`) and attached to every decision this task's code appends.

## TDD evidence

### RED (brief's Step 1 test, before `exitCode.ts` existed)

```
$ npx vitest run tests/scheduler/exitCode.test.ts
 FAIL  tests/scheduler/exitCode.test.ts [ tests/scheduler/exitCode.test.ts ]
Error: Failed to load url ../../src/scheduler/exitCode.js ... Does the file exist?
```
Expected: the module didn't exist yet — a real, non-tautological red (module resolution failure, not a passing-then-inverted assertion).

### GREEN
```
$ npx vitest run tests/scheduler/exitCode.test.ts
 ✓ tests/scheduler/exitCode.test.ts (5 tests) 2ms
```
(5th test — empty-array → 0 — added by me beyond the brief's four, to pin the vacuous case `Math.max`'s seed used to guarantee for free.)

### Full suite, before/after, and `npm run verify`
- Baseline before this task's src changes: 124 scheduler tests / 36 files green (measured on `e93e907` + my new `exitCode.test.ts`).
- After all implementation + new criteria: `npx vitest run tests/scheduler` → **37 files / 131 tests, exit 0**.
- `npm run verify` → **exit 0** (`npm test`: 44 files / 250 tests; `npm run verify:scheduler`: 37/131; ledger validate, CLAUDE.md line count, hooks-path check all pass).

## The `undoHowIsExecutable` audit

Ran the real predicate (`src/ledger/undoExecutable.ts`) mechanically against a representative instance of every `undo.how` form this task's code generates:

```
{"label":"boundaryDecision","how":"git reset --hard 3b1f9c2a7e4d6081b5f2a9c0d4e7f1a2b3c4d5e6","executable":true}
{"label":"escalation: disposition-collide / reconcile-failure (run.workdir)","how":"rm -rf /var/tmp/orca-runs/orca-T2-1fe9d0dd","executable":true}
{"label":"escalation: exception path (escalationFilePath)","how":"rm -rf /var/tmp/orca-runs/escalations/orca-round-a1b2c3d4.md","executable":true}
```
Command: `npx tsx <script importing undoHowIsExecutable>`, all three pass (`hasCommandShape`: `rm`/`-rf` and `reset`/`--hard` are the arg-shaped pair in each case). These three exact literal forms (`git reset --hard <sha>`, `rm -rf <absolute path>` twice) are the only `undo.how` shapes the implementation ever constructs — every call site interpolates into one of them.

Beyond the mechanical audit, the real production strings are also exercised inside the test suite itself and read back through `undoHowIsExecutable` directly (not just through `validateLine`'s `verdict === "ok"`, which could pass on a decision whose undo.how is garbage if some OTHER field also happened to be wrong in a way that made a broader check pass): `tests/scheduler/scenarios/S3.test.ts`'s new boundary-decision test, and all three escalation-file criteria (`S3escalations.test.ts` ×2, `S7.test.ts`, `roundFailure.test.ts`) each extract `undo.how` from the real generated content and call `undoHowIsExecutable` on it directly.

## The two debts

### Debt 1 — spec §5.4's escalation file

Implemented as `writeEscalationFile`/`escalationFilePath` in `ledgerWiring.ts`, wired into the **three physical call sites** in `run.ts` that between them cover the **five named causes**:

| Cause | Call site |
|---|---|
| out-of-bounds-intersecting-sibling disposition | `if (verdict.exitContribution === 3)`, right after `disposition()` |
| empty-required-checks-union refusal | `if (!reconciled.landed)` (via `synthesizeReconcileContract`'s `planReconciliation` escalate) |
| one-sided-contract refusal | same call site (via `synthesizeReconcileContract`'s `oneSided` escalate) |
| a failed reconciliation (ccloop outcome not `succeeded`, or markers left behind) | same call site |
| the exception path | the `catch (err)` block |

(A sixth: `otherSideOf`'s "cannot name a single other side" also funnels into the same `if (!reconciled.landed)` call site — not one of the five named, but covered for free by centralizing there.)

Criteria (all four extended/new test files run against the real code, not mocked):
- `tests/scheduler/scenarios/S7.test.ts` — new `it`, full round via `runCli`, out-of-bounds write intersecting a sibling's declared claim. Asserts the file exists under `runsDir/escalations/`, `!path.startsWith(s.targetRepo)`, and `undoHowIsExecutable(how)`.
- `tests/scheduler/scenarios/S3escalations.test.ts` — both existing `it`s (markers-remaining; reconciliation-run-failed) extended with the same three assertions.
- `tests/scheduler/scenarios/roundFailure.test.ts` — a **new fixture** (see "A wrong first attempt" below) for the exception path, same three assertions, plus confirming the EACCES-fixture's escalation write fails gracefully (logged, not silently swallowed, not masking the original error/exit code) since `runsDir` is deliberately unwritable there.

Mutations (one per call site) — see "Mutation table" below.

### Debt 2 — the tier-1 `boundary` decision

`boundaryDecision` in `ledgerWiring.ts`, wired into `run.ts`: whenever `reconciliation.outOfBounds.length > 0` (which, given `disposition`'s own logic, is exactly the tier-1/tier-0 boundary condition — `land:true` cases only reach here when `!collides`), `run.ts` captures `beforeSha` (W's tip right before that task's own landing attempt) and, **after the whole layer has finished landing**, appends+commits one boundary decision per such task.

Criterion: `tests/scheduler/scenarios/S3.test.ts`'s new `it` — reuses S3's existing round (T1's write to `shared.txt` is out-of-bounds and does not collide with T2's declared `b.txt`, so T1 gets a tier-1 boundary decision). Reads the decision back, asserts `kind === "boundary"`, `scope === "task"`, and separately extracts `undo!.how` and feeds it through the real `undoHowIsExecutable` directly (not just `validateLine`'s aggregate verdict).

## A regression I caused and fixed (worth recording)

My first version wrote+committed the boundary decision **immediately**, right after the out-of-bounds log line, **before** that task's own `landIntoW` call. This broke a pre-existing, reviewed assertion in `S3.test.ts` ("lands a merge commit whose first parent is the W tip") — because inserting a commit between one same-layer task's landing and the next task's `landIntoW` call changes what `git rev-parse HEAD` reports as `wTip` at the moment the second task's merge is attempted, so the second task's merge's first parent is no longer literally the first task's landing commit.

I caught this by running the full scheduler suite after the change (not just my own new test) and seeing `S3.test.ts`'s pre-existing second `it` go red with a sha mismatch. Fix: collect boundary decisions during the per-task loop (capturing `beforeSha` inline, cheaply) but defer the actual `appendEvent`+`commitLedgerOnW` to **after** the whole layer's landings finish — the same timing `landingOrderDecision` already uses, for the identical reason. Verified green afterward (`S3.test.ts`: 5/5).

## A wrong first attempt at the exception-path escalation test (worth recording)

I initially tried to add the exception-path escalation-file assertions onto `roundFailure.test.ts`'s existing EACCES-based fixture. That fixture makes `runsDir` unwritable for the *entire* `runCli` call — including the moment my own `catch` block tries to `mkdir`/`writeFile` the escalation file under that same `runsDir`. So the escalation write fails too (by design — it's wrapped in its own try/catch precisely so a write failure there can't mask the original error), and no file is ever produced. Asserting file-existence there would have been asserting something structurally impossible given that fixture, not a real test of the mechanism. I added a **second, new** fixture (`ccloopBin` pointing at a nonexistent path, so `ccloopEvidence` throws right after `roundId` is derived, with `runsDir` fully writable throughout) to actually prove the successful case, and kept the EACCES fixture's extension narrowly scoped to proving the failure is *handled* (logged, not silently swallowed) rather than that a file appears.

## Mutation table (all run inside a `git clone --local` copy; main worktree untouched — proof below)

| Mutation | Literal patch | Command | Real failing output |
|---|---|---|---|
| **M-EXIT** (brief-named) | `-const PRECEDENCE: readonly ExitContribution[] = [3, 2, 1, 0];`<br>`+const PRECEDENCE: readonly ExitContribution[] = [2, 3, 1, 0];` | `npx vitest run tests/scheduler/exitCode.test.ts` | `AssertionError: expected 2 to be 3` on `reduceExitCode([2, 3, 0])).toBe(3)` |
| **M-BOUNDARY** | deleted the `for (const pending of pendingBoundaries) { ...appendEvent(boundaryDecision...); commitLedgerOnW... }` block in `run.ts`, replaced with a comment | `ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S3.test.ts` | `AssertionError: expected undefined not to be undefined` on `expect(boundary).not.toBeUndefined()` — only that 1 of 5 S3 tests failed |
| **M-ESC-DISPOSE** | deleted the `if (verdict.exitContribution === 3) { ...writeEscalationFile... }` block | `... npx vitest run tests/scheduler/scenarios/S7.test.ts` | `Error: ENOENT: no such file or directory, scandir '.../runs/escalations'` — only the new end-to-end `it` failed |
| **M-ESC-RECONCILE** | deleted the `sides`/`writeEscalationFile`/log block inside `if (!reconciled.landed)` | `... npx vitest run tests/scheduler/scenarios/S3escalations.test.ts` | both extended `it`s failed with the same `ENOENT ... escalations` |
| **M-ESC-EXCEPTION** | deleted the `try { ...writeEscalationFile... } catch (writeErr) { ... }` block in the round's `catch` handler | `... npx vitest run tests/scheduler/scenarios/roundFailure.test.ts` | the EACCES test's `expect(captured.stderr).toContain("could not record the escalation file")` failed (the log line it depends on no longer exists), and the new fixture's `readdir` found no files — 2 of 3 roundFailure tests failed |
| **M-EVIDENCE** | `ccloopEvidence` body replaced with `return [];` | `... npx vitest run tests/scheduler/ledgerWiring.test.ts` | `expect(d.evidence?.join(" ")).toMatch(/[0-9a-f]{40}/)` failed (evidence array empty), and `expect(evidence).toHaveLength(1)` failed with `+0` — 2 of 4 ledgerWiring tests failed |
| **M-UNDO** (proves the undo-executable assertion is not tautological) | `undoHow: \`rm -rf ${run.workdir}\`` → `undoHow: \`clean up the copy for ${taskId} by hand once a human has decided what to do\`` (prose) | `... npx vitest run tests/scheduler/scenarios/S7.test.ts` | `expect(undoHowIsExecutable(how!)).toBe(true)` → `expected false to be true` — specifically that line, with the earlier file-existence assertions still green, proving that assertion measures something the earlier ones don't |

Every mutation was reverted by overwriting the mutated file with a saved pristine copy and diffed byte-for-byte identical (`diff pristine mutated && echo IDENTICAL`) before moving to the next one, so mutations never compounded.

### Restoration proof (main worktree)

```
$ shasum -a 256 src/scheduler/run.ts src/scheduler/ledgerWiring.ts src/scheduler/exitCode.ts
0818488c23b1c7a2580f966345c9d1c2e54c08652c1fb2a8f5d91ae1279e0fcf  src/scheduler/run.ts
a7afbb848c6bc992e741cce9a74675141ce698303ef1b8fcc3c20708cff94352  src/scheduler/ledgerWiring.ts
9f42fdfda8fd76b7e82150150e0f942eeea1d9db7a420cfd17122d13332a8f45  src/scheduler/exitCode.ts
```
Identical before mutation testing started and after the clone was deleted (measured both times; diffed byte-for-byte equal). `git status --short`, `git diff --stat`, and `git diff --cached --stat` on the Orca main tree were all empty throughout — the main worktree was never touched; every mutation lived only in `/private/tmp/.../scratchpad/orca-mutate`, a `git clone --local` of commit `7e9f3c5`, deleted (`node_modules` symlink removed with `/bin/rm -f` first, then the clone with `/bin/rm -rf`) after mutation testing finished.

## ccloop-untouched confirmation

```
$ git -C /Users/biran/code/skills/loop/ccloop status --short
(empty)
$ git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```
Matches the required HEAD exactly; no changes at any point in this task.

## Files changed

- `src/scheduler/exitCode.ts` (new)
- `src/scheduler/ledgerWiring.ts`
- `src/scheduler/run.ts`
- `tests/scheduler/exitCode.test.ts` (new)
- `tests/scheduler/ledgerWiring.test.ts` (new)
- `tests/scheduler/scenarios/S3.test.ts`
- `tests/scheduler/scenarios/S3escalations.test.ts`
- `tests/scheduler/scenarios/S7.test.ts`
- `tests/scheduler/scenarios/roundFailure.test.ts`

## Self-review

For each new assertion, the mutation that would redden it:
- `exitCode.test.ts`'s five assertions: M-EXIT reddens the "3 wins" one directly; the other four are simple enough (`[0,2,0]→2`, `[0,2]≠0`, `[0,0]→0`, `[]→0`) that any wrong `PRECEDENCE` ordering or off-by-default reddens at least one — verified by hand-tracing `reduceExitCode`'s loop, not run as a separate mutation given time budget (M-EXIT already demonstrates the loop-vs-Math.max distinction that matters).
- `ledgerWiring.test.ts`'s "writes into the task's own copy" test: mutation would be dropping `writeBoundThenCommit`'s `.decisions` write entirely — not run as a named mutation since the function itself is Task 12's completed, reviewed code; this criterion exists to pin the calling convention (decision-then-bound, same file) that Task 13's new call sites (none touch this function's behavior) depend on being unbroken.
- The three escalation-file properties (exists / not-on-W / undo.how executable) and the boundary decision's properties: each has a named mutation in the table above, and M-UNDO specifically demonstrates the undo.how assertion is not implied by the file-existence assertions (they stayed green while it went red).
- `ccloopEvidence`'s two tests: M-EVIDENCE reddens both.

Two things I did **not** do, named rather than hidden:
1. `route.escalates` (ccloop's own `blocked_waiting_human` outcome) also contributes exit-code 3 but was deliberately **not** given an escalation file — it is not one of the five causes the controller named, and it is arguably ccloop's own per-task escalation concern rather than spec §5.4's conflict-adjacent shape (no "conflict blocks", often no identifiable "other side"). If this is wrong, it needs its own ruling — I did not silently extend scope to cover it.
2. `otherSideOf`'s "cannot name a single other side" branch (ambiguous conflict counterpart) is covered by the same `if (!reconciled.landed)` call site as the other four `reconcileAndLand` failures, but I did not write a **dedicated** fixture forcing that specific branch (it needs three tasks in one layer all touching the same path — a more elaborate fixture than time allowed). It is exercised by the same code path as the two S3escalations fixtures, so a mutation deleting the shared call site is caught either way, but a bug specific to that one `return` statement's `otherTaskId`/`conflictBlocks` values would not be caught by my current tests.
3. `intentOfContract`'s "no goal declared" placeholder path is implemented but not independently tested — every fixture I used has both sides' contracts fully populated. A contract missing `objective.goal` would still produce a valid, non-throwing escalation file (by design), but nothing currently proves that placeholder text actually appears.

## Concerns

- None that block completion. The three items above are gaps in *test breadth*, not known defects — flagging them per Rule 12 rather than claiming exhaustive coverage.

---

## Fix round 1

Commit: `fec384b` (`fix(scheduler): name the colliding sibling in the tier-0 escalation, not just the acting task`), on top of `7e9f3c5`.

### The finding (Important)

`run.ts:684` built the tier-0 (out-of-bounds-**and**-colliding) escalation with `sides: [intentOfContract(round.contracts, taskId)]` — the acting task only. The colliding sibling was available (`sameLayerWriteSets(graph, taskId)`, the same map `disposition` intersects against `outOfBounds` internally to decide `collides`) but was passed inline and discarded rather than bound to a variable and consulted. This under-delivered debt 1's "both sides' intent" requirement on precisely spec §7.3's most severe branch, and `S7.test.ts`'s end-to-end test did not assert the sibling's id appeared, so it passed silently.

### Fix

1. `sameLayerWriteSets(graph, taskId)` is now bound to `siblingWriteSets` before the `disposition` call, rather than passed inline.
2. The escalation branch (`verdict.exitContribution === 3`) now runs the identical check `disposition` (harvest.ts) uses internally — `reconciliation.outOfBounds.map(normalizeClaim)` then `intersect(oob, claims).length > 0` per sibling — imported from `pathTrie.js`/`writeSet.js` rather than re-implemented, so it can never disagree with the verdict that got the code into this branch in the first place.
3. Every identified colliding sibling's `intentOfContract` is appended to `sides`.
4. If `collidingSiblings` comes back empty (should not happen given `verdict.exitContribution === 3`, but not assumed away), the escalation's `reason` text says explicitly that a colliding sibling exists but could not be re-identified, rather than silently writing one side with no acknowledgement.
5. Per the finding's instruction, also added a one-line comment on the pre-existing `conflictBlocks: reconciliation.outOfBounds` line explaining why this call site carries whole-file paths rather than `path:startLine-endLine` block strings (no real git merge conflict exists in this branch, so there is no line range to give) — a deferred review minor that cost nothing to note.

### The assertion that would have caught this, and its mutation

Added to `tests/scheduler/scenarios/S7.test.ts`'s end-to-end test:
```ts
expect(text).toContain("**T2**");
```
Deliberately checking the bolded `**T2**` form the "What each side intended" section renders each side as (`intentOfContract`'s output), **not** a bare `"T2"` substring — after this fix, `"T2"` also appears inside the `reason` text (which now names the colliding sibling there too), so a bare-substring check would have passed even with the bug still present, and would have been exactly the kind of assertion this plan's Rule 9 footnote warns about.

**Named mutation `M-ESC-ONESIDE`** — reverts to the pre-fix, one-sided shape:
```diff
--- a/src/scheduler/run.ts
+++ b/src/scheduler/run.ts
@@ -711,15 +711,10 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
             // `intersect`, not a second implementation of the test, so this
             // can never disagree with the verdict that got us into this
             // branch in the first place.
-            const oob = reconciliation.outOfBounds.map(normalizeClaim);
-            const collidingSiblings = [...siblingWriteSets.entries()]
-              .filter(([, claims]) => intersect(oob, claims).length > 0)
-              .map(([siblingTaskId]) => siblingTaskId);
-
+            // M-ESC-ONESIDE: drop the sibling lookup, back to naming only
+            // the acting task (the pre-fix shape review finding 1 flagged).
+            const collidingSiblings: string[] = [];
             const sides: EscalationSide[] = [intentOfContract(round.contracts, taskId)];
-            for (const siblingTaskId of collidingSiblings) {
-              sides.push(intentOfContract(round.contracts, siblingTaskId));
-            }
 
             const escalationPath = await writeEscalationFile(plan.runsDir, {
               runId: run.runId,
```
Command: `ORCA_CCLOOP_BIN=/Users/biran/code/skills/loop/ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S7.test.ts` (run inside a fresh `git clone --local` of commit `fec384b`).

Real failing output — the new assertion reddens specifically, at its own line, with everything above it (file exists, not on W, `"T1"`/`"b.txt"` present — visible in the printed escalation content in the failure output) still green:
```
 ❯ tests/scheduler/scenarios/S7.test.ts:143:20
    141|       // assertion above it (file exists, not on W, "T1"/"b.txt" prese…
    142|       // still green.
    143|       expect(text).toContain("**T2**");
       |                    ^
    144|       const how = /- how: `([^`]+)`/.exec(text)?.[1];
    145|       expect(how).not.toBeUndefined();

 Tests  1 failed | 1 passed (2)
```
The printed escalation content in the failing run confirmed the pre-fix shape exactly: `"## What each side intended\n\n- **T1**: write a.txt ..."` with no `**T2**` entry, and the `reason` text falling back to the "could not be re-identified" wording (since `collidingSiblings` was mutated to always be empty) — proving the fallback-wording branch is also reachable and does not itself crash.

### Re-run of covering tests

- `npx vitest run tests/scheduler/scenarios/S7.test.ts` → 2/2 green (main tree).
- `npx vitest run tests/scheduler --reporter=dot` → **37 files / 131 tests, exit 0** (no regressions from the fix).
- `npm run verify` → **exit 0** (typecheck, `npm test` 44/250, ledger validate, CLAUDE.md/hooks checks, `verify:scheduler` 37/131).

### Restoration proof

```
$ shasum -a 256 src/scheduler/run.ts tests/scheduler/scenarios/S7.test.ts
66804015e66aea007c340871ddef5546e91a8684db0760add51f06fd0d32b05d  src/scheduler/run.ts
a4b7678f757b4fc9cafd1e502202875476313cf04b1be014f027397c85e006a9  tests/scheduler/scenarios/S7.test.ts
```
Identical before the mutation clone was created and after it was deleted (`node_modules` symlink removed with `/bin/rm -f`, then the clone with `/bin/rm -rf`). `git status --short`, `git diff --stat`, and `git diff --cached --stat` on the Orca main tree were empty throughout.

### ccloop-untouched confirmation

```
$ git -C /Users/biran/code/skills/loop/ccloop status --short
(empty)
$ git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```

### Deferred items — not touched

Per the coordinator's instruction, left alone for the final whole-branch review: the boundary-decision-per-loop-item vs. edgeDecisions-batch commit-timing inconsistency; `otherSideOf`'s ambiguous-other-side branch still has no dedicated fixture; `intentOfContract`'s "no goal declared" placeholder remains unexercised.

### `blocked_waiting_human` — already settled

No change made; confirmed still correct per the coordinator's ruling (contributes exit 3, writes no escalation file — §5.4's content does not exist for a blocked run).
