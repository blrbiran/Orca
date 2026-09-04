# Task 5 report — `orca plan`

Commit: `7383cf08c964f0ef4d51b79412b3f7553feee077`
`feat(scheduler): add orca plan, the run's front half stopped before it executes`

## What was implemented

- `src/scheduler/planReport.ts` (new) — `renderPlanReport(g, plan, preflight, opts)`, a pure
  printer. Exports `PLAN_LEVEL_CHECKS` (the six §2.3 codes) and `RUNTIME_CHECKS` (three §4.2
  runtime codes I named: `work-branch-already-exists`, `base-not-a-commit`,
  `target-worktree-dirty` — Task 6 must use exactly these strings for its real preflight or this
  print keeps calling them "not evaluated"). Also exports `PlanGraphExtras`, a structural
  extension (`{ emptyRequiredChecksPairs?: Array<{from,to}> }`, every field optional) that a real
  `TaskGraph` from `buildGraph()` already satisfies — see "Design decision" below.
- `src/cli.ts` (modified) — added the `plan <path> [--verbose]` subcommand: reads the plan JSON,
  reads the target repo's current branch via `git symbolic-ref --short HEAD` (a read, not a
  mutation) to get `defaultBranch`, calls `loadPlan` → on rejection prints them and exits 1; on
  success reads each task's contract file (already outside the target repo, guaranteed by
  `loadPlan`'s `contract-inside-target-repo` rejection), calls `buildGraph`, builds an empty
  preflight report (ruling R3), calls `renderPlanReport`, prints it, exits 0. Never spawns
  ccloop, never clones, never checks out or branches the target repo. The existing `validate` and
  `check-append-only` subcommands are untouched byte-for-byte (only additive lines around them).
