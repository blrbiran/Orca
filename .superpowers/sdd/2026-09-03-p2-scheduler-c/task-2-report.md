# Task 2 report — plan file + the six up-front rejections (§2.3)

Run: this session (2026-09-04), executed directly on `main`, no branch/worktree, no push.
Base commit: `5d04f2d` (Task 1 complete). Result commit: `dcee344`.

## What was implemented

- `src/scheduler/planFile.ts` — `PlanTask`, `PlanFile`, `PlanRejection` interfaces
  exactly as specified in the brief (no `base`/`baseRef` field, per the controller's
  ruling that the base commit is runtime-derived per spec §4.2). `loadPlan(raw,
  defaultBranch)` is a pure function: a zod `.strict()` schema validates shape
  (producing a `"malformed"` rejection code for anything the schema itself
  rejects — missing/mistyped fields, unknown keys), then six independent checks
  run against the parsed data and every rejection is collected before returning,
  rather than stopping at the first:
  1. `relative-path` — every path field (`targetRepo`, `ccloopBin`, `runsDir`,
     each task's `contract`) must be `node:path.isAbsolute`.
  2. `duplicate-task-id` — a `Set` walk over `tasks`.
  3. `cycle` — `planHasCycle`, a standalone three-colour DFS. Per ruling R2 in
     the SDD ledger, this is deliberately temporary: a comment on the function
     says Task 4 will export `detectCycle(tasks)` for the graph layer and this
     body is expected to converge to a one-line call into it, so no logic is
     pulled forward from Task 4.
  4. `contract-inside-target-repo` — `node:path.relative(targetRepo, contract)`
     does not start with `".."` and is not itself absolute. `relative` was used
     instead of `startsWith` so that a sibling directory merely sharing
     `targetRepo` as a string prefix (e.g. `/abs/repo` vs `/abs/repo-2/x`) is
     not wrongly treated as inside.
  5. `work-branch-is-default` — `workBranch === defaultBranch`.
  6. `unsupported-policy` — anything other than the literal `"local-merge"`.
- `tests/scheduler/planFile.test.ts` — the brief's Step 1 criteria verbatim,
  with the `codes(r)` and `t(id, deps)` helpers written at the top of the file
  as instructed.

Zero filesystem or git I/O anywhere in `planFile.ts` — confirmed by inspection;
the only imports are `node:path` (`isAbsolute`, `relative`, both pure string
operations) and `zod`.

## TDD evidence

**RED** — module does not exist yet:

```
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/scheduler/planFile.test.ts > /tmp/p2-t2-red.txt 2>&1; echo "RC=$?"; cat /tmp/p2-t2-red.txt
```

Real output (`/tmp/p2-t2-red.txt`), `RC=1`:
```
 FAIL  tests/scheduler/planFile.test.ts [ tests/scheduler/planFile.test.ts ]
Error: Failed to load url ../../src/scheduler/planFile.js (resolved id: ../../src/scheduler/planFile.js) in /Users/biran/code/skills/loop/Orca/tests/scheduler/planFile.test.ts. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```
Expected: the module genuinely does not exist yet at this point, so every test fails to even collect. This is not a test-logic failure, it's the correct "nothing built yet" red.

**GREEN** — after implementing `src/scheduler/planFile.ts`:

```
npm test -- --run tests/scheduler/planFile.test.ts > /tmp/p2-t2-green.txt 2>&1; echo "RC=$?"; cat /tmp/p2-t2-green.txt
```

Real output (`/tmp/p2-t2-green.txt`), `RC=0`:
```
 ✓ tests/scheduler/planFile.test.ts (8 tests) 5ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**`npm run verify`** (full suite, main worktree):

```
npm run verify > /tmp/p2-t2-verify.txt 2>&1; echo "RC=$?"
```
`RC=0`, `9 files / 131 tests` (123 pre-existing + 8 new), including the expected
seven `downgraded to tier 0` lines from the pre-existing ledger fixtures
(by design, per the controller's note 6 — not touched). Full output saved at
`/tmp/p2-t2-verify.txt`; re-confirmed again after mutation testing at
`/tmp/p2-t2-verify-final.txt`, same result.

## Mutation testing (Step 5) — all in a `git clone --local` copy

The implementation was committed first (`dcee344`) so it existed in git history
and could be cloned; mutation testing then ran entirely inside the clone
(`/private/tmp/.../scratchpad/orca-mutate`), never in the main worktree.
`node_modules` was symlinked into the clone rather than reinstalled:

```
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca "$CLONE"
ln -s /Users/biran/code/skills/loop/Orca/node_modules "$CLONE/node_modules"
```

Baseline in the clone: `npx vitest run tests/scheduler/planFile.test.ts` → 8/8 passed
(`/tmp/p2-t2-clone-baseline.txt`). Each mutation below was applied with `sed`
against the cloned `src/scheduler/planFile.ts`, run, and then reverted with
`git checkout -- src/scheduler/planFile.ts` before the next one — so each
mutation is isolated to a fresh copy of the real implementation.

| Mutation | What was deleted/changed | Criterion that must go red | Command | Result / output file |
|---|---|---|---|---|
| `M-P2-REL` | the `relative-path` push loop | `rejects any relative path` | `sed -i '' '123,127d' ... && npx vitest run tests/scheduler/planFile.test.ts` | RED — `expected [] to include 'relative-path'` (also reddened `reports every rejection at once`, which is expected since that test also exercises a relative path). `/tmp/p2-t2-mut-REL.txt` |
| `M-P2-DUP` | the duplicate-taskId `Set` walk | `rejects a duplicate taskId` | same pattern, lines `129,137d` | RED — `expected [] to include 'duplicate-task-id'`, the only failing test. `/tmp/p2-t2-mut-DUP.txt` |
| `M-P2-CYC` | the `if (planHasCycle(...))` block | `rejects a cycle` | lines `139,142d` | RED — `expected [] to include 'cycle'`, the only failing test (proves `planHasCycle` is actually wired in, not dead code). `/tmp/p2-t2-mut-CYC.txt` |
| `M-P2-IN` | the contract-inside-target-repo loop | `rejects a contract file that lives inside the target repo` | lines `144,154d` | RED — `expected [] to include 'contract-inside-target-repo'`, the only failing test. `/tmp/p2-t2-mut-IN.txt` |
| `M-P2-WB` 🔴 | the `workBranch === defaultBranch` check | `rejects workBranch equal to the default branch` | lines `156,160d` | RED — `expected [] to include 'work-branch-is-default'` (also reddened `reports every rejection at once`, expected). `/tmp/p2-t2-mut-WB.txt` |
| `M-P2-POL` | the `policy !== "local-merge"` check | `rejects a policy other than local-merge` | lines `162,167d` | RED — `expected [] to include 'unsupported-policy'` (also reddened `reports every rejection at once`, expected). `/tmp/p2-t2-mut-POL.txt` |
| `M-P2-ALL` | inserted an early `return { rejections }` right after the first (`relative-path`) check, simulating "stop at the first rejection" | `reports every rejection at once, not just the first` | `perl -0777 -pi -e '...'` inserting the early return, then `npx vitest run ...` | RED — **only** this criterion failed: `expected [ 'relative-path' ] to deeply equal [ 'relative-path', 'unsupported-policy', 'work-branch-is-default' ]`. All other 7 tests stayed green, confirming the `toEqual` sorted-array shape is what actually catches "collect vs. stop-at-first" — a `toContain`-only test would have missed this. `/tmp/p2-t2-mut-ALL.txt` |

All seven were genuinely observed red (full un-filtered output redirected to a
file and read back with `cat`, per the repo's evidence discipline) — none
inferred.

## Restoration proof

```
cd "$CLONE" && /usr/bin/git checkout -- src/scheduler/planFile.ts
npx vitest run tests/scheduler/planFile.test.ts   # back to 8/8 passed (/tmp/p2-t2-clone-final.txt)
/bin/rm -f "$CLONE/node_modules"; /bin/rm -rf "$CLONE"
```

Main worktree byte-identity, measured with `shasum -a 256` before the clone was
made and after it was deleted:

```
--- before ---
8a247086a0d7b21e9e8e68aa7f87c95eeda8cc74bc7223e73219e44ced166249  src/scheduler/planFile.ts
3980f44fb047e7af6c215e348bcc82be8640d2b5001198317e84bfa5fd1e063c  tests/scheduler/planFile.test.ts
--- after ---
8a247086a0d7b21e9e8e68aa7f87c95eeda8cc74bc7223e73219e44ced166249  src/scheduler/planFile.ts
3980f44fb047e7af6c215e348bcc82be8640d2b5001198317e84bfa5fd1e063c  tests/scheduler/planFile.test.ts
```
Identical (`diff` exit 0, empty). `git status --porcelain` on the main worktree
was clean throughout (`/tmp/p2-t2-final-main-status.txt`). ccloop's `git status
--porcelain` was empty after all mutation work (`/tmp/p2-t2-ccloop-status.txt`)
— it was never touched, since this task never invoked it.

## Ordering note (deviation from the brief's literal step order)

The brief lists "Step 5: mutations" before "Step 6: commit". I committed the
implementation first, then ran the mutation proof against the committed
`dcee344`, because `git clone --local` clones from git's object database, not
uncommitted working-tree state — an uncommitted `planFile.ts` would not exist
in the clone at all. The substance (each mutation genuinely observed red, in
an isolated clone, main worktree unaffected) is unchanged; only the position
of the one commit relative to the proof moved. No second commit was needed
since no implementation defect was found.

## Self-review

- Interfaces match the brief verbatim: `PlanTask`, `PlanFile` (no `base`/
  `baseRef` field, per the controller's ruling), `PlanRejection`, and
  `loadPlan(raw, defaultBranch)`'s signature and "collect all" contract.
- Zero I/O confirmed by inspection — only `node:path` (pure string ops) and
  `zod` are imported; `tests/scheduler/sandbox.ts` is not imported.
- Checked for the two known-bitten shapes:
  (a) an assertion that reads back a value the test itself just wrote, before
  the call under test — none found; every test builds its input, calls
  `loadPlan`, and only then asserts on the result.
  (b) a criterion whose assertions don't measure its stated purpose — checked
  `reports every rejection at once`: it uses a sorted `toEqual` against the
  full expected set (not `toContain`), which is exactly what caught
  `M-P2-ALL` above; confirmed by the mutation table, not by inspection alone.
- Nothing built beyond the brief's two files and the two interfaces/function
  it asked for — no CLI wiring, no helper additions to `sandbox.ts`.
- `planHasCycle`'s standalone-DFS-by-design status is documented in a comment
  referencing ruling R2, so Task 4's later replacement is a one-line change.

## Files changed

- `/Users/biran/code/skills/loop/Orca/src/scheduler/planFile.ts` (new)
- `/Users/biran/code/skills/loop/Orca/tests/scheduler/planFile.test.ts` (new)

Commit: `dcee344` — "feat(scheduler): load a plan file and reject the six
shapes that cannot be scheduled"

## Concerns

None. The one edge case not covered by the brief's criteria: `isInsideRepo`
treats `contract === targetRepo` exactly (a contract literally at the repo's
root path, `relative()` returns `""`) as *not* inside, since `""` fails the
`rel !== ""` guard. This is not one of the six tested shapes and is an
unlikely-to-occur degenerate input (a "contract" that is the repo itself), so
it was left as is rather than adding an untested branch.
