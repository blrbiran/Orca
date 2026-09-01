# Task 6 report: CLI ＋ 退出码 0／1／2

## What was implemented

- `src/cli.ts` — new CLI entry point exporting `main(argv, stdinText?): Promise<number>`.
  - `validate <path...>`: paths may be files or directories (directory scan is top-level only,
    so `.decisions/archive/` is skipped by construction); reads each file, runs it through
    `validateFile` (Task 4), and combines verdicts. Precedence: `rejected` (1) beats
    `downgraded` (2) beats `ok` (0). A stat failure on any path also counts as rejected.
  - `check-append-only`: reads a git diff from stdin (or the `stdinText` param), delegates to
    `checkAppendOnly` (Task 5), returns 0/1.
  - No subcommand / unknown subcommand: prints usage to stderr, returns 1.
  - Bottom-of-file runner block: only executes `main(process.argv.slice(2))` when the file is
    run directly as `tsx src/cli.ts` (not on import), and does `process.exitCode = code` —
    this is the line M6-c targets.
- `tests/cli/cli.test.ts` — 11 tests: 7 in-process exit-code assertions for `validate`, 2 for
  `check-append-only`, and 2 that spawn a real child process (`execFile("npx", ["tsx",
  "src/cli.ts", ...])`) and assert on its actual OS exit code / stdout.
- `tests/fixtures/ledger/{ok,downgraded,rejected}.jsonl` — the three fixture lines from the
  brief, copied byte-for-byte (Chinese content untouched).
- `.decisions/orca-dev-09cc3ea1.jsonl` — one line appended (see Step 6 below).

Code comments, CLI usage text, and error strings are in English per project constraint 1;
Chinese JSON fixture/test-input content is untouched.

## RED evidence (Step 2)

Command:
```
npx vitest run tests/cli/cli.test.ts > /tmp/orca-t6-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-red.txt
```
Real output (exit=1):
```
 FAIL  tests/cli/cli.test.ts [ tests/cli/cli.test.ts ]
Error: Failed to load url ../../src/cli.js (resolved id: ../../src/cli.js) in /Users/biran/code/skills/loop/Orca/tests/cli/cli.test.ts. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```
Matches the brief's expectation exactly (import resolution failure, exit=1, before `src/cli.ts` existed).

## GREEN evidence (Step 4, and final full-suite run before commit)

Command:
```
npm test > /tmp/orca-t6-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-green.txt
```
Real output (exit=0):
```
 Test Files  6 passed (6)
      Tests  78 passed (78)
```
(6 files: smoke, appendOnly, undoExecutable, validateFile, validateLine (38, includes the real-ledger
regression), cli (11, including the 2 real-process tests).)

Re-ran the identical command after appending the ledger line (Step 6) and before committing —
same result, `exit=0`, `78 passed (78)`.

## Mutation evidence

Setup (per the task's mandated procedure, not the brief's Step 5):
- `MAIN=/Users/biran/code/skills/loop/Orca`
- `MUT=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/cd28ef61-b463-4863-9a46-784b47aa1757/scratchpad/mutant-task-6`
- `git clone --local -q "$MAIN" "$MUT"`, symlinked `node_modules`, copied in
  `src/cli.ts`, `tests/cli/cli.test.ts`, and the three fixtures — each `diff` against `$MAIN`
  came back `exit=0` before any mutation.
- Baseline run in the clone: `npx vitest run tests/cli/cli.test.ts` → `exit=0`, 11/11 passed.

### M6-a — downgrade no longer blocks (`if (sawDowngraded) return 2;` → `return 0;`)

Edit applied only inside `$MUT/src/cli.ts`.

Command: `(cd "$MUT" && npx vitest run tests/cli/cli.test.ts) > /tmp/orca-t6-m6a.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-m6a.txt`

Real failing output (exit=1):
```
 ❯ tests/cli/cli.test.ts (11 tests | 1 failed) 910ms
   × main — validate exit codes > returns 2 when only downgraded, nothing rejected 4ms
     → expected +0 to be 2 // Object.is equality

 FAIL  tests/cli/cli.test.ts > main — validate exit codes > returns 2 when only downgraded, nothing rejected
AssertionError: expected +0 to be 2 // Object.is equality
```
Named assertion (brief: `只有降级时返回 2`) visible and failing, as required.

