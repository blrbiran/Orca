# Task 6 report — 仓库锁（S21）＋ 运行时前置（S18／S19／S22）

commit: `1535db1` (main, HEAD) — `feat(scheduler): one orca per target repo, and refuse to run on a dirty worktree`

## What was implemented

- **`src/scheduler/repoLock.ts`** — `acquireRepoLock(targetRepo)`. `mkdir(<targetRepo>/.git/orca-lock)`
  (non-recursive); `EEXIST` throws `Error` matching `/already/i`; never returns null. Writes a
  human-readable `info` file (pid + ISO timestamp) into the lock dir — nothing reads it back, no
  stale-lock heuristic. `release()` is idempotent (`rm -rf` the lock dir, guarded by a `released`
  flag so a second call is a no-op).
- **`src/scheduler/preflight.ts`** — `preflight(plan, defaultBranch): Promise<PreflightReport>`
  where `PreflightReport = { rejections: PlanRejection[] }` (Ruling R3, exact shape, no extra
  fields). Three checks, all read-only against the target repo:
  - `work-branch-already-exists` — `git rev-parse --verify --quiet refs/heads/<workBranch>` (S18)
  - `base-not-a-commit` — `git rev-parse --verify --quiet <defaultBranch>^{commit}` (S19)
  - `dirty-worktree` — `git status --porcelain` non-empty (S22)

  Imports `RUNTIME_CHECKS` from `planReport.ts` and destructures the three codes from it rather
  than retyping the strings (Ruling 1).
