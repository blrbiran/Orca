# Task 4 report — the task graph (explicit ∪ implicit edges, Kahn layering, scheduling decisions)

**Commit:** `cb4fbb2` — `feat(scheduler): build the task graph from explicit and implicit edges`

## What was implemented

- `src/scheduler/graph.ts` (new):
  - `detectCycle(tasks: PlanTask[]): boolean` — the shared cycle detector ruling R2 asked for.
  - `buildImplicitEdges` (internal) — derives implicit edges from write-set intersection
    (`intersect()` from `pathTrie.ts`), direction tie-broken by `taskId` lexicographic order,
    skipping any pair that already has an explicit `dependsOn` edge in either direction (see
    "Design decisions" below for why).
  - `buildGraph(plan, contracts): TaskGraph` — computes each task's write set via `writeSetOf`,
    builds explicit + implicit edges, groups tasks into weakly-connected components (union-find),
    and layers each component with Kahn's algorithm. A component with any edge is fully
    serialised one task per layer; independent components/isolated tasks still batch freely at
    the same layer index. See the doc comment on `buildGraph` for why (spec §3.3's ** case, §3.4's
    over-serialise-is-safe direction, Rule 2 simplicity).
  - `implicitEdgeDecisions(g, runId, now = () => new Date().toISOString()): DecisionEvent[]` —
    one `scheduling` decision per implicit edge, `alternatives` carrying the untaken direction,
    `because` naming the taskId-lex tie-break explicitly (ruling #4). `now` is the injectable
    clock (ruling #2).
- `src/scheduler/planFile.ts` (ruling R2 convergence): removed the private `planHasCycle` DFS;
  `loadPlan`'s cycle rejection now calls the shared `detectCycle` from `graph.ts`.
- `tests/scheduler/graph.test.ts` (new): the brief's 5 criteria verbatim, plus 2 small direct
  unit tests for `detectCycle` (acyclic / 2-node cycle), since it is a newly-shared export with
  its own logic that Task 2's indirect coverage (via `loadPlan`) does not directly pin down.

**Import direction (R2's open question):** `graph.ts` imports `PlanFile`/`PlanTask` from
`planFile.ts` with `import type` — erased at compile time, so at runtime there is no dependency
from `graph.ts` back to `planFile.ts`. `planFile.ts` imports the real `detectCycle` value from
`graph.ts`. Net result: a real one-directional runtime dependency (`planFile.ts` → `graph.ts`),
no runtime cycle. `tsc --noEmit` confirms this compiles cleanly.

## TDD evidence

**RED** (module doesn't exist yet):
```
$ npx vitest run tests/scheduler/graph.test.ts
 FAIL  tests/scheduler/graph.test.ts [ tests/scheduler/graph.test.ts ]
Error: Failed to load url ../../src/scheduler/graph.js ... Does the file exist?
Test Files  1 failed (1)
RC=1
```
Expected: the criteria import a module that does not exist yet.

**GREEN** after implementation:
```
$ npx vitest run tests/scheduler/
 ✓ tests/scheduler/writeSet.test.ts (7 tests)
 ✓ tests/scheduler/pathTrie.test.ts (10 tests)
 ✓ tests/scheduler/planFile.test.ts (8 tests)
 ✓ tests/scheduler/graph.test.ts (7 tests)
 ✓ tests/scheduler/sandbox.test.ts (4 tests)
 Test Files  5 passed (5)
      Tests  36 passed (36)
RC=0
```
Task 2's `planFile.test.ts` (8 tests, including "rejects a cycle") and Task 3's
`pathTrie.test.ts`/`writeSet.test.ts` all still pass after the R2 convergence.

`npm run typecheck`: RC=0. `npm run verify`: RC=0 (the seven `downgraded to tier 0` lines are the
pre-existing historical records called out in the task instructions — by design, not this task's
concern).

## The `undoHowIsExecutable` audit (ruling R7)

Ran the real predicate directly (not a guess) against several candidate strings before picking
one, via `npx tsx` importing `src/ledger/undoExecutable.ts` directly:

```
"git checkout <sha> -- README.md" => true
"edit src/scheduler/planFile.ts: revert the cycle-detection call to the private DFS" => true
"revert graph.ts: remove the implicitEdgeDecisions call for edge T1->T2" => true
"swap the implicit edge direction back: T2 before T1 in src/scheduler/graph.ts" => true
"git revert <this-commit-sha>" => true
"delete the ImplicitEdge {from: T1, to: T2} entry from src/scheduler/graph.ts buildGraph output" => true
"set from=T2 to=T1 in src/scheduler/graph.ts's implicit edge for this pair" => true
"flip implicitEdge.from/to in src/scheduler/graph.ts" => true
"edit src/scheduler/graph.ts:120 swap from/to for the T1/T2 implicit edge" => true
```

Note: `"git checkout <sha> -- README.md"` measured `true` here, not the `false` the brief cited as
a known false negative — a discrepancy against the brief's stated example, but I did not rely on
it; I measured the actual template string I generate, below, mechanically:

```
"edit src/scheduler/graph.ts: swap the implicit edge direction between T1 and T2" => true
```

This is exactly the pattern `implicitEdgeDecisions` generates
(`` `edit src/scheduler/graph.ts: swap the implicit edge direction between ${edge.from} and ${edge.to}` ``),
confirmed passing for the actual generated values ("T1", "T2") the criterion exercises. The
"records every implicit edge as a scheduling decision with alternatives" test in
`tests/scheduler/graph.test.ts` additionally round-trips the generated decision through the real
`validateLine` and asserts `verdict === "ok"`, which is green (see GREEN run above).

## Mutation table

All three mutations were made and run inside a `git clone --local` copy at
`<scratchpad>/orca-mutate` (cloned from commit `cb4fbb2`, with a symlinked `node_modules`), one at
a time, each reverted with `git checkout --` before the next. The main worktree was never
touched.

| Mutation | What was deleted | Patch | Criterion fed | Command + real output | Result |
|---|---|---|---|---|---|
| **M-IMPL** | Implicit edges (only explicit `dependsOn` survives) | ```diff\n function buildImplicitEdges(tasks: PlanTask[], writeSets: Map<string, ClaimedPath[]>): ImplicitEdge[] {\n+  return []; // M-IMPL: only explicit dependsOn edges, no implicit ones\n   const explicitPairs = new Set<string>();\n``` | `serialises two tasks whose write sets intersect` | `npx vitest run tests/scheduler/graph.test.ts` → `expected 1 to be 2` (layers.length) and `expected +0 to be 1` (implicit.length); also broke the `**` and decisions tests. RC=1 | 🔴 RED |
| **M-DEC** | `alternatives` array in `implicitEdgeDecisions` | ```diff\n-      alternatives: [\n-        {\n-          option: `${edge.to} 先于 ${edge.from}`,\n-          why_not: `两个方向本身没有谁更对；按 taskId 字典序取小者在前作为确定性默认（${edge.from} < ${edge.to}），调度器不允许静默替人挑`,\n-        },\n-      ],\n+      alternatives: [], // M-DEC: dropped the untaken direction\n``` | `records every implicit edge as a scheduling decision with alternatives` | `npx vitest run tests/scheduler/graph.test.ts` → `expected 0 to be greater than or equal to 1` at the `alternatives.length` assertion. RC=1. Separately measured (isolated script, not filtered) that the real validator itself rejects the empty-alternatives record: `validateLine verdict: {"verdict":"rejected","reasons":["alternatives: Array must contain at least 1 element(s)"]}` — confirming the brief's specific claim mechanically, not by assumption. | 🔴 RED |
| **M-LAYER** | Layering logic, replaced with "everything in one layer" | ```diff\n export function buildGraph(plan: PlanFile, contracts: Map<string, unknown>): TaskGraph {\n+  return { layers: [plan.tasks.map((t) => t.taskId)], explicit: [], implicit: [], writeSets: new Map() }; // M-LAYER: everything in one layer\n   const taskIds = plan.tasks.map((t) => t.taskId);\n``` | `honours an explicit dependsOn even when write sets are disjoint` | `npx vitest run tests/scheduler/graph.test.ts` → `expected [ [ 'T1', 'T2' ] ] to deeply equal [ [ 'T1' ], [ 'T2' ] ]` at that exact test, plus 3 other tests also went red. RC=1 | 🔴 RED |

## Restoration proof

After each mutation the file was restored with `git checkout -- src/scheduler/graph.ts` inside
the clone. Final state of the clone's `git status --porcelain` after the last restore: only
`?? node_modules` (the symlink used for testing, never committed). Byte-identity of the three
touched files, main worktree vs. the clone after restoration:

```
MUTCOPY:
b4c7d0f4b37266b994c1c4e8bd1643d57fe31b2a346c63162e7f57a24f855052  .../orca-mutate/src/scheduler/graph.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  .../orca-mutate/src/scheduler/planFile.ts
390c4439d1ce4fc926590bbd96448d22b0a2cd3899ae1dd6bdc7cef60291e71b  .../orca-mutate/tests/scheduler/graph.test.ts
MAIN:
b4c7d0f4b37266b994c1c4e8bd1643d57fe31b2a346c63162e7f57a24f855052  /Users/biran/code/skills/loop/Orca/src/scheduler/graph.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  /Users/biran/code/skills/loop/Orca/src/scheduler/planFile.ts
390c4439d1ce4fc926590bbd96448d22b0a2cd3899ae1dd6bdc7cef60291e71b  /Users/biran/code/skills/loop/Orca/tests/scheduler/graph.test.ts
HASHES MATCH
```

The clone was then removed (`node_modules` symlink unlinked with `/bin/rm -f` first, then
`/bin/rm -rf` on the clone directory). The main worktree was `git status --porcelain` clean at
`cb4fbb2` before, during, and after the mutation exercise — verified again at the end.

## Design decisions and why (beyond what the brief/rulings state verbatim)

1. **Component-wide serialization, not narrowest-safe-parallel-batch.** Kahn's algorithm applied
   naively (batch every simultaneously-zero-in-degree node) would put `T2`/`T3` in the same layer
   in the `**` test even though they don't conflict directly with each other, only both with
   `T1` — giving `layers = [[T1],[T2,T3]]`, a max size of 2, which fails the test's requirement of
   max size 1. I read spec §3.3's literal wording ("它与所有任务相交 ⇒ 整图退化成全串行" — "the
   *whole graph* degenerates to serial") together with §3.4's explicit sanction of
   over-serialising as the safe direction, and implemented: any weakly-connected component that
   has at least one edge gets a strict total order (one task per layer, ties broken by taskId),
   while separate components (or truly isolated tasks) still parallelize freely at the same layer
   index. This is what makes the `**` case degenerate the *entire* graph, not just the hub task's
   direct neighbours, and it stays correct for smaller/partial conflict clusters too (an unrelated
   independent pair elsewhere in the same plan is unaffected).
2. **Implicit-edge generation skips pairs that already have an explicit edge.** Not tested
   directly, but load-bearing: if a pair's write sets conflict AND they already have an explicit
   `dependsOn` edge, and the taskId-lex tie-break happens to point the opposite way from the
   explicit edge, adding the implicit edge on top would silently create a 2-node cycle that
   nothing upstream checks for (`detectCycle` only looks at `dependsOn`). Skipping is also the
   honest scheduling story — there is no arbitrary choice to record when order was never
   ambiguous.
3. **`scope: "task"`** for the generated decisions — the choice concerns the relative order of
   two specific tasks, not a repo-wide or cross-repo concern.
4. **Ledger content (question/chose/because/alternatives) is written in Chinese**, matching the
   observed house style in `.decisions/orca-dev-10762e47.jsonl` and friends (Rule 11 — match the
   codebase's conventions). The repo's English-only rule (CLAUDE.md) applies to code, comments,
   CLI help text, and commit messages — not to generated ledger data, which is the artifact this
   house style already governs.

## Files changed

- `/Users/biran/code/skills/loop/Orca/src/scheduler/graph.ts` (new)
- `/Users/biran/code/skills/loop/Orca/src/scheduler/planFile.ts` (removed `planHasCycle`, now
  calls `detectCycle` from `graph.ts`)
- `/Users/biran/code/skills/loop/Orca/tests/scheduler/graph.test.ts` (new)

## Self-review findings

- Checked for the two known-bad shapes (Rule 9): no assertion in `graph.test.ts` reads back a
  value the test itself just wrote before the call under test — every assertion follows the
  `buildGraph`/`implicitEdgeDecisions` call it exercises. Checked each test's stated purpose
  against what it actually measures (via the mutation table above): all three named mutations hit
  exactly the criterion the brief names, confirmed with real (unfiltered, redirected-to-file) test
  runs, not by inspection alone.
- No scope creep found: `detectCycle`'s two extra unit tests are the only addition beyond the
  brief's own Step 1 code, and they exist because R2 makes `detectCycle` a newly-shared export
  whose own logic deserves direct (not just indirect, via `loadPlan`) coverage.
- Did not touch `src/ledger/**`, `scripts/githooks/**`, `.decisions/**`, or the sandbox harness.

## Concerns

- The brief's own example claim ("`git checkout <sha> -- README.md` is judged not executable") did
  not reproduce when measured directly against the current `undoExecutable.ts` (it measured
  `true`, not `false`). This did not block the task — I measured my actual generated string
  instead of relying on that example — but it's worth someone confirming whether the predicate
  changed since that observation was recorded, or whether the earlier round tested a subtly
  different string.
- The "component-wide serialization" layering design (see Design Decisions §1) is more
  conservative than the narrowest mathematically-safe parallel schedule would be. This is
  spec-sanctioned (§3.4) and required to pass the given `**` test, but it means, e.g., two
  genuinely-independent tasks that both merely happen to conflict with a third common task will
  be forced fully serial relative to each other too, not just relative to the common task. Worth
  flagging for whoever writes `orca plan`'s degradation-warning UI (Task 5) since the "why is this
  serial" story is now "shares a connected component with a conflict," which is a slightly wider
  net than "conflicts with this specific other task."

---

# Fix round 1

**Commit:** `05a7eb5` — `fix(scheduler): printable pair keys and batched Kahn layering`

Two Important findings from review, both ruled by the controller as "must fix."

## Finding 1 — NUL-byte pair key made `graph.ts` a binary file to git

**Root cause, confirmed mechanically** (not just accepted on the reviewer's word): a byte-level
check on the committed file found two literal NUL bytes at the site the reviewer named:

```
$ python3 -c "
data = open('src/scheduler/graph.ts', 'rb').read()
print('NUL count', data.count(b'\x00'))
idx = data.find(b'\x00')
print(repr(data[max(0,idx-50):idx+50]))
"
NUL count 2
b'tring, b: string): string {\n  return a < b ? `${a}\x00${b}` : `${b}\x00${a}`;\n}\n\n/**...'
```

This also explains an anomaly I had noticed but wrongly dismissed during the original mutation
run — `git diff` on `graph.ts` reported `Binary files a/src/scheduler/graph.ts and
b/src/scheduler/graph.ts differ` and I worked around it with `--text` instead of investigating
why a source file was being read as binary. That was a discipline lapse (Rule 14): the anomaly
itself was evidence, and I should have chased it there rather than during the follow-up review.

**Fix:** `pairKey` now returns `JSON.stringify([a, b].sort())` — printable, injective for
arbitrary strings, no delimiter character that could collide with taskId content (`taskId` has no
character restriction: `planFile.ts`'s schema is `z.string().min(1)`). Comment added explaining
why the separator must stay printable text.

**Verified fixed:**
```
$ python3 -c "print(open('src/scheduler/graph.ts','rb').read().count(b'\x00'))"
0
$ git diff -- src/scheduler/graph.ts | head -3
diff --git a/src/scheduler/graph.ts b/src/scheduler/graph.ts
index f395f14..41c21a2 100644
Binary files a/src/scheduler/graph.ts and b/src/scheduler/graph.ts differ
```
(That last "Binary files differ" line is comparing against the *old, committed* blob, which still
has the NUL bytes — expected for a diff against history. `git diff --text` against that same old
blob renders a normal line-based diff, confirming the working-tree file itself is no longer
binary; and after committing `05a7eb5`, the file's own history diff will render normally too since
the parent commit itself now needs no `--text` override going forward.)

## Finding 2 — layering serialised whole connected components (plan-mandated fix)

**Root cause:** the original `buildGraph` grouped tasks into weakly-connected components and gave
any component with an edge a strict total order (one task per layer), which over-serialises a
diamond (A→B, A→C, B→D, C→D, B/C disjoint) to `[[A],[B],[C],[D]]` instead of the correct
`[[A],[B,C],[D]]`.

**Controller's ruling, implemented verbatim:**
1. Replaced the per-component one-at-a-time layering with standard batched Kahn: every task at
   zero in-degree in a given step is batched into that step's layer together (sorted by taskId for
   determinism), across the whole graph — no component grouping, no union-find, needed at all. The
   new implementation is also simpler than what it replaced.
2. Replaced the `**` criterion in `tests/scheduler/graph.test.ts` with the property the controller
   specified: `T1` (claiming `**`) is alone in the first layer and both implicit edges exist, while
   `T2` and `T3` — merely downstream of `T1`, not of each other — land in the same next layer.
3. Re-ran `M-IMPL` against the amended criterion (below) — confirmed still red.
4. Added the diamond criterion (`A→B, A→C, B→D, C→D`, all write sets disjoint, explicit
   `dependsOn` only) asserting `[[A],[B,C],[D]]`.

## Re-run of covering tests

```
$ npx vitest run tests/scheduler/graph.test.ts tests/scheduler/planFile.test.ts
 ✓ tests/scheduler/planFile.test.ts (8 tests) 5ms
 ✓ tests/scheduler/graph.test.ts (8 tests) 5ms
 Test Files  2 passed (2)
      Tests  16 passed (16)
RC=0
```
(`graph.test.ts` went from 7 to 8 tests: the old `**` criterion was replaced 1-for-1, and the new
diamond criterion was added — 5 buildGraph tests + 2 detectCycle tests + 1 new diamond test = 8.)

`npm run typecheck`: RC=0. `npm run verify`: RC=0, same seven expected `downgraded to tier 0`
historical lines, unrelated to this change.

## Mutation re-run (fresh `git clone --local` from commit `05a7eb5`)

All three named mutations were re-applied and re-verified against the fixed code and amended
criteria, one at a time, each reverted before the next, in a second scratch clone
(`orca-mutate2`), same procedure as the original round.

| Mutation | Patch | Criterion fed | Command + real output | Result |
|---|---|---|---|---|
| **M-IMPL** (re-run, item 3) | ```diff\n function buildImplicitEdges(tasks: PlanTask[], writeSets: Map<string, ClaimedPath[]>): ImplicitEdge[] {\n+  return []; // M-IMPL: only explicit dependsOn edges, no implicit ones\n``` | `a task claiming ** shares a layer with no one, while tasks merely downstream of it may still run together` (the amended criterion) | `npx vitest run tests/scheduler/graph.test.ts` → `expected +0 to be 2` at `expect(g.implicit.length).toBe(2)` (line 81), plus the same 2 other failures as before (`serialises two tasks...`, `records every implicit edge...`). RC=1. | 🔴 RED — confirms the amended criterion is **not weaker** than the one it replaced; reporting per item 3 as requested. |
| **M-DEC** (re-run) | ```diff\n-      alternatives: [\n-        {\n-          option: `${edge.to} 先于 ${edge.from}`,\n-          why_not: `...`,\n-        },\n-      ],\n+      alternatives: [], // M-DEC: dropped the untaken direction\n``` | `records every implicit edge as a scheduling decision with alternatives` | `npx vitest run tests/scheduler/graph.test.ts` → `expected 0 to be greater than or equal to 1` at `alternatives.length`. RC=1. | 🔴 RED — unaffected by the fix, as expected. |
| **M-LAYER** (re-run) | ```diff\n export function buildGraph(plan: PlanFile, contracts: Map<string, unknown>): TaskGraph {\n+  return { layers: [plan.tasks.map((t) => t.taskId)], explicit: [], implicit: [], writeSets: new Map() }; // M-LAYER: everything in one layer\n``` | `honours an explicit dependsOn even when write sets are disjoint` | `npx vitest run tests/scheduler/graph.test.ts` → `expected [ [ 'T1', 'T2' ] ] to deeply equal [ [ 'T1' ], [ 'T2' ] ]` at the named criterion, plus 4 other failures including the new diamond test. RC=1. | 🔴 RED — still catches it, and now also catches the diamond regression. |

## Restoration proof (second round)

```
$ git status --porcelain   # inside orca-mutate2, after final git checkout --
?? node_modules
$ shasum -a 256 orca-mutate2/{src/scheduler/graph.ts,src/scheduler/planFile.ts,tests/scheduler/graph.test.ts}
063a5fb569d6118d7fb5df13c08b23bbbddbe3036b5e4569b12f2118e12c2830  .../orca-mutate2/src/scheduler/graph.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  .../orca-mutate2/src/scheduler/planFile.ts
6743bf2f5f0b8aaaba38cf1570064628fceadd32ab77bc7dfe9f64acf7897274  .../orca-mutate2/tests/scheduler/graph.test.ts
$ shasum -a 256 /Users/biran/code/skills/loop/Orca/{src/scheduler/graph.ts,src/scheduler/planFile.ts,tests/scheduler/graph.test.ts}
063a5fb569d6118d7fb5df13c08b23bbbddbe3036b5e4569b12f2118e12c2830  .../src/scheduler/graph.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  .../src/scheduler/planFile.ts
6743bf2f5f0b8aaaba38cf1570064628fceadd32ab77bc7dfe9f64acf7897274  .../tests/scheduler/graph.test.ts
HASHES MATCH
```

The clone was removed (`node_modules` symlink unlinked with `/bin/rm -f`, then `/bin/rm -rf` on
the directory). Main worktree confirmed `git status --porcelain` clean at `05a7eb5` throughout.

## Deferred / carried, not touched

- The untested defensive `throw` for "no schedulable task" — recorded by the controller as a
  deferred minor. Left as-is.
- Task 5's degradation-warning wording — the controller is carrying that into Task 5's own
  dispatch. Did not touch any Task 5 file.

## Files changed (this round)

- `/Users/biran/code/skills/loop/Orca/src/scheduler/graph.ts` — `pairKey` fixed to printable
  `JSON.stringify`; `buildGraph`'s layering rewritten to standard batched Kahn (removed union-find
  and per-component special-casing entirely — net simpler code).
- `/Users/biran/code/skills/loop/Orca/tests/scheduler/graph.test.ts` — replaced the `**` criterion
  with the corrected property; added the diamond-batching criterion.