Restore: `cat "$MAIN/src/cli.ts" > "$MUT/src/cli.ts"`, `diff` → `restore exit=0`.

### M6-b — rejected no longer outranks downgraded (swap the two `return` lines)

Edit applied only inside `$MUT/src/cli.ts`:
```
  if (sawDowngraded) return 2;
  if (sawRejected) return 1;
```

Command: `(cd "$MUT" && npx vitest run tests/cli/cli.test.ts) > /tmp/orca-t6-m6b.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-m6b.txt`

Real failing output (exit=1):
```
 ❯ tests/cli/cli.test.ts (11 tests | 2 failed) 914ms
   × main — validate exit codes > returns 1 when both downgraded and rejected are present 4ms
     → expected 2 to be 1 // Object.is equality
   × main — validate exit codes > a directory argument scans top-level *.jsonl files 1ms
     → expected 2 to be 1 // Object.is equality
```
Named assertion (brief: `降级与拒绝同时存在时返回 1`) visible and failing. (The directory-scan test
also fails as collateral, because the fixtures directory itself contains both a downgraded and a
rejected file — expected, not a concern.)

Restore: `cat "$MAIN/src/cli.ts" > "$MUT/src/cli.ts"`, `diff` → `restore exit=0`.

### M6-c — return value never reaches the process exit code (delete `process.exitCode = code;`)

Edit applied only inside `$MUT/src/cli.ts`, changing:
```
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
```
to:
```
  void main(process.argv.slice(2)).then((code) => {
  });
```

Command: `(cd "$MUT" && npx vitest run tests/cli/cli.test.ts) > /tmp/orca-t6-m6c.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-m6c.txt`

Real failing output (exit=1):
```
 ❯ tests/cli/cli.test.ts (11 tests | 1 failed) 898ms
   × real process exit code > rejected.jsonl makes the process exit with 1 460ms
     → promise resolved "{ stdout: '', …(1) }" instead of rejecting
   ✓ real process exit code > ok.jsonl makes the process exit with 0 431ms

 FAIL  tests/cli/cli.test.ts > real process exit code > rejected.jsonl makes the process exit with 1
AssertionError: promise resolved "{ stdout: '', …(1) }" instead of rejecting
- [Error: rejected promise]
+ Object {
+   "stderr": ".../tests/fixtures/ledger/rejected.jsonl:1: rejected: alternatives: Array must contain at least 1 element(s)\n",
+   "stdout": "",
+ }
```

**Explicit confirmation for M6-c**: the failure is the exit-code assertion itself, not a
module/file-resolution error. The spawned process ran to completion and printed the correct
`rejected: alternatives: Array must contain at least 1 element(s)` diagnostic to stderr —
proving `src/cli.ts`, the fixture path, and `validateFile` all resolved and executed correctly
inside the clone. It simply exited 0 instead of 1 because `process.exitCode` was never set, so
`execFileAsync`'s promise resolved instead of rejecting. Meanwhile all 7 in-process
`main()`-return-value assertions (the ones the brief warns about) stayed green — exactly the
gap this task exists to close.

Restore: `cat "$MAIN/src/cli.ts" > "$MUT/src/cli.ts"`, `diff` → `restore exit=0`.

**A mutation you did not see go red is not evidence** — all three pasted outputs above are the
real, unfiltered vitest output from the clone (`2>&1` redirected to a file and `cat` back, no
pipe).

## Main-tree-untouched proof

