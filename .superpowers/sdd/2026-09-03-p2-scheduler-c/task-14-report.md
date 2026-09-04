# Task 14 report: remaining scenarios (S10/S11/S12/S13/S16) + `--serial`

Commits (both on `main`, no branch/worktree):
- `5ef5dc6` — `feat(scheduler): add --serial and close the remaining scenarios`
- `e10a0f2` — `fix(scheduler): make S16's fixture non-binary so M-BIGDIFF can actually redden it`

Base: `fec384b` (Task 13, review clean).

## What was implemented

1. **`--serial`** (spec §3.5): `src/scheduler/run.ts`'s `RunOptions` gains `serial?: boolean`. Inside `runRound`, one new line —
   `const executionLayers = options.serial ? graph.layers.flat().map((taskId) => [taskId]) : graph.layers;` —
   flattens every layer to size 1, in the graph's own already-deterministic (taskId-sorted) topological order, before the existing per-layer loop (`for (const [layerIndex, layer] of executionLayers.entries())`). Nothing else in the loop changed. This is deliberately a v1 **criterion**, not scheduling policy: it exists so a serial run's result can be checked against a parallel one (per the task brief's explicit instruction). `src/cli.ts` wires `args.includes("--serial")` through and documents the flag in `USAGE`.

2. **S10** (`tests/scheduler/scenarios/S10.test.ts`): two disjoint tasks (`seedDisjointPlan`, already shared by S1/S14) run once in parallel and once with `--serial`. Both must land and pass the union of both sides' `requiredChecks` (measured via a new sandbox helper, `runChecksOnBranch`, against idempotent content assertions — not the `writeFileCheck` commands themselves, which also double as the write mechanism and would trivially re-pass regardless of ordering). Because isolation (every task clones into its own copy) makes disjoint-task landing correctness identical under both orderings, the one **externally observable** difference `--serial` makes is *when* each task's clone was taken: under `--serial`, T2's own attempt tree already contains T1's file (it was cloned after T1 landed); under parallel, it does not (both cloned from the same pre-round layer base). This is exactly what `orcaIncomingRefs`'s own pre-existing doc comment in `sandbox.ts` anticipated ("did T2 start from a base that already had T1's work in it").

3. **S16** (`tests/scheduler/scenarios/S16.test.ts`): a task whose required check writes an 11 MB file, run for real through `runTask` + `harvest`. Asserts `d.empty === false` and `d.actualPaths` contains the file. `harvest.ts`'s `netChangeSet` already used `git diff --name-only` (proportional to path count, not byte size) with a 64 MB buffer — never ccloop's own patch-collection path (10 MB buffer, catches non-exit-1 git failures into `""`) — so no production code changed for this scenario; the task was to prove it.

4. **S11 / S12 / S13** (`tests/scheduler/scenarios/S11.test.ts`, `S12.test.ts`, `S13.test.ts`): each of spec §2.3's six up-front rejection codes (`work-branch-is-default`, `unsupported-policy`, `relative-path`, `duplicate-task-id`, `cycle`, `contract-inside-target-repo`), driven through the real CLI (`runCli(["run", planPath])`, no `--adapter-config` needed since `loadRound`'s rejection gate runs before that flag is even checked), asserting exit 1 **and** the target repo provably untouched (`allRefShas`/`porcelain` identical before/after — S17's own idiom). New sandbox helper `seedRejectablePlan` gives each test a known-good plan to vary one field off of. No production code changed — Task 2 (`loadPlan`) and Task 4 (`detectCycle`) already implement all six.

5. **Deferred property** (ruling 2 in the coordinator's brief): `tests/scheduler/scenarios/S8.test.ts` gains a new `it` proving "a task whose upstream failed gets no run directory at all," now that `runRound` is a real orchestrator. `S9.test.ts`'s identical deferral comment (unchanged in substance, just repointed) now cites this test, since both deferrals share the exact same mechanism (`notRun` set / `route.upstreamNotRun` propagation in `run.ts`).

## TDD evidence

### S10 — genuine pre-implementation RED

Before writing `--serial`'s implementation, I stashed `src/scheduler/run.ts` and `src/cli.ts` back to their Task-13 state (`git stash push -- src/scheduler/run.ts src/cli.ts`) and ran the already-written `S10.test.ts` against that:

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S10.test.ts
 ✓ ... parallel: T1 and T2 both land ... 1072ms
 × ... S10: --serial also lands both ... 1057ms
   → expected false to be true // Object.is equality
   ❯ tests/scheduler/scenarios/S10.test.ts:59:58
      expect(await t2StartedAfterT1Landed(s.targetRepo)).toBe(true);
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

Expected: `--serial` was silently ignored (it starts with `--`, so cli.ts's own positional-argument filter simply drops it, no error), the run stayed fully parallel, and the "serial signature" assertion — the one this feature is actually about — reddened cleanly, at its own line, with the parallel-control test still green. Not a crash. Restored via `git stash pop`.

### S16 / S11 / S12 / S13 / deferred property — an honest note on what "RED first" means here

These five scenarios exercise **pre-existing** production code (Task 2's `loadPlan`, Task 4's `detectCycle`, Task 9's `harvest.ts`, and Task 8–13's `notRun`/`route.upstreamNotRun` orchestration). Running them for the first time against the already-implemented codebase produced immediate GREEN — there was no implementation gap for them to be red about, and I am not going to pretend otherwise. What each of them needed instead — per Rule 9's actual requirement, "can this assertion fail" — is a **mutation** that reddens it, which is recorded below. This is the same shape the coordinator's ruling 2 describes for the deferred property itself: "implement it now" meant write the assertion against an orchestrator that already exists, not invent new production code.

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S10.test.ts tests/scheduler/scenarios/S16.test.ts tests/scheduler/scenarios/S11.test.ts tests/scheduler/scenarios/S12.test.ts tests/scheduler/scenarios/S13.test.ts tests/scheduler/scenarios/S8.test.ts tests/scheduler/scenarios/S9.test.ts
 Test Files  7 passed (7)
      Tests  12 passed (12)
```

### GREEN — full scheduler suite and full verify, real implementation in place

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler --reporter=dot
 Test Files  42 passed (42)
      Tests  141 passed (141)
```
(was 37 files / 131 tests at Task 13's close — +5 files, +10 tests: S10, S11, S12, S13, S16 new, plus S8's extra `it`.)

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npm run verify
...
Test Files  49 passed (49)     # full `npm test`
...
Test Files  42 passed (42)     # verify:scheduler
      Tests  141 passed (141)
RC=0
```

## The deferred property: implementation and proof

**What it is** (ruling 2): S8/S9 once asserted a task whose upstream failed/blocked gets no run directory, but those assertions lived in a context with no orchestrator to decide what runs, so they could never fail. Task 8's fix round 1 deleted them with a comment deferring the property to this task.

**How it's implemented**: no new production code — `src/scheduler/run.ts`'s existing `notRun` set (populated from `route.upstreamNotRun`, line 688 in the pre-mutation source) already filters `runnable` before any task in a later layer is even allocated a run id, let alone cloned. The task here was making the property measurable and proving it's real.

**How it's proved real**: `S8.test.ts`'s new `it` builds a 3-task plan (T1 fails; T2 depends on T1 and would itself fail — `exhausted` — if it ever ran; T3 is independent and succeeds), runs it through `runCli(["run", ...])`, and asserts `taskWorkdirs(s)` contains **no** directory for T2. Two controls make "absent" mean the right thing: T1's own (failed, kept) directory **is** present, and T3's (succeeded, disposed) directory is **not** — so the test can distinguish "never created" from "created and cleaned up," which a bare absence check cannot.

**Mutation `M-NOTRUN`** — deletes the line that propagates `route.upstreamNotRun` into the `notRun` set:
```diff
-        for (const descendant of route.upstreamNotRun) notRun.add(descendant);
+        // M-NOTRUN: descendants of a failed/blocked task are never marked not-run
```
Run: `ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S8.test.ts` (in a `git clone --local` copy).

Real failing output:
```
orca: T1: ccloop reported failed (run orca-T1-23b8b85a)
orca: kept the work copy for orca-T1-23b8b85a (outcome failed): .../runs/orca-T1-23b8b85a
orca: T3: ccloop reported succeeded (run orca-T3-b6f35c32)
orca: T2: ccloop reported exhausted (run orca-T2-8d74be92)
orca: kept the work copy for orca-T2-8d74be92 (outcome exhausted): .../runs/orca-T2-8d74be92
 × S8 (deferred property, Task 14): a task whose upstream failed gets no run directory at all
   → expected true to be false // Object.is equality
   ❯ tests/scheduler/scenarios/S8.test.ts:128:52
      expect(dirs.some((d) => d.includes("-T2-"))).toBe(false);
 Tests  1 failed | 1 passed (2)
```
T2 genuinely ran under the mutation ("ccloop reported exhausted"), producing a real, kept run directory, reddening exactly the deferred-property assertion — with the T1/T3 controls above it still green, and the earlier `it` in the same file (S8's original scenario) also still green. Not a crash.

## Mutation table

All four mutations run inside one `git clone --local` copy of commit `5ef5dc6` (`node_modules` symlinked from the main tree, removed with `/bin/rm -f` before the copy itself was removed with `/bin/rm -rf`). Each was reverted with `cat <pristine> > <mutated file>` and diffed byte-for-byte identical before the next mutation was applied — never compounded.

| Mutation | Feeds | Literal patch | Command | Real failing output |
|---|---|---|---|---|
| **`M-SERIAL`** (brief-named) | S10 | `src/scheduler/run.ts`:<br>`-const executionLayers = options.serial ? graph.layers.flat().map((taskId) => [taskId]) : graph.layers;`<br>`+const executionLayers = graph.layers; // M-SERIAL: --serial ignored, still parallel` | `npx vitest run tests/scheduler/scenarios/S10.test.ts` | `expected false to be true` on the `--serial` test's `t2StartedAfterT1Landed` assertion; the parallel-control test stayed green |
| **`M-BIGDIFF`** | S16 | `src/scheduler/harvest.ts`, `netChangeSet` body replaced:<br>`-  const { stdout } = await execFileAsync("git", ["diff", "--no-renames", "--name-only", "-z", base, attemptSha], { cwd: clone, maxBuffer: 64 * 1024 * 1024 });`<br>`-  return stdout.split("\0").filter((p) => p.length > 0).sort();`<br>`+  let stdout: string;`<br>`+  try {`<br>`+    ({ stdout } = await execFileAsync("git", ["diff", "--no-renames", base, attemptSha], { cwd: clone, maxBuffer: 10 * 1024 * 1024 }));`<br>`+  } catch (err) {`<br>`+    if ((err as { code?: number }).code === 1) throw err;`<br>`+    return [];`<br>`+  }`<br>`+  return [...stdout.matchAll(/^diff --git a\/(.+) b\//gm)].map((m) => m[1]).sort();` | `npx vitest run tests/scheduler/scenarios/S16.test.ts` | `expected true to be false` on `expect(d.empty).toBe(false)` — the exact "silent success" spec §4.4 describes |
| **`M-NOTRUN`** | S8 (deferred property) | `src/scheduler/run.ts`:<br>`-        for (const descendant of route.upstreamNotRun) notRun.add(descendant);`<br>`+        // M-NOTRUN: descendants of a failed/blocked task are never marked not-run` | `npx vitest run tests/scheduler/scenarios/S8.test.ts` | see the deferred-property section above — `expected true to be false` on the T2-directory assertion, T1/T3 controls green |
| **`M-REJECT`** (representative for S11/S12/S13's "target repo untouched" gate) | S12's own fixture, via an ad-hoc probe supplying a real `--adapter-config` (S12.test.ts itself never needs one — see below) | `src/scheduler/planFile.ts`:<br>`-  if (data.policy !== "local-merge") {`<br>`+  // M-REJECT: the unsupported-policy check itself deleted.`<br>`+  if (false) {` | one-off `.mts` script (deleted after use) importing `sandbox.ts` directly, `npx tsx scripts_m_reject_probe.mts`, in the same clone | `rc: 3`, `refsUnchanged: false` — `refs/heads/orca/w/x` newly created in the target repo (the round proceeded past `checkoutWorkBranch`, then failed later on the placeholder ccloop path); the shipped `S12.test.ts` itself passed green under this mutation, for a reason explained below |

### Why `M-REJECT` needed a probe instead of the shipped `S12.test.ts`

Running the committed `S12.test.ts` directly against `M-REJECT` passed **green** — not because the mutation is unobserved, but because `S12.test.ts` never passes `--adapter-config` (it doesn't need to for the real code: `loadRound`'s rejection returns 1 before that flag is ever checked). Under the mutation, the plan no longer gets rejected there, so control falls through to the very next, *unrelated* guard — `if (options.adapterConfig === undefined) return 1` — which also returns 1 and coincidentally reproduces the expected result. This is exactly the kind of accidental-green Rule 9 exists to catch, and I am recording it rather than hiding it: **the shipped `S12.test.ts` is correct against real code, but is not itself the assertion that proves this specific mutation dead** without also supplying an adapter-config. The one-off probe (same fixture, `--adapter-config /dev/null`, deleted after use, no production or test files touched) supplies that and gets a clean, non-accidental red. I judged writing a permanent second S12 test purely to route around this one confound not worth the added surface, given the probe already demonstrates the mechanism (`checkoutWorkBranch` genuinely runs and creates a new ref) and the six rejection codes all share the identical `loadRound`/`runRound` gate — this is not a per-code claim, it is a claim about the shared checkpoint.

### Restoration proof

```
$ shasum -a 256 src/scheduler/run.ts src/scheduler/harvest.ts src/scheduler/planFile.ts   # in the clone, after all four mutations reverted
f729f45c634ba04b1bb9635d9db216752f7bc58f43dc2439840a6f817abb7ec0  src/scheduler/run.ts
323884f718a463efe65ccb2465883e40b31c307fc8f186d9745acb3fcb079425  src/scheduler/harvest.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  src/scheduler/planFile.ts

$ shasum -a 256 (same three files, main worktree, before mutation testing started)
f729f45c634ba04b1bb9635d9db216752f7bc58f43dc2439840a6f817abb7ec0  src/scheduler/run.ts
323884f718a463efe65ccb2465883e40b31c307fc8f186d9745acb3fcb079425  src/scheduler/harvest.ts
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  src/scheduler/planFile.ts
```
Identical, byte for byte, before mutation testing started and after it finished. The full scheduler suite was re-run inside the (fully restored) clone afterward as a second confirmation: `42 files / 141 tests, exit 0`. `git status --short`, `git diff --stat`, and `git diff --cached --stat` on the Orca main tree were empty throughout mutation testing (the only post-mutation change to the main tree — `tests/scheduler/scenarios/S16.test.ts`'s fixture fix — is a real, committed change, not mutation residue; see commit `e10a0f2`). The clone (`.../scratchpad/orca-mutate`) was deleted after use: `node_modules` symlink removed with `/bin/rm -f`, then the clone itself with `/bin/rm -rf`.

## ccloop-untouched confirmation

```
$ git -C /Users/biran/code/skills/loop/ccloop status --short
(empty)
$ git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```
Matches the required HEAD exactly; no changes at any point in this task.

## Measured durations

- `npm run verify` (typecheck + full `npm test` + ledger validate + CLAUDE.md/hooks checks + `verify:scheduler`): **real 22.48s** (`/usr/bin/time -p`), exit 0.
- Full `npm test`: 49 files, all green (vitest's own wall-clock report: ~9.9s).
- `verify:scheduler` (`tests/scheduler/**`): 42 files / 141 tests, exit 0 (vitest's own wall-clock report: ~9.7s; up from Task 13's 37 files / 131 tests / 9.07s).
- Individual new scenarios: S10 ~1.4–2.7s per `it` (two real ccloop spawns + a throwaway worktree each); S16 ~0.6–0.8s (one real spawn writing an 11 MB file); S11/S12/S13 ~0.3s each (no ccloop spawn — rejected before any spawn); S8's new `it` ~0.8–1.9s (two real spawns).
- Nothing here is slow enough to matter for pre-commit; the suite's growth (131→141 tests) added well under a second of wall time.

## Files changed

- `src/scheduler/run.ts` — `RunOptions.serial`, `executionLayers`.
- `src/cli.ts` — `--serial` flag wiring and `USAGE` text.
- `tests/scheduler/sandbox.ts` — `runChecksOnBranch`, `seedRejectablePlan`.
- `tests/scheduler/scenarios/S10.test.ts` (new)
- `tests/scheduler/scenarios/S11.test.ts` (new)
- `tests/scheduler/scenarios/S12.test.ts` (new)
- `tests/scheduler/scenarios/S13.test.ts` (new)
- `tests/scheduler/scenarios/S16.test.ts` (new, then fixed for M-BIGDIFF's real red)
- `tests/scheduler/scenarios/S8.test.ts` — deferred-property `it` added, comment updated.
- `tests/scheduler/scenarios/S9.test.ts` — comment updated to point at S8's proof (Rule 13: history not edited, just repointed).

## Self-review — named mutation per new assertion

- **S10**'s two "lands + passes union checks" assertions: not independently mutation-tested (they measure the pre-existing landing pipeline, already covered by S1/S8/S9/etc.'s own mutations); the assertion that is genuinely new to this task — `t2StartedAfterT1Landed` under `--serial` — is covered by `M-SERIAL`, shown above.
- **S16**'s three assertions (`empty`, `actualPaths.length`, `actualPaths` contains the file): `M-BIGDIFF` reddens the first two directly; the third (`toContain`) would also redden under `M-BIGDIFF` if `actualPaths` were merely truncated rather than emptied — not separately proved, since the shipped mutation empties the whole list rather than truncating it. I did not invent a second mutation just to isolate that one sub-case.
- **S11/S12/S13**'s two assertions each (exit 1, repo untouched): `M-REJECT` reddens both, for the representative case (unsupported-policy), via the probe described above. I did **not** run a separate mutation for each of the other five codes — they share the identical `loadRound`/`runRound` gate that `M-REJECT` bypasses, and Task 2 already ran per-code mutations proving each detector fires (this task's new contribution is the "and the repo stays untouched" half, which is a property of the shared gate, not of any one detector).
- **Deferred property**'s three assertions (T1 present, T3 absent, T2 absent): `M-NOTRUN` reddens the T2 assertion directly, shown above. The T1/T3 controls are not separately mutation-tested — they exist to make the T2 assertion's absence meaningful, not as independent claims about the system; if they were false the test would be measuring the wrong thing regardless of `notRun`, which is a fixture-quality question I addressed by construction (giving T1 a guaranteed-fail contract and T3 a guaranteed-succeed one) rather than by a fifth mutation.

## Concerns

- None that block completion. Two things worth flagging explicitly per Rule 12 rather than leaving implicit:
  1. `M-REJECT`'s evidence for S11/S12/S13 is a representative, one-code probe plus a stated argument about the shared gate, not six independent mutation runs. I judged this the right cost/coverage trade given the shared mechanism, but a reviewer who wants per-code mutation evidence for all six will not find it here.
  2. S16's fixture went through one iteration (`dd`/`/dev/zero` → `yes`/text) because the first version's all-zero content triggered git's own binary-file detection, making the full-diff mutation's output tiny regardless of the file's real size — a mutation that would have passed green by accident. This is recorded as its own commit (`e10a0f2`) rather than folded silently into the first, per Rule 14's evidence discipline.

⚠️ **Correction (fix round 1, see below):** concern 1 above understates what was actually wrong. The gap was not "one code probed, five unproved" — the shipped S11/S12/S13 scenarios could not fail for **any** of the six codes, because none of them passed `--adapter-config`, and the `M-REJECT` probe script no longer exists (it was a one-off `.mts` file, deleted after use), so no mutation evidence for this gate survived in the repository at all. Left as originally written above, per this repository's append-only convention for reports (Rule 13) — the correction is this paragraph, not an edit to the original text.

---

## Fix round 1

Commit: `edd6e49` (`fix(scheduler): make S11/S12/S13 falsifiable for all six rejection codes`), on top of `e10a0f2`.

### The finding (Important), and why it is broader than my own disclosure

The coordinator's review traced the S11/S12/S13 scenarios structurally rather than trusting my "one code probed" framing, and found the real situation: **none of the six could ever fail.** All six called `runCli(["run", planPath])` with **no** `--adapter-config`. In `runRound`, `loadRound` (where all six rejections live) runs first; the very next check, `if (options.adapterConfig === undefined) return 1`, sits immediately after it; and `checkoutWorkBranch` — the first line that can touch the target repository — is downstream of *both*. So deleting any one of the six rejection checks outright would still fall through to the adapter-config guard and produce exit 1 with the repo untouched: the identical observable result the tests asserted, check deleted or not. And because the probe script I used to demonstrate `M-REJECT` was a one-off file deleted after use, there was, in the end, no mutation evidence anywhere in the committed repository for this gate.

### The fix

Two changes, applied to all six cases across `S11.test.ts`, `S12.test.ts`, and `S13.test.ts`:

1. **A real `--adapter-config`** in every case (each test writes its own throwaway scripted-adapter config via the existing `writeScriptedConfig` sandbox helper), so a broken rejection check would actually let control reach `checkoutWorkBranch` and mutate the target repository — that is what makes "untouched" a claim with teeth.
2. **An assertion on the specific rejection code**, read from the CLI's own stderr via the existing `captureStreams` sandbox helper (e.g. `expect(stderr).toContain("rejected: work-branch-is-default:")`), not just the exit code. Six different checks all exit 1; a test that only pins the exit code cannot tell its own check from any of the other five.

### Re-run against real code (GREEN)

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S11.test.ts tests/scheduler/scenarios/S12.test.ts tests/scheduler/scenarios/S13.test.ts
 Test Files  3 passed (3)
      Tests  6 passed (6)
```

Full scheduler suite and full verify, unchanged in shape from before this fix:

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler --reporter=dot
 Test Files  42 passed (42)
      Tests  141 passed (141)

$ /usr/bin/time -p env ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npm run verify
...
 Test Files  49 passed (49)   # npm test
...
 Test Files  42 passed (42)   # verify:scheduler
      Tests  141 passed (141)
real 22.90
RC=0
```

### The mutation: one deletion, six scenarios, one reddens

Per the coordinator's ruling, this does **not** owe six independent end-to-end mutations. Each of the six checks already has its own named unit-level mutation from the task that built the plan loader (Task 2's `M-P2-REL`, `M-P2-DUP`, `M-P2-CYC`, `M-P2-IN`, `M-P2-WB`, `M-P2-POL`), all seen red there, against `loadPlan` directly. What this fix round's scenarios add on top is the **end-to-end** claim — that a deleted check really would let `checkoutWorkBranch` run — and **one discriminating mutation** establishes that the end-to-end path is real: delete one check, run all six scenarios together, and confirm its own case reddens while the other five stay green. The staying-green half is what proves the six assertions actually discriminate between codes, rather than all passing or all failing together for some unrelated reason.

**Mutation `M-S12-POL`** (chosen over deleting `duplicate-task-id` or `cycle` — see the dead end below) — `src/scheduler/planFile.ts`:
```diff
-  if (data.policy !== "local-merge") {
+  // M-S12-POL: the unsupported-policy check itself deleted.
+  if (false) {
     rejections.push({ code: "unsupported-policy", message: `unsupported policy: ${JSON.stringify(data.policy)}` });
   }
```

Command (in a fresh `git clone --local` copy of `edd6e49`): `ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run tests/scheduler/scenarios/S11.test.ts tests/scheduler/scenarios/S12.test.ts tests/scheduler/scenarios/S13.test.ts`

Real output — S12 reddens, on its own assertion, with a controlled (not crashed) exit code; S11 and all four S13 cases stay green:
```
 ✓ tests/scheduler/scenarios/S11.test.ts (1 test) 233ms
 ❯ tests/scheduler/scenarios/S12.test.ts (1 test | 1 failed) 320ms
   × S12 ... rejected as unsupported-policy at exit 1 ...
     → expected 3 to be 1 // Object.is equality
 ✓ tests/scheduler/scenarios/S13.test.ts (4 tests) 745ms
AssertionError: expected 3 to be 1
 ❯ tests/scheduler/scenarios/S12.test.ts:22:18
      expect(rc).toBe(1);
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 5 passed (6)
```

Why `rc` is `3` and not some crash: `loadPlan`'s return statement unconditionally sets `policy: "local-merge"` on the plan it hands back (`return { plan: { ...data, policy: "local-merge" } }`) — so once the check is deleted, a `"rebase"` plan is silently normalized to `local-merge` and treated as an ordinary, valid single-task round. `checkoutWorkBranch` runs and creates `refs/heads/orca/w/x` in the target repo; the round then tries to spawn ccloop against `seedRejectablePlan`'s placeholder `ccloopBin` (`unused-ccloop-cli.js`, which does not exist), which fails inside the per-task `Promise.all` — **inside** `runRound`'s `try` block, so it is caught by the existing `catch (err)` handler (escalation file written, `return 3`), not an uncaught exception escaping the test. Both intended assertions are already false by the time this happens: `rc` is `3` (not `1`), and the target repo was already touched by `checkoutWorkBranch` before the spawn ever failed.

### A dead end worth recording (Rule 12): the first two mutations tried both crashed, not reddened

Before landing on `M-S12-POL`, I tried the same pattern against `duplicate-task-id` (deleting the check in the S13 "duplicate taskId" fixture, which uses two plan-file entries sharing `taskId: "T1"`). It did not redden the intended assertion — it threw, inside `loadRound`, before the test's `await captureStreams(...)` call even returned:
```
Error: buildGraph: no schedulable task among T1 — a cycle slipped through
 ❯ Module.buildGraph src/scheduler/graph.ts:170:13
 ❯ loadRound src/scheduler/run.ts:131:34
```
Root cause, traced rather than guessed: with two plan-file tasks sharing one `taskId`, every `Map`/`Set` keyed by `taskId` downstream (`writeSets`, `contracts`, `remaining`, `inDegree`) collapses the pair to one entry. `buildImplicitEdges` then compares that one task's write set **against itself** (`a === b === "T1"`), and `intersect(X, X)` is non-empty whenever `X` is (a task's own declared paths trivially "conflict" with themselves), so it manufactures a real self-loop edge `T1 -> T1`. Kahn's algorithm can never give a self-looped node zero in-degree, so `buildGraph` throws — a structural consequence of the duplicate id itself, independent of whether the `duplicate-task-id` *check* ran, and it fires before `runRound`'s `try` block even starts. The same reasoning rules out reusing `cycle`'s deletion too: a genuine two-task mutual dependency is, definitionally, the same "no schedulable task" throw. Per this plan's own recorded lesson ("a mutation that reddens by crashing before its assertion runs is not evidence about that assertion"), I did not count either as evidence and moved to `unsupported-policy`, which — per `loadPlan`'s own return statement forcibly normalizing the policy field — cannot itself produce a structural graph problem, and reddened cleanly as shown above.

### Restoration proof

```
$ shasum -a 256 src/scheduler/planFile.ts   # in the clone, mutation reverted
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  src/scheduler/planFile.ts

$ shasum -a 256 src/scheduler/planFile.ts   # main worktree
efb4f105c7b0edc313d87b9fe0839f99cc4d985b37125791d8a4dd91905ae3ce  src/scheduler/planFile.ts
```
Identical. The full scheduler suite was re-run inside the clone after restoration as a second confirmation: `42 files / 141 tests, exit 0`. `git status --short`, `git diff --stat`, and `git diff --cached --stat` on the Orca main tree were empty throughout mutation testing. The clone (`.../scratchpad/orca-mutate2`) was deleted afterward: `node_modules` symlink removed with `/bin/rm -f`, then the clone itself with `/bin/rm -rf`.

### ccloop-untouched confirmation

```
$ git -C /Users/biran/code/skills/loop/ccloop status --short
(empty)
$ git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```

### Deferred — not touched (per the coordinator's instruction)

The six S11/S12/S13 cases still duplicate the same capture-assert-compare shape and would read better behind a small shared helper. Left alone: a refactor of six tests while their criteria are being made falsifiable is the wrong order of operations, and this is recorded for the final whole-branch review, not fixed here.

### Files changed (this fix round)

- `tests/scheduler/scenarios/S11.test.ts`
- `tests/scheduler/scenarios/S12.test.ts`
- `tests/scheduler/scenarios/S13.test.ts`
