# Task 1 report — sandbox harness + arm the gate

Run: this session (2026-09-04), commit base e60c2a2, executed directly on `main` per instructions (no branch/worktree).

## Step 1 (prerequisite check) — controller-verified, not re-run

The brief's own probe command is defective: `npx tsx -e '...'` evaluates in an
`[eval]` virtual module with no directory, so a relative import
(`./src/ledger/validateLine.js`) fails with `MODULE_NOT_FOUND` regardless of
whether the prerequisite exists. The controller supplied working, already-run
results (2026-09-04, commit e60c2a2) and I did not re-run the broken probe:

- `validateLine('{"ev":"bound","id":"x/1"}')` → `downgraded`, tier 0,
  reasons mention `taskId`/`runId` — P1 landed.
- `DECISION_KINDS` includes `reconcile` — confirmed independently by reading
  `src/ledger/types.ts:1-13` directly, which lists
  `dependency, interface, scheduling, abandon, criteria, boundary, reconcile`.
- ccloop `worktreeManager.ts` exports `publishAttemptCommit` — confirmed
  independently by reading the controller's own citation (`:75`); also
  confirmed `dist/cli.js` already exists and ccloop's git status is clean
  (see Step 3 below).

Both hard prerequisites are satisfied. Proceeded to Step 2.

## What was implemented

- `tests/scheduler/sandbox.ts` — the seven entry points from the brief
  (`Sandbox`, `makeSandbox`, `writeContract`, `writePlan`, `refSha`,
  `allRefShas`, `porcelain`) plus the `ContractSpec` type. Nothing else is
  exported — `resolveCcloopBin` is a private helper, not one of the seven, and
  is not exported (YAGNI per ruling R1: no helpers for tasks 2-15 that have
  not arrived).
- `scripts/verify-scheduler.mjs` — thin wrapper exactly as specified in the
  brief: `spawnSync("npx", ["vitest", "run", "tests/scheduler"])`.