```
git -C "$MAIN" diff > /tmp/orca-t6-fp-before.txt 2>&1; wc -c < /tmp/orca-t6-fp-before.txt   # → 0
... (mutation procedure, entirely inside $MUT) ...
git -C "$MAIN" diff > /tmp/orca-t6-fp-after.txt 2>&1; wc -c < /tmp/orca-t6-fp-after.txt     # → 0
diff /tmp/orca-t6-fp-before.txt /tmp/orca-t6-fp-after.txt; echo "fingerprint diff exit=$?"  # → exit=0
```
Both fingerprints are empty (0 bytes — no tracked file in `$MAIN` was modified during the
mutation procedure; `src/cli.ts` was untracked the whole time, which is exactly why `git diff`
doesn't need to show it), and `diff` between before/after is `exit=0`. `$MUT` was
`rm -rf`'d afterward and confirmed gone.

## Test-name mapping table (Chinese brief → English `it(...)` used)

| Brief (Chinese) | English `it(...)` description used |
|---|---|
| 全过时返回 0 | `returns 0 when everything passes` |
| 有拒绝时返回 1 | `returns 1 when something is rejected` |
| **只有降级时返回 2** (M6-a target) | **`returns 2 when only downgraded, nothing rejected`** |
| **降级与拒绝同时存在时返回 1** (M6-b target) | **`returns 1 when both downgraded and rejected are present`** |
| 目录参数扫顶层的 *.jsonl | `a directory argument scans top-level *.jsonl files` |
| 路径不存在时返回 1 | `returns 1 when the path does not exist` |
| 没给子命令时返回 1 | `returns 1 when no subcommand is given` |
| 纯追加返回 0 | `returns 0 for a pure append diff` |
| 含删除行返回 1 | `returns 1 when the diff contains a deleted line` |
| **rejected.jsonl 让进程以 1 退出** (M6-c target) | **`rejected.jsonl makes the process exit with 1`** |
| ok.jsonl 让进程以 0 退出 | `ok.jsonl makes the process exit with 0` |

Describe blocks: `main — validate 的退出码` → `main — validate exit codes`;
`main — check-append-only 的退出码` → `main — check-append-only exit codes`;
`真进程的退出码` → `real process exit code`.

## Ledger append proof (Step 6)

```
grep '^{"ev":"bound"' .superpowers/sdd/2026-08-29-decision-ledger-validator/task-6-brief.md > /tmp/orca-t6-boundline.txt
wc -l /tmp/orca-t6-boundline.txt   # → 1 /tmp/orca-t6-boundline.txt
```
Confirmed exactly 1 matching line before appending. Content:
```
{"ev":"bound","id":"orca-dev-09cc3ea1/6","note":"退出码 0/1/2 落在 src/cli.ts；M6-c 证过返回值确实接到了进程退出码"}
```
The other three `{"ev":"decision",...}` lines from the brief (`fx/1`, `fx/2`, `fx/3`) went into
`tests/fixtures/ledger/ok.jsonl`, `downgraded.jsonl`, `rejected.jsonl` respectively — not the
ledger.

Before/after byte-identity of lines 1-12:
```
sed -n '1,12p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t6-ledger-before.txt   (taken before append)
... append ...
sed -n '1,12p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t6-ledger-after.txt
diff /tmp/orca-t6-ledger-before.txt /tmp/orca-t6-ledger-after.txt; echo "ledger-first12 diff exit=$?"
# → ledger-first12 diff exit=0
wc -l .decisions/orca-dev-09cc3ea1.jsonl   # → 13
```
Confirmed: 13 lines total, lines 1-12 byte-identical (diff exit=0), line 13 is the bound line above.

## Full suite green (final, before commit)

`npm test` → `exit=0`, `Test Files 6 passed (6)`, `Tests 78 passed (78)`. Task 2's real-ledger
regression test (`accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl`, inside
`tests/ledger/validateLine.test.ts`, 38 tests in that file) stayed green after the 13th line was
appended.

## Commit

```
git add src/cli.ts tests/cli/cli.test.ts tests/fixtures/ledger .decisions/orca-dev-09cc3ea1.jsonl
```
`git status --porcelain` right before commit showed exactly these 6 files staged (`M` on the
ledger, `A` on the 5 new files) plus one unrelated pre-existing untracked file
(`package-lock.json`, present in `git status` before this task began, left untouched — out of
scope per "touch only the files the brief lists").

Commit: `0cc160b feat(cli): validate 与 check-append-only，退出码 0/1/2` (verbatim brief message,
with `Co-Authored-By` / `Claude-Session` trailers).

## Self-review findings and concerns

- No `dist/` build step was invoked; `src/cli.ts` is run via `tsx` (matches how the two
  process-spawning tests and the existing `npm run ledger` script already invoke it).
- The unused-parameter concern from M6-c's edit (`(code) => { }` with `code` unused) only
  existed transiently inside the mutant clone and was restored before it could matter; `tsx`
  doesn't type-check so it never blocked the mutation run.
- No blockers. All steps completed as specified; no check was weakened, no ledger content
  modified beyond the single required append, no destructive git operations were run outside
  the disposable clone, and no push/merge/branch/worktree operations occurred.