- **`src/cli.ts`** — `runPlan` now calls `preflight(plan, defaultBranch)` for real and passes the
  result into `renderPlanReport` with `runtimeChecksEvaluated: true` (see "unplanned but necessary
  fix" below). Removed the now-dead `PlanRejection` import and the fabricated
  `{ rejections: [] }` placeholder.

### Unplanned but necessary fix in `src/scheduler/planReport.ts`

Wiring `preflight()` into the CLI (ruling 3) was not sufficient on its own: `renderPlanReport`
hard-coded `evaluated = false` for every `RUNTIME_CHECKS` code, so a code absent from
`rejections` **always** printed `[not evaluated]`, never `[pass]` — regardless of whether a real
preflight had run. This is structurally impossible to satisfy ruling 3's own required criterion
("the report no longer says `[not evaluated]`... on a plan where they can be evaluated") without
touching this function, and I caught it via a real RED run (see below), not by inspection.

At the same time, Task 5's own frozen test (`tests/scheduler/planReport.test.ts`, "prints the
landing policy...") calls `renderPlanReport` directly with a hand-built
`{ rejections: [{code:"cycle",...}] }` and asserts `[not evaluated] work-branch-already-exists`
for that exact call — a call that (by construction) never went through a real preflight. Since
`PreflightReport` cannot carry an extra field (Ruling R3), the two requirements can only both hold
if the *caller* supplies the "did I actually run this?" signal through a different channel.

Fix: added an **optional** `opts.runtimeChecksEvaluated?: boolean` to `renderPlanReport`, default
`false` (preserves the exact old behavior when omitted — Task 5's test is untouched and still
green). `src/cli.ts` is the only caller that sets it to `true`, because it is the only caller that
actually ran `preflight()`. Verified this breaks nothing: `npm run verify` — 181 tests, all green,
exit 0, including the untouched `planReport.test.ts` and `emptyRequiredChecksWarning.test.ts`.

## TDD evidence

### RED

Command: temporarily moved `src/scheduler/repoLock.ts` and `src/scheduler/preflight.ts` out of the
tree, then:

```
npx vitest run tests/scheduler
```

Real output (redirected to a file, read back whole — no `grep`/`tail`):

```
❯ tests/scheduler/repoLock.test.ts (0 test)
❯ tests/scheduler/scenarios/S19.test.ts (0 test)
❯ tests/scheduler/scenarios/S21.test.ts (0 test)
❯ tests/scheduler/scenarios/S18.test.ts (0 test)
❯ tests/scheduler/scenarios/S22.test.ts (0 test)
❯ tests/scheduler/preflight.test.ts (0 test)
❯ tests/scheduler/scenarios/planWiresPreflight.test.ts (1 test | 1 failed)
  × ... > prints [pass], not [not evaluated] ... 183ms
    → expected 'Plan: 2 task(s)...' to contain '[pass] work-branch-already-exists'
    [actual stdout showed all three runtime checks as [not evaluated]]

Test Files  7 failed | 8 passed (15)
     Tests  1 failed | 52 passed (53)
exit=1
```

Why expected: six new test files fail to even load (`Failed to load url .../repoLock.js` /
`.../preflight.js` — "Does the file exist?") because the modules genuinely did not exist yet; the
seventh (`planWiresPreflight.test.ts`) is a real assertion failure showing the pre-Task-6
"`[not evaluated]`" text verbatim, which is exactly the wiring gap ruling 3 exists to catch.

### GREEN

Restored the two files, wired `preflight` into `cli.ts`, fixed `renderPlanReport`'s
`runtimeChecksEvaluated` flag. Command:

```
npx vitest run tests/scheduler
```

Result: `Test Files 15 passed (15)`, `Tests 62 passed (62)`, `exit=0`. CLI output now shows:

```
Preflight checks:
  [pass] relative-path
  [pass] duplicate-task-id
  [pass] cycle
  [pass] contract-inside-target-repo
  [pass] work-branch-is-default
  [pass] unsupported-policy
  [pass] work-branch-already-exists
  [pass] base-not-a-commit
  [pass] dirty-worktree
```

Then `npm run typecheck` → exit 0, and full `npm run verify` → `Test Files 22 passed (22)`,
`Tests 181 passed (181)`, exit 0 (the whole suite, ledger + scheduler + CLI, all green; the seven
`downgraded to tier 0` lines from `.decisions/` are the known-by-design historical records noted
in the task brief).

## Mutation table

All five run inside a `git clone --local` copy of the just-committed main worktree (commit
`1535db1`), with `node_modules` symlinked in and removed with `/bin/rm -f` before the copy was
deleted with `/bin/rm -rf`. Each mutation was applied, tested, then reverted with
`git checkout -- <file>` before the next.

| Mutation | Deletes | Fed scenario | Command | Result |
|---|---|---|---|---|
| **M-LOCK** | the repo lock itself (§1.2 #3) | S21 | `npx vitest run tests/scheduler/scenarios/S21.test.ts` | RED — `promise resolved "{ release: [AsyncFunction release] }" instead of rejecting` |
| **M-DIRTY** | §4.2.1 worktree-clean check | S22 | `npx vitest run tests/scheduler/scenarios/S22.test.ts` | RED — `expected [] to include 'dirty-worktree'` |
| **M-LOCK-b** | "can't acquire ⇒ throw" replaced with "return null-equivalent and continue" | S21 | `npx vitest run tests/scheduler/scenarios/S21.test.ts` | RED — same as M-LOCK: `promise resolved ... instead of rejecting` |
| **M-WB-EXIST** | "workBranch already exists" check | S18 | `npx vitest run tests/scheduler/scenarios/S18.test.ts` | RED — `expected [] to include 'work-branch-already-exists'` |
| **M-BASE** | "base is a real commit" check | S19 | `npx vitest run tests/scheduler/scenarios/S19.test.ts` | RED — `expected [] to include 'base-not-a-commit'` |

### Literal patches (`git diff` inside the clone, each applied and reverted independently)

**M-LOCK** (`src/scheduler/repoLock.ts`):

```diff
diff --git a/src/scheduler/repoLock.ts b/src/scheduler/repoLock.ts
index c7c0d1b..07a3465 100644
--- a/src/scheduler/repoLock.ts
+++ b/src/scheduler/repoLock.ts
@@ -26,29 +26,20 @@ export interface RepoLock {
  * making the lock check and the cleanliness check fight each other.
  */
 export async function acquireRepoLock(targetRepo: string): Promise<RepoLock> {
-  const lockDir = join(targetRepo, ".git", "orca-lock");
-  try {
-    await mkdir(lockDir);
-  } catch (err) {
-    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
-      throw new Error(`orca: another orca process already holds the repo lock on ${targetRepo} (${lockDir})`);
-    }
-    throw err;
-  }
-
-  // Written for a human who goes looking for who is holding the lock — pid
-  // and wall-clock time, nothing this module (or any caller) ever reads
-  // back. A stale-lock heuristic (e.g. "the pid is dead, so steal the lock")
-  // is deliberately out of scope: it is a fresh source of exactly the wrong
-  // kind of guess this design otherwise refuses to make.
-  await writeFile(join(lockDir, "info"), `pid ${process.pid}\nacquired ${new Date().toISOString()}\n`);
+  // M-LOCK: the repo lock itself deleted — no mkdir, no EEXIST check. Any
+  // number of orca processes can now "acquire" the same target repo
+  // concurrently.
+  void mkdir;
+  void writeFile;
+  void join;
+  void targetRepo;
 
   let released = false;
   return {
     release: async () => {
       if (released) return;
       released = true;
-      await rm(lockDir, { recursive: true, force: true });
+      void rm;
     },
   };
 }
```

**M-DIRTY** (`src/scheduler/preflight.ts`):

```diff
diff --git a/src/scheduler/preflight.ts b/src/scheduler/preflight.ts
index f51480a..ebd1e49 100644
--- a/src/scheduler/preflight.ts
+++ b/src/scheduler/preflight.ts
@@ -82,17 +82,7 @@ export async function preflight(plan: PlanFile, defaultBranch: string): Promise<
     });
   }
 
-  // S22 / §4.2.1: C checks out the target repo's own worktree onto W — that
-  // is the main path, not a side effect — so it must never run on top of
-  // work a human left uncommitted. Measured with `git status --porcelain`,
-  // never `git diff`: diff is blind to an untracked file's content (§9.2's
-  // own warning, same reasoning as S17's byte-identical porcelain check).
-  if (await worktreeIsDirty(plan.targetRepo)) {
-    rejections.push({
-      code: DIRTY_WORKTREE,
-      message: `target repo worktree is not clean: ${plan.targetRepo}`,
-    });
-  }
+  // M-DIRTY: §4.2.1's worktree-clean check deleted.
 
   return { rejections };
 }
```

**M-LOCK-b** (`src/scheduler/repoLock.ts`):

```diff
diff --git a/src/scheduler/repoLock.ts b/src/scheduler/repoLock.ts
index c7c0d1b..ae2b88e 100644
--- a/src/scheduler/repoLock.ts
+++ b/src/scheduler/repoLock.ts
@@ -31,7 +31,15 @@ export async function acquireRepoLock(targetRepo: string): Promise<RepoLock> {
     await mkdir(lockDir);
   } catch (err) {
     if ((err as NodeJS.ErrnoException).code === "EEXIST") {
-      throw new Error(`orca: another orca process already holds the repo lock on ${targetRepo} (${lockDir})`);
+      // M-LOCK-b: degrade to hermes's no-op-on-missing-fcntl behavior —
+      // return as if the lock had been acquired and let the caller continue.
+      let releasedB = false;
+      return {
+        release: async () => {
+          if (releasedB) return;
+          releasedB = true;
+        },
+      };
     }
     throw err;
   }
```

**M-WB-EXIST** (`src/scheduler/preflight.ts`):

```diff
diff --git a/src/scheduler/preflight.ts b/src/scheduler/preflight.ts
index f51480a..7b37bc9 100644
--- a/src/scheduler/preflight.ts
+++ b/src/scheduler/preflight.ts
@@ -59,16 +59,7 @@ export async function preflight(plan: PlanFile, defaultBranch: string): Promise<PreflightReport> {
   const rejections: PlanRejection[] = [];
 
-  // S18 / §4.2 runtime rejection: an existing workBranch must never be
-  // silently reused. Reuse would mean merging onto a branch that may already
-  // carry someone else's un-landed work, with no record that anyone chose
-  // to build on top of it.
-  if (await refIsKnown(plan.targetRepo, `refs/heads/${plan.workBranch}`)) {
-    rejections.push({
-      code: WORK_BRANCH_ALREADY_EXISTS,
-      message: `workBranch ${JSON.stringify(plan.workBranch)} already exists in ${plan.targetRepo}`,
-    });
-  }
+  // M-WB-EXIST: the "workBranch already exists" check deleted.
 
   // S19 / §4.2 runtime rejection: the base is the default branch's HEAD at
   // run start (spec §4.2 — the work branch is cut from it, and each layer's
```

**M-BASE** (`src/scheduler/preflight.ts`):

```diff
diff --git a/src/scheduler/preflight.ts b/src/scheduler/preflight.ts
index f51480a..ff9eadc 100644
--- a/src/scheduler/preflight.ts
+++ b/src/scheduler/preflight.ts
@@ -70,17 +70,7 @@ export async function preflight(plan: PlanFile, defaultBranch: string): Promise<PreflightReport> {
     });
   }
 
-  // S19 / §4.2 runtime rejection: the base is the default branch's HEAD at
-  // run start (spec §4.2 — the work branch is cut from it, and each layer's
-  // base is W's rolling HEAD), derived at runtime rather than a plan-file
-  // field. A repository with zero commits at all is the honest fixture: its
-  // default branch is unborn and does not resolve to any commit yet.
-  if (!(await resolvesToACommit(plan.targetRepo, defaultBranch))) {
-    rejections.push({
-      code: BASE_NOT_A_COMMIT,
-      message: `default branch ${JSON.stringify(defaultBranch)} does not resolve to a real commit in ${plan.targetRepo}`,
-    });
-  }
+  // M-BASE: the "base is a real commit" check deleted.
 
   // S22 / §4.2.1: C checks out the target repo's own worktree onto W — that
   // is the main path, not a side effect — so it must never run on top of
```

## Restoration proof

Main worktree was never mutated — every mutation was applied inside
`/private/.../scratchpad/orca-mutate-clone`, a `git clone --local` of the just-committed
`1535db1`. After the last mutation was reverted (`git checkout -- src/scheduler/preflight.ts`),
`git status --porcelain` in the clone showed only the untracked `node_modules` symlink (no tracked
file differs).

Byte-identical proof, measured directly rather than eyeballed:

```
cd <main> && git ls-files -z | xargs -0 shasum -a 256 | sort > main.sha256
cd <clone> && git ls-files -z | xargs -0 shasum -a 256 > clone-raw.sha256
diff <(awk '{print $1}' main.sha256 | sort) <(awk '{print $1}' clone-raw.sha256 | sort)
```

Both files: 76 tracked files. `diff` exit code: **0** (identical hash sets). The clone's
`node_modules` symlink was then removed with `/bin/rm -f`, and the clone directory removed with
`/bin/rm -rf`. Main worktree `git status --porcelain` after cleanup: empty; `git log --oneline -1`
still shows `1535db1` as the only new commit, no amend, no second commit.

## `plan` prints real verdicts — confirmed

Before Task 6, `orca plan` on a valid two-task plan printed:

```
[not evaluated] work-branch-already-exists
[not evaluated] base-not-a-commit
[not evaluated] dirty-worktree
```

After: same plan now prints

```
[pass] work-branch-already-exists
[pass] base-not-a-commit
[pass] dirty-worktree
```

and `tests/scheduler/scenarios/planWiresPreflight.test.ts` locks this in as a permanent criterion
so a future regression (preflight silently un-wired again) fails loudly instead of reading as an
"incomplete but harmless" report.

## Files changed

- `src/scheduler/repoLock.ts` (new, 54 lines)
- `src/scheduler/preflight.ts` (new, 98 lines)
- `src/cli.ts` (wired preflight into `runPlan`, removed dead import)
- `src/scheduler/planReport.ts` (added optional `opts.runtimeChecksEvaluated`, default-preserving;
  updated the now-stale `RUNTIME_CHECKS` comment)
- `tests/scheduler/sandbox.ts` (added `seedPlan()` helper, ruling 9)
- `tests/scheduler/repoLock.test.ts` (new — unit-level lock lifecycle)
- `tests/scheduler/preflight.test.ts` (new — unit-level happy path)
- `tests/scheduler/scenarios/S18.test.ts`, `S19.test.ts`, `S21.test.ts`, `S22.test.ts` (new)
- `tests/scheduler/scenarios/planWiresPreflight.test.ts` (new — ruling 3's wiring criterion)

## Self-review findings

- Scanned every new test for the two named traps: (a) an assertion before the call under test
  reading back a value the test itself just wrote — none found; every test's assertions come
  strictly after the `acquireRepoLock`/`preflight`/`runCli` call under test. (b) a criterion whose
  assertions don't measure its stated purpose — none found; each scenario's assertion is exactly
  the rejection code (or thrown error / branch-untouched fact) the scenario claims to check.
- Every test that calls `acquireRepoLock` releases the lock in a `finally`, nested inside the
  sandbox's own `finally { s.cleanup() }`, so a failing assertion mid-test cannot leave a held lock
  for a later test to inherit — and even if a `release()` were skipped, `s.cleanup()` deletes the
  whole sandbox root (including `.git/orca-lock`) regardless.
- No stale-lock heuristic was added — the lock's `info` file is written and never read back by any
  code path, as ruling 5/6 require.
- `PreflightReport` is exactly `{ rejections: PlanRejection[] }`, no extra fields (Ruling R3
  honored at the interface level).
- The one deviation from the brief's file list is `src/scheduler/planReport.ts` — not mentioned in
  the brief's "Files" line. It was required to satisfy ruling 3's own explicit criterion (see
  "Unplanned but necessary fix" above); verified it does not change behavior for any existing
  caller (`npm run verify`, 181/181 green, including the untouched Task 5 test that pins the old
  `[not evaluated]` text for its own hand-built input).
- Did not touch `src/ledger/**`, `scripts/githooks/**`, `.decisions/**`, or the
  `validate`/`check-append-only` subcommands.
- `npm run verify` exits 0 with 181/181 tests passing; the seven `downgraded to tier 0` lines are
  the known historical-record noise called out in the task brief.

## Concerns

- The `planReport.ts` touch (adding `opts.runtimeChecksEvaluated`) is additive and
  backward-compatible, but it is a change to a file outside this task's stated "Files" list. I
  judged it necessary and in-scope because ruling 3 is unsatisfiable without it and it was caught
  by an actual RED run, not invented speculatively — flagging it explicitly for review rather than
  treating it as self-evidently fine.
- `preflight.ts`'s `worktreeIsDirty` has no try/catch around `git status --porcelain`; if
  `targetRepo` does not exist or is not a git repo, `preflight()` will throw rather than return a
  rejection. This matches every given scenario (S18/S19/S22 all use a real repo) and is not called
  out as in-scope hardening by the brief, so I left it as is rather than adding untested defensive
  code.

---

## Fix round 1

Two items from review, both addressed. Commit: `d2d9ce0`.

### Finding 1 (Important) — S21's second assertion could never fail

`tests/scheduler/scenarios/S21.test.ts` used to assert
`expect(await refSha(s.targetRepo, "refs/heads/orca/w/x")).toBeNull()` after the second
`acquireRepoLock` rejected. Nothing in the test, or in any code it reaches, ever creates or
touches that ref — the assertion was `null` unconditionally, so it passed regardless of whether
the lock worked, was deleted (`M-LOCK`), or degraded to "return something and continue"
(`M-LOCK-b`). Confirmed by re-reading my own mutation table: both `M-LOCK` and `M-LOCK-b`'s RED
evidence cites only the first assertion (`rejects.toThrow(/already/i)`) failing — the second
assertion is absent from both failure transcripts because it never had a chance to run or fail.

Per the controller's ruling: deleted the assertion (and the now-unused `refSha` import), left a
comment in its place stating that the "never enters W" half of S21 is deferred to Task 10 (which
owns `orca run` and W), and renamed the test's own title to drop the now-untested "and never
enters W" clause so the test's name matches what it actually checks. The first assertion — the one
that catches both `M-LOCK` and `M-LOCK-b` — was not touched. Did not synthesize a substitute
(e.g. creating the ref myself and asserting it unchanged), since that would measure a fixture I
control rather than the lock.

### Finding 2 (rule violation) — Chinese text inside an English code comment

`src/scheduler/preflight.ts:53` quoted the spec's Chinese sentence
`"读 ref 与 porcelain 不算「碰」"` inside an otherwise-English doc comment, violating the
project's G12 (code/comments/CLI help/commit messages are English). Removed the quotation; the
English sentence that already followed it ("spec §9.1(4) says explicitly that reading a ref or
porcelain output does not count as touching the repo") already carries the same information, so
nothing was translated in — nothing was lost.

Confirmed no other CJK characters remain in the touched files:

```
grep -nP '[\x{4e00}-\x{9fff}]' src/scheduler/preflight.ts src/scheduler/repoLock.ts src/cli.ts src/scheduler/planReport.ts
```

→ zero matches.

### Correction to this report's earlier self-review claim

The original self-review section above states: "Every test that calls `acquireRepoLock` releases
the lock in a `finally`... so a failing assertion mid-test cannot leave a held lock." **This
overstates what the code does.** Re-checking `tests/scheduler/repoLock.test.ts`: of its three
tests plus S21, only two of the four `it()` blocks actually wrap `release()` in a `finally`
(`repoLock.test.ts`'s first test, and `S21.test.ts`). The other two (`repoLock.test.ts`'s second
and third tests) call `release()` directly in the test body, with no `finally` around it — if an
assertion between an `acquire` and its `release` were to throw, that particular `release()` call
would be skipped. The claim that a held lock cannot leak into a later test remains true, but for a
different reason than "every test uses finally": every test's outer `try` still has
`finally { await s.cleanup() }`, and `cleanup()` deletes the whole sandbox root — including
`.git/orca-lock` — regardless of whether `release()` ran. That is what actually prevents leakage,
not universal `finally`-wrapping of `release()` itself. The original sentence is left in place
above, uncorrected, per this project's append-only convention for its own record of what was
claimed and when; this note is the correction.

### Re-verification

```
npx vitest run tests/scheduler/scenarios/S21.test.ts tests/scheduler/preflight.test.ts \
  tests/scheduler/scenarios/S18.test.ts tests/scheduler/scenarios/S19.test.ts \
  tests/scheduler/scenarios/S22.test.ts tests/scheduler/scenarios/planWiresPreflight.test.ts \
  tests/scheduler/repoLock.test.ts
```
→ `Test Files 7 passed (7)`, `Tests 10 passed (10)`, exit 0.

```
npm run verify
```
→ `Test Files 22 passed (22)`, `Tests 181 passed (181)`, exit 0 (the seven `downgraded to tier 0`
lines from `.decisions/` are the expected historical-record noise).

### Files touched in this fix round

- `tests/scheduler/scenarios/S21.test.ts` (deleted the untestable assertion + unused `refSha`
  import, added the deferral comment, renamed the test title)
- `src/scheduler/preflight.ts` (removed the Chinese quotation from the doc comment)
- `.superpowers/sdd/2026-09-03-p2-scheduler-c/task-6-report.md` (this section)

No mutation table changes were needed — neither fix altered any check's logic, only a dead
assertion and a comment's language.