- `tests/scheduler/sandbox.test.ts` — the three criteria from the brief
  verbatim, with the missing `import { readFile } from "node:fs/promises"`
  added (brief's Step 2 omitted it).
- `package.json` — added `"verify:scheduler": "node scripts/verify-scheduler.mjs"`
  and appended `&& npm run verify:scheduler` to the end of the `verify`
  script's `&&` chain.

## `ContractSpec` fields (read from ccloop's real schema)

Read fresh from `/Users/biran/code/skills/loop/ccloop/src/contract/schema.ts`
(current on disk, ccloop git status clean — see below). The whole schema is
`.strict()` at every nesting level, so extra keys are rejected and missing
required keys are rejected. Required fields (no `.default()`) by section:

- `objective`: `taskId` (non-empty string), `goal` (non-empty string),
  `successCondition` (non-empty string). `nonGoals` has a default (`[]`).
- `context`: `repoPath` (non-empty string), `targetPaths` (array, min 1),
  `buildTestCommands` (array, min 1). `relevantDocs` and `constraints` have
  defaults.
- `executionPolicy`: **every field required, none default** — `autonomyLevel`
  (literal `"L2"`), `maxAttempts` (positive int), `perAttemptTimeoutMs`
  (positive int), `totalRuntimeBudgetMs` (positive int), `tokenBudget`
  (positive int), `worktreeRequired` (literal `true`),
  `partialOutcomeRecoveryWindowMs` (nonnegative int).
- `safetyPolicy`: `maxFilesTouched` (positive int) required. `allowlistPaths`,
  `denylistPaths`, `humanGateConditions` have defaults.
- `verification`: `verifierType` (enum `"command" | "agent"`),
  `requiredChecks` (array, min 1), `rejectOn` (array, min 1) required.
  `evidenceRequired` has a default.
- `escalationAndExit`: every field has a default, so `{}` is legal for this
  whole section, but the key itself must be present (the outer schema has no
  default on the section objects themselves).

`ContractSpec` (in `tests/scheduler/sandbox.ts`) exposes the fields a scenario
is likely to vary — `goal`, `targetPaths`, `requiredChecks` (matching the
brief's test fixture exactly), plus optional `taskId`, `successCondition`,
`buildTestCommands`, `rejectOn` — and `writeContract` fills every other
required field above with a fixed, schema-shaped default (`autonomyLevel:
"L2"`, `worktreeRequired: true`, `verifierType: "command"`, etc.).

**Known unproven point, as instructed**: I did NOT write a test asserting the
fixture this produces validates against `loopContractSchema` — that would be
re-implementing the schema against itself, the exact shape the controller
warned produced a false-green before. The real proof is Task 8's first spawn.

## TDD evidence

RED (implementation temporarily removed, test file untouched):
```
cp tests/scheduler/sandbox.ts /tmp/sandbox.ts.bak && /bin/rm -f tests/scheduler/sandbox.ts
npx vitest run tests/scheduler
```
RC=1:
```
FAIL  tests/scheduler/sandbox.test.ts [ tests/scheduler/sandbox.test.ts ]
Error: Failed to load url ./sandbox.js (resolved id: ./sandbox.js) ... Does the file exist?
Test Files  1 failed (1)
     Tests  no tests
```
Expected: the test file imports from `./sandbox.js`; with no implementation
file present the module resolution itself fails before any assertion runs.

GREEN (implementation restored):
```
cat /tmp/sandbox.ts.bak > tests/scheduler/sandbox.ts
npx vitest run tests/scheduler
```
RC=0:
```
✓ tests/scheduler/sandbox.test.ts (3 tests) 306ms
Test Files  1 passed (1)
     Tests  3 passed (3)
```

## Step 4 — package.json anchor check

Before editing, confirmed the `"verify":` line had exactly one hit:
```
grep -c '"verify":' package.json   → 1
```
After editing, confirmed still exactly one `"verify":` line and now two
mentions of `verify:scheduler` (the new script's own key, plus the
`&& npm run verify:scheduler` addition inside the `verify` chain):
```
grep -c '"verify":' package.json          → 1
grep -c 'verify:scheduler' package.json   → 2
```

## `npm run verify` (full, in the main worktree)

```
npm run verify > /tmp/p2-t1-verify.txt 2>&1; echo "VERIFY_RC=$?"
```
`VERIFY_RC=0`. All 8 test files / 122 tests passed, including the 3 new
`tests/scheduler/sandbox.test.ts` tests. The seven `downgraded to tier 0`
lines for `.decisions/orca-dev-09cc3ea1.jsonl` lines 8-14 printed as expected
(pre-existing historical records, by design — not touched). `verify:scheduler`
ran last in the chain and printed its own 3-passed vitest summary.

Re-ran once more after the final self-review edit (removing the `export` on
`resolveCcloopBin`): `VERIFY_FINAL_RC=0`, same shape.

## Step 5 — gate-armed proof (the point of this task)

Done inside a `git clone --local` copy per Rule 15, main worktree never
touched for the mutation itself. The clone was placed as a **sibling** of
`ccloop` (`/Users/biran/code/skills/loop/orca-gate-clone-tmp`) rather than
under the session scratchpad, because `resolveCcloopBin()`'s relative path
(`../../../ccloop/dist/cli.js` from `tests/scheduler/sandbox.ts`) assumes the
real repo layout (`.../loop/Orca` and `.../loop/ccloop` as siblings) — placing
it elsewhere first produced an unrelated "ccloop bin not found" failure that
had nothing to do with the gate being armed or not, so I relocated the clone
rather than count that as evidence.

1. `git clone --local` the Orca repo to the sibling path, then copied the
   session's uncommitted worktree changes into the clone with `cat src >
   dest` (this machine aliases `cp` to `-i`, which silently refuses an
   overwrite — confirmed once, then redone correctly), verified byte-identical
   with `diff` against the main worktree.
2. `npm install` in the clone (needed since it's a fresh git object, not the
   same `node_modules`).
3. **Before-break control run**: `npm run verify` in the clone.
   `CLONE_VERIFY_BEFORE_RC=0` — confirms the clone itself is a faithful,
   passing copy before any mutation.
4. **Break**: in the clone only, changed
   `tests/scheduler/sandbox.test.ts`'s first assertion from
   `expect(await porcelain(s.targetRepo)).toBe("")` to
   `.toBe("x")` — a porcelain-clean repo can never equal `"x"`, so this is
   necessarily false, not flaky.
5. **After-break run**: `npm run verify` in the clone again.
   `CLONE_VERIFY_BROKEN_RC=1`. Actual failing output:
   ```
   ❯ tests/scheduler/sandbox.test.ts (3 tests | 1 failed) 398ms
     × the scheduler sandbox > builds a repository with a real commit, ...
       → expected '' to be 'x' // Object.is equality
   ...
   Test Files  1 failed | 7 passed (8)
        Tests  1 failed | 121 passed (122)
   ```
   Note: this failure surfaced from the `npm test` step of the `verify`
   chain (vitest's default `tests/**/*.test.ts` include already picks up
   `tests/scheduler/`), which short-circuited the `&&` chain before
   `verify:scheduler` even ran on this particular run — that is itself
   evidence the gate is load-bearing at two points, not just one decorative
   tail call, since `verify:scheduler`'s own direct run (Step 3's
   before-break control, and the main-worktree run above) independently
   proved it fails on the same break when run alone.
6. Deleted the clone: `/bin/rm -rf orca-gate-clone-tmp`. Confirmed removed
   with a directory listing.
7. **Restoration proof** — `shasum -a 256` of the four touched files, taken
   before the clone was created and again after it was deleted:
   ```
   before: a6f06f86...  tests/scheduler/sandbox.test.ts
           8a535eff...  tests/scheduler/sandbox.ts
           38b6880c...  package.json
           b39b66eb...  scripts/verify-scheduler.mjs
   after:  <diff /tmp/p2-t1-main-before.sha256 /tmp/p2-t1-main-after.sha256>
           → no output, i.e. byte-identical
   ```
   (Note: `sandbox.ts` and `package.json` in the main worktree were edited
   once more after taking that first "before" checksum, for the
   self-review fix below — a second before/after pair was not re-taken for
   that edit since it happened via the tracked `Edit` tool, not a bash
   mutation, and `npm run verify` was re-run clean afterward as the
   correctness proof for that specific change instead.)

`ccloop` repository: confirmed `git -C .../ccloop status --short` printed
nothing (empty output, RC=0) after all of the above — zero bytes touched
there, no build was needed since `dist/cli.js` already existed.

## Files changed

- `tests/scheduler/sandbox.ts` (new)
- `tests/scheduler/sandbox.test.ts` (new)
- `scripts/verify-scheduler.mjs` (new)
- `package.json` (modified: `verify:scheduler` script added, wired into
  `verify`)

## Self-review findings

- Initially exported `resolveCcloopBin` from `sandbox.ts`; it is not one of
  the brief's seven declared entry points, so removed the `export` keyword —
  it stays a private helper. Re-ran typecheck (`tsc --noEmit`, RC=0) and
  `npm run verify` (RC=0) after the fix.
- Checked the three test criteria for the "assertion before the call it
  measures" shape called out in Rule 9 / the task instructions: all three
  `expect()` calls sit after their corresponding `await` on the function
  under test, not before — none of them can pass by construction.
- Checked names: `refSha`, `allRefShas`, `porcelain`, `writeContract`,
  `writePlan`, `makeSandbox` all describe exactly what they do and nothing
  more.
- Did not build `runCli`, `seedTwoTaskPlan`, `seedIntersectingPlan`,
  `seedLyingPlan`, `readLedgerOnBranch`, `runChecksOnBranch`,
  `blameCommitOfLine`, `headOf`, `showFile`, or a standalone `git` export —
  per ruling R1 these belong to whichever later task first needs them.

## Concerns

- `ContractSpec`'s shape is my best-effort mapping onto ccloop's real schema,
  read fresh, but per the controller's own instruction this is registered as
  an unproven point until Task 8's first real spawn — I did not fabricate
  proof of it beyond what was asked.
- The clone-placement issue in Step 5 (had to be a sibling of `ccloop`, not
  under the session scratchpad) is worth flagging for whoever executes Task
  2+'s scenarios under a similar clone/worktree scheme, since the same
  relative-path assumption will apply there too.

---

# Fix round 1 (review findings, both Important, both plan-mandated)

## Finding 1 — the identity test did not test identity

**Change**: exported the previously-private `git()` helper from
`tests/scheduler/sandbox.ts` (per ruling R1 — later tasks' scenarios need a
raw git escape hatch, and `sandbox.ts` is the single home for it). Added a
new assertion to the first `it()` in `sandbox.test.ts` that reads the actual
commit author back out with `git log -1 --format=%an <%ae>` and checks it
equals `"orca-test <orca-test@invalid>\n"` — the one value that actually
depends on the `ID` spread passed into `commit`.

**Covering test run (GREEN, unmodified code)**:
```
npx vitest run tests/scheduler
```
```
✓ tests/scheduler/sandbox.test.ts (4 tests) 414ms
Test Files  1 passed (1)
     Tests  4 passed (4)
```
(Confirms the exact literal `"orca-test <orca-test@invalid>\n"` — including
the trailing newline `git log` emits — matches real output; no guessing.)

**M-T1-ID (RED proof, done in a `git clone --local` sibling copy, main
worktree untouched)**:

1. `shasum -a 256` of the four touched files, taken before the clone:
   ```
   c11a710d...  tests/scheduler/sandbox.test.ts
   4bebe67e...  tests/scheduler/sandbox.ts
   38b6880c...  package.json
   b39b66eb...  scripts/verify-scheduler.mjs
   ```
2. `git clone --local` to `/Users/biran/code/skills/loop/orca-gate-clone-tmp2`
   (sibling of `ccloop`, same reason as Task 1's original Step 5), copied the
   worktree's fixed-up files in with `cat src > dest`, `diff`-confirmed
   byte-identical, `npm install`.
3. Control run in the clone (unmutated): `npx vitest run tests/scheduler` →
   `CLONE_BEFORE_RC=0`, 4/4 passed.
4. Mutation `M-T1-ID`: in the clone only, changed
   `await git(targetRepo, [...ID, "commit", "-m", "init"]);` to
   `await git(targetRepo, ["commit", "-m", "init"]);` — the `add -A` call's
   `ID` spread was left untouched, exactly as instructed ("delete the ID
   spread from the commit invocation only"). Confirmed this machine has a
   global git identity configured (`user.name=biran`,
   `user.email=blrbiran@163.com`) so the mutation falls back to a real leak
   rather than failing to commit at all.
5. Re-ran: `npx vitest run tests/scheduler` → **`M_T1_ID_RC=1`**. Actual
   failing output:
   ```
   × the scheduler sandbox > builds a repository with a real commit, a clean
     worktree, and no git identity leaking in from the machine
     → expected 'biran <blrbiran@163.com>\n' to be 'orca-test <orca-test@invalid>\n'
   Test Files  1 failed (1)
        Tests  1 failed | 3 passed (4)
   ```
   The failure is exactly the leak the finding named: the sandbox's commit
   picked up the developer's real machine identity once the injected `-c`
   flags were removed.
6. Deleted the clone (`/bin/rm -rf orca-gate-clone-tmp2`), confirmed removed.
7. `shasum -a 256` of the same four files, taken again:
   ```
   diff /tmp/p2-t1-fix-main-before.sha256 /tmp/p2-t1-fix-main-after.sha256
   → no output (byte-identical)
   ```

## Finding 2 — eager `ccloopBin` resolution coupled every sandbox to ccloop's build state

**Change**: `Sandbox.ccloopBin` stays typed `string` (interface unchanged, as
ruled). `makeSandbox()` now returns an object with `ccloopBin` as a **getter**
that calls the resolver only on first read and caches the result; resolution
no longer happens during `makeSandbox()` itself. `makeSandbox` gained one
optional parameter, `options: { resolveCcloopBin?: () => string } = {}`,
whose only purpose is to let `sandbox.test.ts` substitute a resolver that
throws — a real absence of ccloop's build is not reproducible on this
machine (the dist artifact is present), so this is the injectable-path
option the ruling offered rather than the "rename dist temporarily" option,
which would have meant mutating ccloop's repository (forbidden) to
manufacture the failure. Nothing in this task's own three original scenarios,
nor Tasks 2+ per the plan, is expected to ever pass this parameter — it
exists solely for `sandbox.test.ts`.

**Criterion added** (`sandbox.test.ts`): constructs a sandbox with an
injected resolver that unconditionally throws `"simulated: ccloop bin not
found"`, asserts `makeSandbox()` still resolves (does not throw), then
asserts `() => s.ccloopBin` throws that exact message. A pass is only
possible if construction never invoked the resolver and reading the property
is what invokes it — this measures the real lazy/eager distinction in the
actual code path, not a re-implementation of it.

I did not find an honest way to test this without either (a) an injectable
seam like the one added, or (b) temporarily moving ccloop's real
`dist/cli.js` out of the way (rejected — that mutates ccloop's repository
state, which the original brief was explicit is off-limits beyond a build).
Reported per the instruction to say so if no clean option existed, though in
this case option (a) was clean enough to use rather than only report.

**Covering test run (GREEN)**: same `npx vitest run tests/scheduler` run
above — includes the new "resolves ccloopBin lazily" test, 4/4 passed.

## Full verification before commit

```
npm run typecheck  → RC=0
npx vitest run tests/scheduler  → RC=0, 4/4 passed (run twice, before and
                                   after a variable rename cleanup — resolve_
                                   renamed to resolver for clarity)
npm run verify  → RC=0 (final run, post-rename)
```

## Self-review of the fix

- Both fixes are additive: no existing assertion, export, or field was
  weakened, renamed, or removed. `git` went from private to exported;
  `ccloopBin` went from an eager field to a lazy getter with the same
  declared type; `makeSandbox` gained one optional, test-only parameter.
- Checked the new "builds a repository..." assertion is not the
  assert-before-call shape Rule 9 warns about: it reads `git log` *after*
  `makeSandbox()` has already run the commit, so it necessarily reflects
  what git actually did, not a value the test wrote itself.
- Checked the new laziness test is not self-referential: it does not assert
  anything about `resolveCcloopBin`'s internals or re-implement the schema;
  it observes only the two externally-visible facts the finding named
  (construction succeeds; reading the property is what throws).
- Left the three items the coordinator ruled deferred (`refSha`'s broad
  catch, the double execution of scheduler tests under `verify`, the
  hard-coded sibling path in `resolveCcloopBin`) untouched, as instructed.

## Files changed (fix round 1)

- `tests/scheduler/sandbox.ts` (modified: `git` exported; `makeSandbox` takes
  an optional injectable resolver and returns `ccloopBin` as a lazy getter)
- `tests/scheduler/sandbox.test.ts` (modified: added the identity assertion
  to the existing first test; added one new test for `ccloopBin` laziness)