- `tests/scheduler/sandbox.ts` (modified) — added `runCli(argv)` (thin wrapper over `main` from
  `src/cli.js`) and `seedTwoTaskPlan(s)` (writes two disjoint-path contracts + a valid plan file,
  using a fake, non-existent `ccloopBin` path deliberately so this scenario never touches the
  sandbox's lazy `ccloopBin` getter).
- `tests/scheduler/planReport.test.ts` (new) — 8 criteria for `renderPlanReport`.
- `tests/scheduler/scenarios/S17.test.ts` (new) — the zero-side-effect scenario.

### Design decision: `PlanGraphExtras` for the requiredChecks-union warning

Spec §9.1(6) asks `orca plan` to warn when an intersecting pair's `requiredChecks` union is
empty. That union can only be computed from each task's *parsed contract* — data `TaskGraph`
does not carry (it only carries the write sets derived from contracts, not the contracts
themselves), and `requiredChecksUnion` is a later task's function (per the P2 plan doc, listed
under a future task alongside `synthesizeReconcileContract`). I could not touch `graph.ts` (out
of scope for Task 5) and could not widen `preflight` beyond `{ rejections: PlanRejection[] }`
(ruling R3 pins that shape so Task 6's real `PreflightReport` stays assignable). The only
remaining, honest option: `PlanGraphExtras` is a structural superset of `TaskGraph` where every
added field is optional, so a real `TaskGraph` from `buildGraph()` satisfies it automatically —
no cast, no lie about the type. Today's `orca plan` never populates
`emptyRequiredChecksPairs`, so the warning never fires in production (consistent with ruling
R3's own treatment of the three runtime checks: honest omission, not a fabricated negative). The
renderer's logic is real and tested via `planReport.test.ts`'s `gEmptyChecks()` fixture, which
attaches the field the same way a later task's CLI wiring would. No mutation is named against
this criterion in the brief's Step 5 table, consistent with it having no current production wiring.

## TDD evidence

### RED

Reproduced by moving the just-written `src/scheduler/planReport.ts` aside and stashing the
`src/cli.ts` / `tests/scheduler/sandbox.ts` changes, then running:

```
npx vitest run tests/scheduler/planReport.test.ts tests/scheduler/scenarios/S17.test.ts
```

Real output:

```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/scheduler/planReport.test.ts (0 test)
 ❯ tests/scheduler/scenarios/S17.test.ts (1 test | 1 failed) 89ms
   × S17 (spec 9.2) > S17: orca plan touches not one byte of the target repository 88ms
     → seedTwoTaskPlan is not a function

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/scheduler/planReport.test.ts [ tests/scheduler/planReport.test.ts ]
Error: Failed to load url ../../src/scheduler/planReport.js (resolved id: ../../src/scheduler/planReport.js) in /Users/biran/code/skills/loop/Orca/tests/scheduler/planReport.test.ts. Does the file exist?
...
 Test Files  2 failed (2)
      Tests  1 failed (1)
EXIT:1
```

Expected because: `planReport.ts` did not exist yet (module resolution failure — genuine red,
not a design choice), and `seedTwoTaskPlan` was not yet exported from `sandbox.ts`. Both are
exactly the gaps Task 5 fills.

Implementation was then restored (`git stash pop`).

### GREEN

```
npx vitest run tests/scheduler
```
→ `Test Files 7 passed (7)`, `Tests 46 passed (46)`, exit 0. Includes all 8 `planReport.test.ts`
criteria and S17.

```
npm run typecheck
```
→ exit 0, no errors.

```
npm run verify
```
→ exit 0. `Tests 165 passed (165)` (full suite, including the pre-existing 7
`downgraded to tier 0` lines from historical ledger records — by design, per the task brief).
`tests/cli/cli.test.ts`'s existing `validate`/`check-append-only` criteria all still pass
unchanged.

## Mutation table

All three run in a `git clone --local` copy at
`/private/tmp/.../scratchpad/orca-mut`, cloned from the committed state
(`7383cf0`), with `node_modules` symlinked in and removed with `/bin/rm -f` before deleting the
clone with `/bin/rm -rf`. Each mutation was applied, tested, reverted with `git checkout --`, and
confirmed clean (`git status --porcelain` showed only the `node_modules` symlink) before the next.

| Mutation | Patch | Scenario | Result |
|---|---|---|---|
| `M-PLAN-SE` 🔴 | see below | S17 | **RED** |
| `M-PLAN-WARN` | see below | `prints the degradation warning...` | **RED** |
| `M-PLAN-TRUNC` | see below | `never truncates a list...` | **RED** |

### M-PLAN-SE

```diff
diff --git a/src/cli.ts b/src/cli.ts
index 1cbca62..62babb7 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -139,6 +139,7 @@ async function runPlan(args: string[]): Promise<number> {
     return 1;
   }
   const { plan } = result;
+  await execFileAsync("git", ["branch", plan.workBranch], { cwd: plan.targetRepo });
 
   // buildGraph's contracts map is the already-loaded contract per task, not
   // a path to go read one (graph.ts's own doc comment on that parameter) —
```

Command: `npx vitest run tests/scheduler/scenarios/S17.test.ts`

Real failing output:
```
 × S17 (spec 9.2) > S17: orca plan touches not one byte of the target repository 188ms
   → expected { …(2) } to deeply equal { Object (refs/heads/main) }
AssertionError: expected { …(2) } to deeply equal { Object (refs/heads/main) }
- Expected
+ Received
  Object {
    "refs/heads/main": "305f15b06e123760a437443d22bf602042eb5acc",
+   "refs/heads/orca/plan-scenario-branch": "305f15b06e123760a437443d22bf602042eb5acc",
  }
 Test Files  1 failed (1)
      Tests  1 failed (1)
EXIT:1
```

### M-PLAN-WARN

```diff
diff --git a/src/scheduler/planReport.ts b/src/scheduler/planReport.ts
index f4678cc..cc7e154 100644
--- a/src/scheduler/planReport.ts
+++ b/src/scheduler/planReport.ts
@@ -133,17 +133,6 @@ export function renderPlanReport(
   lines.push("Layers (parallelism):");
   g.layers.forEach((layer, index) => {
     lines.push(`  layer ${index}: ${layer.join(", ")} (parallelism: ${layer.length})`);
-    if (layer.length === 1) {
-      const taskId = layer[0];
-      const claimsRoot = (g.writeSets.get(taskId) ?? []).some((c) => c.normalized === "");
-      if (claimsRoot) {
-        lines.push(
-          `    ${taskId} claims the whole repository: no parallelism happens with ${taskId} — every other task ` +
-            `runs before or after it. Tasks that are merely downstream of ${taskId}, not of each other, may still ` +
-            `run concurrently with one another.`,
-        );
-      }
-    }
   });
   lines.push("");
```

Command: `npx vitest run tests/scheduler/planReport.test.ts`

Real failing output:
```
 ❯ tests/scheduler/planReport.test.ts (8 tests | 1 failed) 6ms
   × renderPlanReport (spec 9.1, 9.5) > prints the degradation warning next to the parallelism, not as a footnote 3ms
     → expected -1 to be greater than or equal to 0
AssertionError: expected -1 to be greater than or equal to 0
      |                  ^
 Tests  1 failed | 7 passed (8)
EXIT:1
```
(Only the targeted criterion went red; the other 7 stayed green — a properly isolated mutation.)

### M-PLAN-TRUNC

```diff
diff --git a/src/scheduler/planReport.ts b/src/scheduler/planReport.ts
index f4678cc..e17e14d 100644
--- a/src/scheduler/planReport.ts
+++ b/src/scheduler/planReport.ts
@@ -106,9 +106,13 @@ export function renderPlanReport(
   lines.push(`Intersecting pairs: ${g.implicit.length}`);
   if (opts.verbose) {
     for (const edge of g.implicit) {
-      for (const conflict of edge.conflicts) {
+      const shown = edge.conflicts.slice(0, 5);
+      for (const conflict of shown) {
         lines.push(`  ${edge.from} x ${edge.to}: ${conflict.kind} (${conflict.a.declared} vs ${conflict.b.declared})`);
       }
+      if (edge.conflicts.length > shown.length) {
+        lines.push(`  [+${edge.conflicts.length - shown.length} more]`);
+      }
     }
   }
   // §9.1(6): this warning is not part of the N^2 listing above — it is a
```

Command: `npx vitest run tests/scheduler/planReport.test.ts`

Real failing output:
```
 ❯ tests/scheduler/planReport.test.ts (8 tests | 1 failed) 6ms
   × renderPlanReport (spec 9.1, 9.5) > never truncates a list with a 'more' marker 4ms
     → expected 'Plan: 3 task(s), policy=local-merge, …' not to match /\+\d+ more/
...
  T1 x T2: equal (shared/file4.txt vs shared/file4.txt)
  [+20 more]
...
 Tests  1 failed | 7 passed (8)
EXIT:1
```
(Only the targeted criterion went red; the test's second assertion — every one of the 25
conflicting paths must be present — would independently have caught the same mutation.)

## Restoration proof

`shasum -a 256` of the five files this task touches, main worktree, before cloning and after the
clone was deleted:

```
$ shasum -a 256 src/cli.ts src/scheduler/planReport.ts tests/scheduler/planReport.test.ts tests/scheduler/sandbox.ts tests/scheduler/scenarios/S17.test.ts | sort -k2
798fc889f4492e4ea24b71152c61f15a646fb8319c18067592f11be4bb63df40  src/cli.ts
bdc3f90c9f94bf483c7fa8d34cc5aab705c209f3efd03c3035a84f0c4caee9ce  src/scheduler/planReport.ts
4e2f80b7b3bfe395ceaf40c31a040901bb349a6c8d064b30116576095bf05990  tests/scheduler/planReport.test.ts
1b3b88154c72a48f5a73c8eccfe50b66dad7248a3fa732aec8f55ad8aa8d74cb  tests/scheduler/sandbox.ts
a104fa451479f6e1fecb383def00fca59f04fa7cd09219b59fef29fd26104aa5  tests/scheduler/scenarios/S17.test.ts
```

Identical before (`pre-mutation.sha256`) and after (`post-mutation.sha256`); `diff` between the
two files produced no output. `git status --porcelain` on the main worktree showed nothing after
the clone was removed.

## Exact degradation-warning sentence

```
T1 claims the whole repository: no parallelism happens with T1 — every other task runs before or
after it. Tasks that are merely downstream of T1, not of each other, may still run concurrently
with one another.
```

Names the task, says nothing runs concurrently *with T1*, and explicitly does not claim the whole
plan is serial (ruling 2).

## Files changed

- `src/cli.ts` — added `plan` subcommand, `resolveDefaultBranch`, `runPlan`; `validate` and
  `check-append-only` untouched.
- `src/scheduler/planReport.ts` — new.
- `tests/scheduler/sandbox.ts` — added `runCli`, `seedTwoTaskPlan`.
- `tests/scheduler/planReport.test.ts` — new.
- `tests/scheduler/scenarios/S17.test.ts` — new.

## Self-review findings

- Checked for the two named smells: no assertion in any new test reads back a value the test
  itself just wrote before calling the code under test — every `renderPlanReport`/`runCli` call
  happens first, then assertions follow. No criterion's assertions measure something other than
  its stated purpose, as far as I can tell; the "never truncates" test additionally asserts the
  full path list is present (not just the absence of a marker), closing the gap a mutation could
  otherwise hide behind.
- No speculative code: `PlanGraphExtras` is the minimum structural surface needed for one
  documented, tested behaviour, not a general "attach anything" escape hatch.
- Nothing in `src/ledger/**`, `scripts/githooks/**`, `.decisions/**` touched.

## Concerns

- `PlanGraphExtras`/`emptyRequiredChecksPairs` has no production wiring in this task — only the
  printer logic is real and tested. Task 8/9 (`requiredChecksUnion`) needs to compute it and the
  CLI needs to attach it before this warning ever appears in a real `orca plan` run. This is an
  interface gap between the brief (which assumes `renderPlanReport`'s four fixed parameters are
  enough) and the reviewed `TaskGraph`/`PreflightReport` types, which I resolved by widening
  structurally rather than touching `graph.ts`; flagging in case a reviewer prefers a different
  seam once Task 8/9 lands.
- I chose the three runtime check code strings (`work-branch-already-exists`,
  `base-not-a-commit`, `target-worktree-dirty`) myself, since Task 6 hasn't defined them. Task 6
  must reuse these exact strings for the "not evaluated → fail" transition to work; documented in
  `planReport.ts`'s comment on `RUNTIME_CHECKS`.

---

# Fix round 1

Commit: `f5945d7d96a803fa315d1697214210466f451ab5`
`fix(scheduler): rename dirty-worktree to match Task 6's brief, wire the empty-requiredChecks warning for real`

Two Important findings from review, both ruled fix-required by the coordinator.

## Finding 1 — runtime check code conflicted with Task 6's brief

`RUNTIME_CHECKS`'s third entry was `"target-worktree-dirty"`, but `task-6-brief.md:32` already
hardcodes S22's rejection code as `"dirty-worktree"`. Per ruling:

1. Renamed to `"dirty-worktree"` in `src/scheduler/planReport.ts`'s `RUNTIME_CHECKS`.
2. `RUNTIME_CHECKS` was already an exported named constant (from the original implementation) —
   no further change needed there; updated its doc comment to say Task 6 must *import* it, and to
   record that `dirty-worktree` is now sourced from the brief, not invented.
3. The other two (`work-branch-already-exists`, `base-not-a-commit`) kept as-is per ruling (no
   authority elsewhere in the repo).

No other file referenced the old string (`grep -rn "target-worktree-dirty" src tests` → no
matches), and `tests/scheduler/planReport.test.ts` already referenced the runtime codes via the
`RUNTIME_CHECKS` import rather than a hardcoded literal, so the rename required no test changes
beyond the fixture text already covering `work-branch-already-exists`.

## Finding 2 — the empty-requiredChecks-union warning was wired to nothing

The warning printed only when `g.emptyRequiredChecksPairs` was populated, and nothing in
production ever populated it — unlike the three runtime checks (which at least render
`[not evaluated]`), this was indistinguishable from "checked, found none." Ruling: wire it for
real now, since the CLI already loads every contract to build write sets and `buildGraph` already
receives them.

### What was implemented

- **`requiredChecksUnion(a: unknown, b: unknown): string[]`** — new, in `src/scheduler/writeSet.ts`
  (the module that already reads other opaque contract fields). Reads `verification.
  requiredChecks` from each side defensively (missing/non-array → `[]`) and returns the deduped
  union. Comment instructs Task 11 to import this rather than define a second one, and records the
  measured fact the coordinator supplied (ccloop's schema requires `requiredChecks.min(1)`, so an
  empty union is only reachable because subsystem C reads contracts as unvalidated opaque JSON).
- **`emptyRequiredChecksPairs(g: TaskGraph, contracts: Map<string, unknown>): Array<{from,to}>`** —
  new, in `src/scheduler/planReport.ts`, exported. For every `g.implicit` edge, computes the union
  via `requiredChecksUnion` and collects the pair if empty. Pure — takes the same `contracts` map
  `buildGraph` already receives.
- **`src/cli.ts`'s `runPlan`** — after `buildGraph`, now computes
  `emptyRequiredChecksPairs(g, contracts)` and attaches it onto the graph object passed to
  `renderPlanReport` (`annotatedGraph = { ...g, emptyRequiredChecksPairs: ... }`). `PlanGraphExtras`
  was kept (not removed) because production now genuinely flows through it, per the ruling's own
  condition ("if you keep a seam, it must be one production actually flows through").
- **`tests/scheduler/sandbox.ts`** — added `captureStdout(fn)`, since asserting on what `orca plan`
  printed (not just its exit code) needed a way to capture `process.stdout.write` calls; restores
  the real `write` in a `finally`.

### Test changes

- `tests/scheduler/writeSet.test.ts` — added 3 tests for `requiredChecksUnion` directly (union with
  overlap, both-empty, missing field defaults to empty).
- `tests/scheduler/planReport.test.ts`:
  - Renamed/re-scoped the old "warns about an intersecting pair whose requiredChecks union is
    empty" test to "renders the escalation line for a pair emptyRequiredChecksPairs flagged
    (formatting only)" — its comment now says explicitly that it checks formatting given
    already-computed data, not whether production computes that data, and points to the new
    scenario test for that proof. This was the criterion the finding called decorative; keeping a
    narrow formatting-only test alongside the real wiring test is not the same claim the original
    made.
  - Added a new `describe("emptyRequiredChecksPairs ...")` block: two unit tests for the new pure
    function directly (flags when both sides have empty checks; does not flag when one side has a
    check).
- **`tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts`** (new) — the production-path
  proof. Builds a real sandbox, writes two contracts via `writeContract` with
  `requiredChecks: []` (deliberately invalid by ccloop's own schema, per the measured fact above —
  documented in the test's own comment) and disjoint-but-overlapping `targetPaths:
  ["shared/a.txt"]` on both sides, writes a real plan file, runs `orca plan` through `runCli`,
  captures stdout via `captureStdout`, and asserts the real output contains `"T1 x T2"` and
  `"would escalate"`.

### RED evidence (M-PLAN-UNION, doubling as this round's TDD red)

Ran in a fresh `git clone --local` copy of commit `f5945d7` (see mutation table below for the
clone/symlink/cleanup procedure — same as round 1). Applied the mutation, ran both the new
scenario test and `planReport.test.ts`, saw both the formatting test and the production-path test
go red together — the two-layer coverage (unit + integration) both catch the same defect.

## Mutation table (this round)

| Mutation | Patch | Scenario | Result |
|---|---|---|---|
| `M-PLAN-UNION` 🔴 | see below | `emptyRequiredChecksWarning.test.ts` + the formatting test in `planReport.test.ts` | **RED** |

### M-PLAN-UNION

```diff
diff --git a/src/scheduler/planReport.ts b/src/scheduler/planReport.ts
index 90afe39..fbab6f0 100644
--- a/src/scheduler/planReport.ts
+++ b/src/scheduler/planReport.ts
@@ -137,17 +137,6 @@ export function renderPlanReport(
       }
     }
   }
-  // §9.1(6): this warning is not part of the N^2 listing above — it is a
-  // proactive, always-on flag (spec's own "两种最贵形状" framing), so it must
-  // survive even in non-verbose mode, naming the pair so it is actionable
-  // without rerunning with --verbose.
-  for (const edge of g.implicit) {
-    if ((g.emptyRequiredChecksPairs ?? []).some((p) => pairMatches(p, edge.from, edge.to))) {
-      lines.push(
-        `  ${edge.from} x ${edge.to}: requiredChecks union is empty — this pair would escalate on its first conflict instead of being reconciled (spec §5.3)`,
-      );
-    }
-  }
   lines.push("");
 
   // §9.1(3) + §9.1(5): layers and each one's parallelism, with the
```

Command: `npx vitest run tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts tests/scheduler/planReport.test.ts`

Real failing output (both trimmed to the assertion):
```
 ❯ tests/scheduler/planReport.test.ts (10 tests | 1 failed) 9ms
   × renderPlanReport (spec 9.1, 9.5) > renders the escalation line for a pair emptyRequiredChecksPairs flagged (formatting only) 5ms
     → expected 'Plan: 3 task(s), policy=local-merge, …' to contain 'would escalate'

 ❯ tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts (1 test | 1 failed) 122ms
   × orca plan warns about an empty requiredChecks union (spec 5.3 / 9.1(6), fix round 1 finding 2) > prints the escalation warning through the real plan path, not a hand-built fixture 121ms
     → expected 'Plan: 2 task(s), policy=local-merge, …' to contain 'T1 x T2'

 Test Files  2 failed (2)
      Tests  2 failed | 9 passed (11)
EXIT:1
```

(The two new pure `emptyRequiredChecksPairs` unit tests, unaffected by this mutation — it's in the
renderer, not the computation — stayed green, confirming isolation: 9 passed = the other 9
`planReport.test.ts` criteria plus nothing extra double-counted.)

Reverted with `git checkout -- src/scheduler/planReport.ts`; re-ran `tests/scheduler` in the clone
— 8 files, 52 tests, all green, exit 0.

## Restoration proof (this round)

`shasum -a 256` of the eight files this round touches, main worktree, before cloning and after the
clone was deleted:

```
$ shasum -a 256 src/cli.ts src/scheduler/planReport.ts src/scheduler/writeSet.ts \
    tests/scheduler/planReport.test.ts tests/scheduler/sandbox.ts tests/scheduler/writeSet.test.ts \
    tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts tests/scheduler/scenarios/S17.test.ts \
    | sort -k2
e0428813ebec71b5c037b7f39c0acf6bdd6830c147c6506706dc7757fa970c10  src/cli.ts
8ff373c1cbd1f42cffa5f450c8825ca02a7b6c95024a5b897cea0453de87df47  src/scheduler/planReport.ts
c87954624886a86f4563aa2cd474dea7b6c947721a18aaa0e50d2cc58d0a7dec  src/scheduler/writeSet.ts
2fbfb4d7288ffe29da7f9c57e9806fc5b7132398c8cb0771b5a507e37fcf7117  tests/scheduler/planReport.test.ts
11693e5384c66ad0e0ea953486205fd64fa1a0c1f4ad0e93c553189a59b5131f  tests/scheduler/sandbox.ts
053023e73ba9152abd61573e52013e68fa182f70c2a0c4149569ab5f39dd3481  tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts
a104fa451479f6e1fecb383def00fca59f04fa7cd09219b59fef29fd26104aa5  tests/scheduler/scenarios/S17.test.ts
7e4846d1b7158a768cc8511d108299eec025ad9e5a9d8b28a1dd711c93f721c9  tests/scheduler/writeSet.test.ts
```

`diff` between the pre- and post-mutation checksum files produced no output. `git status
--porcelain` on the main worktree showed nothing after the clone was removed.

## Final verification

```
npm run verify
```
→ exit 0. `Tests 171 passed (171)` (up from 165 — 3 new `writeSet.test.ts` tests, 2 new
`emptyRequiredChecksPairs` unit tests, 1 new scenario test), with the same seven pre-existing
`downgraded to tier 0` lines.

## Files changed (fix round 1)

- `src/cli.ts` — wires `emptyRequiredChecksPairs` into the `plan` subcommand.
- `src/scheduler/planReport.ts` — `RUNTIME_CHECKS` rename; new `emptyRequiredChecksPairs` export;
  updated comments.
- `src/scheduler/writeSet.ts` — new `requiredChecksUnion` export.
- `tests/scheduler/sandbox.ts` — new `captureStdout` helper.
- `tests/scheduler/writeSet.test.ts` — new tests for `requiredChecksUnion`.
- `tests/scheduler/planReport.test.ts` — re-scoped one test, added a new describe block for
  `emptyRequiredChecksPairs`.
- `tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts` — new production-path scenario.

## Concerns

None outstanding from this round. The two deferred minors (the `git symbolic-ref` read happening
before `loadPlan`'s path checks, and `PlanGraphExtras`'s doc comment placement) were left as
instructed; the second is largely moot now since the comment was rewritten as part of finding 2's
fix to describe the real wiring rather than an unfilled seam.
