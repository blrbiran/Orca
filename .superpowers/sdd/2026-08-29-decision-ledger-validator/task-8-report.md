# Task 8 Report: 把校验接成门（`npm run verify` ＋ pre-commit）

## What was implemented

- `scripts/check-claude-md-lines.mjs` (new) — reads `CLAUDE.md`, counts lines (trailing
  newline doesn't count as an extra line), exits non-zero with a message if over 200,
  else prints `ok: CLAUDE.md is N/200 lines`. Logic/thresholds are verbatim from the
  brief; comments and output strings were translated to English per this project's
  "English in code" constraint (Chinese wording in the brief was not literal requirement
  text for the code itself).
- `scripts/githooks/pre-commit` (new, executable) — runs the CLAUDE.md line-budget check
  on every commit; if `.decisions/` is touched in the staged diff, also runs
  `check-append-only` (fed the staged diff via a temp file, not a pipe, to avoid
  swallowing git's exit code) and `validate .decisions`. Comments/output English,
  logic verbatim from the brief.
- `package.json` — added two scripts:
  - `"verify": "npm run typecheck && npm test && npm run ledger -- validate .decisions && node scripts/check-claude-md-lines.mjs"`
  - `"hooks:install": "git config core.hooksPath scripts/githooks"`
- `package-lock.json` — committed for the first time (deviation 2 from the controller:
  it was untracked since Task 1; committing it lets `npm ci` reproduce the pinned
  `zod ^3.23.8` / `vitest ^2.0.5` ranges, matching ccloop's convention per Rule 11).
- `docs/handoff/handoff.md` — **not touched** (Step 8 skipped per controller instruction).

Commit: `2eb4249` — `chore(gate): npm run verify 与 pre-commit 把台账纪律接成机制` (message
verbatim from the brief, plus the required trailers). 4 files changed: `package-lock.json`,
`package.json`, `scripts/check-claude-md-lines.mjs`, `scripts/githooks/pre-commit`.

## Gate-goes-red evidence

**Step 1** — planted `.decisions/orca-tmp-bad.jsonl` (empty `alternatives`), ran
`npm run ledger -- validate .decisions`:
```
exit=1
.decisions/orca-tmp-bad.jsonl:1: rejected: alternatives: Array must contain at least 1 element(s)
```
(command via `/tmp/orca-t8-red.txt`, no filtering)

**Step 3** — added `verify`/`hooks:install` to `package.json`, ran `npm run verify` with
the bad ledger still present:
```
exit=1
...
> orca@0.1.0 ledger
> tsx src/cli.ts validate .decisions

.decisions/orca-tmp-bad.jsonl:1: rejected: alternatives: Array must contain at least 1 element(s)
```
(89/89 tests still passed along the way; the ledger validate step is what failed and
short-circuited `verify`'s exit code to 1 via `&&` chaining.)
(command output in `/tmp/orca-t8-verify-red.txt`)

## Gate-goes-green evidence

**Step 4** — `/bin/rm -f .decisions/orca-tmp-bad.jsonl`, then `npm run verify`:
```
exit=0
```
Tail of output contained both required lines:
```
ok: 1 ledger file(s)
ok: CLAUDE.md is 135/200 lines
```
135 was measured with `wc -l CLAUDE.md` on this commit (matches the brief's expected
number exactly; CLAUDE.md was not edited to match it).
(command output in `/tmp/orca-t8-verify-green.txt`)

## Hook-blocks evidence (Step 6, done in a `git clone --local` copy)

Cloned `Orca` to a scratch dir (`mutant-task-8`), symlinked `node_modules`, copied in
this task's uncommitted files (`check-claude-md-lines.mjs`, `pre-commit`, `package.json`),
`chmod +x` the hook, ran `npm run hooks:install` inside the clone (this is per-clone
local config, confirmed via `git config --get core.hooksPath` → `scripts/githooks`,
`exit=0`).

**Illegitimate mutation (should be blocked)**: replaced `"chose"` with `"CHOSE"` in line 1
of the committed ledger, `git add .decisions && git commit -m "should be blocked"`:
```
commit-exit=1
ok: CLAUDE.md is 135/200 lines
non-append change to .decisions/**: -{"ev":"decision","id":"orca-dev-09cc3ea1/1", ...}
```
The commit was genuinely rejected — this is not a hook that was merely installed and
never observed firing; the rejection output and non-zero exit code were both captured.

**Legitimate append (should be allowed)**: appended a new, schema-valid decision line
(`id: t8test/1`) to the same ledger file, staged, committed:
```
commit-exit=0
ok: CLAUDE.md is 135/200 lines
ok: append-only
ok: 1 ledger file(s)
[main 87ee7e9] test: branch A legitimate append (retry)
```
(First attempt at this append used a malformed `alternatives` array of strings instead
of `{option, why_not}` objects and was correctly rejected by `validate` with
`exit=1`/`rejected: alternatives.0: Expected object, received string` — fixed and
retried; this was a mistake in my synthetic test fixture, not a hook defect.)

## Two-branch proof for the hook's `.decisions`-touched test

Before trusting `if git diff --cached --name-only -- .decisions | read -r _; then` on
this machine's `/bin/sh` (bash 3.2.57 via the `/bin/sh` symlink), tested the construct
directly:
```
/bin/sh -c 'if printf "a\nb\n" | read -r _; then echo YES; else echo NO; fi'   → YES
/bin/sh -c 'if printf ""       | read -r _; then echo YES; else echo NO; fi'   → NO
```
Confirms the construct correctly distinguishes non-empty vs. empty input on this
machine — no deviation needed.

Then proved both branches live, inside the clone:
- **Branch B (non-`.decisions` change staged)**: appended a comment to
  `scripts/check-claude-md-lines.mjs`, staged only that file. `git diff --cached
  --name-only -- .decisions` was 0 bytes. Commit succeeded (`commit-exit=0`), and hook
  output showed **only** `ok: CLAUDE.md is 135/200 lines` — no ledger-check output at
  all, proving the `if` body was skipped.
- **Branch A (`.decisions` change staged)**: staged the legitimate append above. `git
  diff --cached --name-only -- .decisions` was non-empty (`.decisions/orca-dev-09cc3ea1.jsonl`).
  Commit output showed `ok: append-only` and `ok: 1 ledger file(s)` in addition to the
  CLAUDE.md line — proving the `if` body ran.

## Main-tree-untouched proof (checksums)

Before cloning:
```
0f760555085511e51e5b50db5db74fe7ed1cf4d30cf61d6e90dc087e3b4cecac  scripts/check-claude-md-lines.mjs
1ef5fa1c177540e423c53f2e84cac128fc6ed9fdc46957936fd6d0c38fa50204  scripts/githooks/pre-commit
dd4fc37b2b7238d06a4f0d93dfaaa65eb5f383dd6ff933d32166a7d6430fae2e  package.json
c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda  .decisions/orca-dev-09cc3ea1.jsonl
```
After the clone was mutated (blocked-commit test, appended-line test) and destroyed:
```
0f760555085511e51e5b50db5db74fe7ed1cf4d30cf61d6e90dc087e3b4cecac  scripts/check-claude-md-lines.mjs
1ef5fa1c177540e423c53f2e84cac128fc6ed9fdc46957936fd6d0c38fa50204  scripts/githooks/pre-commit
dd4fc37b2b7238d06a4f0d93dfaaa65eb5f383dd6ff933d32166a7d6430fae2e  package.json
c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda  .decisions/orca-dev-09cc3ea1.jsonl
```
`diff /tmp/orca-t8-sha-before.txt /tmp/orca-t8-sha-after.txt` → **identical, exit=0**.
The mutant clone (`/private/tmp/.../scratchpad/mutant-task-8`) was `rm -rf`'d afterward
and confirmed gone (`ls` on it → `No such file or directory`, exit=1).

## `.decisions/orca-tmp-bad.jsonl` — confirmed never staged, no longer exists

- Created only in Step 1 as a plain file write (`cat > ...`), never `git add`ed.
- Removed with `/bin/rm -f` in Step 4.
- Verified with `ls -la .decisions/` before the Step 7 commit: only
  `orca-dev-09cc3ea1.jsonl` present.
- Verified `git diff --cached -- .decisions` was 0 bytes immediately before committing.

## `docs/handoff/handoff.md` — confirmed not touched

`git diff HEAD~1 HEAD --name-only -- docs/handoff/handoff.md` on the Step 7 commit
returned 0 lines — the file does not appear in this commit's changed-file list.

## Own commit passed through the installed hook, no `--no-verify`

`core.hooksPath` was set to `scripts/githooks` in the main repo (not just the clone)
before the Step 7 commit, via `npm run hooks:install` — `git config --get
core.hooksPath` → `scripts/githooks`, `exit=0`. The Step 7 commit's output shows the
hook actually ran:
```
[main ...] chore(gate): npm run verify 与 pre-commit 把台账纪律接成机制
```
preceded by `ok: CLAUDE.md is 135/200 lines` printed by the hook (the `.decisions`
branch was correctly skipped since this commit touches no `.decisions/**` files).
No `--no-verify` was used anywhere in this task.

## Full suite / typecheck, final confirmation (post-commit, on HEAD)

```
npx tsc --noEmit   → exit=0
npm test           → exit=0, Test Files 7 passed (7), Tests 89 passed (89)
npm run verify     → exit=0 (final end-to-end re-check)
```

## Self-review findings and concerns

1. **English-in-code deviation from the brief was applied as instructed.** The brief's
   `check-claude-md-lines.mjs` and `pre-commit` comments/strings are Chinese in the
   brief text; per the controller's explicit deviation instruction, I translated all
   comments and output strings to English, keeping logic, thresholds, and commands
   byte-for-byte equivalent. The commit message stayed verbatim Chinese as instructed.
2. **The `if ... | read -r _; then` construct works correctly** on this machine's
   `/bin/sh` (bash 3.2.57, posix-ish invocation) — verified both branches directly with
   `printf` before trusting it in the hook, then re-verified against real `git diff
   --cached` output in the clone. No deviation from the brief's hook script was needed.
3. **One synthetic-test mistake, not a gate defect**: my first attempt at the "legitimate
   append" proof used `alternatives: ["alt"]` (strings) instead of the schema's
   `{option, why_not}` object shape; `validate` correctly rejected it
   (`alternatives.0: Expected object, received string`). This is exactly the gate
   working as intended (catching a malformed test fixture); I fixed the fixture and
   re-ran. Not a finding against the implementation.
4. **`package-lock.json` was committed per controller deviation 2** — 1992 insertion
   lines, `lockfileVersion: 3`, `name: orca`, `version: 0.1.0`, generated by whatever
   `npm install` produced it in an earlier task's environment (not regenerated by me).
   I did not run `npm install`/`npm ci` against it in the main tree in this task,
   so I did not independently verify it reproduces cleanly via `npm ci`; the mutant
   clone used a symlinked `node_modules` rather than `npm ci` from this lockfile, so
   that is not evidence either. This is a residual gap worth someone checking with a
   real `npm ci` at some point, though it is out of this task's stated scope (which is
   to commit it, not to prove `npm ci` reproducibility).
5. **Known gaps this task does not address** (unchanged from the plan's own
   "已知缺口" section): indexer, corrections/human-override loop, `git blame --follow`,
   archival tooling, run-id allocation across concurrent agents, `undo.how` false
   positives, non-git ledger directories. None of these were in scope for Task 8.
6. Touched only the files the controller authorized:
   `scripts/check-claude-md-lines.mjs`, `scripts/githooks/pre-commit`, `package.json`,
   `package-lock.json`, plus the temporary (never committed) `.decisions/orca-tmp-bad.jsonl`.
   `docs/handoff/handoff.md` was not touched. No push, branch, or worktree operations
   were performed; no `--no-verify`; no `rm -rf`/`cp` without `-i`-avoidance (used
   `/bin/rm` throughout).

---

# Fix round 1 — `.decisions`-touched detection fails open on git error

## Finding addressed

The reviewer's Important finding: `if git diff --cached --name-only -- .decisions | read -r _; then`
is a pipeline used as an `if` condition, exempt from `set -e`. If `git diff --cached
--name-only` itself ever exited non-zero (not "no output", but "could not compute"),
that failure would be swallowed by the pipe into `read`, `read` would still read
nothing and return false, and the ledger checks would be silently skipped — the
gate would fail open on a git error, which is the one direction a gate covering the
append-only rule must never take.

## What changed

`scripts/githooks/pre-commit` — replaced the pipe-into-`read` emptiness test with a
branch on git's own exit status from `git diff --cached --quiet -- .decisions`:

```sh
decisions_changed=1
if git diff --cached --quiet -- .decisions; then
  decisions_changed=0
fi

if [ "$decisions_changed" -ne 0 ]; then
  ... (unchanged body: check-append-only via temp file, then validate .decisions)
fi
```

`decisions_changed` defaults to `1` (the safe/run-the-checks direction). It is only
set to `0` when `git diff --cached --quiet -- .decisions` exits exactly `0` ("no
changes"). Any other exit status (`1` = changes staged, or anything ≥2 = git itself
failed) leaves `decisions_changed=1`, so the ledger checks run. Nothing inside the
body of the `if` was touched — only which branch is taken changed, as instructed.

Commit: `f7af633` — `fix(gate): pre-commit 的 .decisions 触碰检测改成看 git 自己的退出码，不再看管道有没有输出`.
1 file changed (`scripts/githooks/pre-commit`), 9 insertions, 2 deletions.

## Verification — all four branches, in a `git clone --local` copy

Cloned `Orca` to a fresh scratch dir (`mutant-task-8-fix`), symlinked `node_modules`,
copied in the fixed `scripts/githooks/pre-commit`, `chmod +x`, ran `npm run
hooks:install` inside the clone.

**Branch 1 — edit an existing ledger line in place ⇒ blocked, HEAD unmoved:**
```
commit-exit=1
ok: CLAUDE.md is 135/200 lines
non-append change to .decisions/**: -{"ev":"decision","id":"orca-dev-09cc3ea1/1",...}
```
`git log -1 --format=%H` before and after the failed commit attempt were identical
(`2eb42495cb82e58448652cff2e9d71c4592e7ea6` both times, `diff` exit=0) — HEAD did not move.

**Branch 2 — append one new, schema-valid line ⇒ allowed, checks visibly ran:**
```
commit-exit=0
ok: CLAUDE.md is 135/200 lines
ok: append-only
ok: 1 ledger file(s)
[main 1a11f96] branch2: legitimate append (should be allowed)
```
Both `ok: append-only` and the `ok: N ledger file(s)` line are present, proving the
checks branch actually executed (not just that the commit happened to succeed).

**Branch 3 — commit touching no `.decisions` file ⇒ allowed, checks visibly skipped:**
```
commit-exit=0
ok: CLAUDE.md is 135/200 lines
[main 1b83fe9] branch3: non-.decisions change (checks skipped)
```
Only the CLAUDE.md line-budget output appears — no `ok: append-only` / ledger-file
output — confirming the ledger checks did not run when `.decisions` was untouched
(`git diff --cached --name-only -- .decisions` was 0 bytes before this commit).

**Branch 4 — a git failure on the `.decisions`-touched test must select the
"run the checks" branch, not the "skip" branch:**

Built a stub `git` (`#!/bin/sh`) that intercepts exactly `diff --cached --quiet --
.decisions` and exits `129`, delegating every other invocation to `/usr/bin/git`.
Verified standalone first: `PATH="$STUBBIN:$PATH" git diff --cached --quiet --
.decisions` → `exit=129` (stub hit); `PATH="$STUBBIN:$PATH" git --version` → real git
output, `exit=0` (passthrough works).

Attempted to drive this through a real `git commit`: it did **not** work — debug
instrumentation showed `git commit` prepends its own git-core exec directory
(`/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core`) to `PATH` ahead
of anything the caller set before invoking the pre-commit hook subprocess
(`DEBUG which git = /Applications/Xcode.app/.../libexec/git-core/git`), so the stub
was never reached by a hook invoked through `git commit` on this machine.

Per the coordinator's stated fallback for exactly this case, ran the **real, unmodified
hook script directly** (not an extracted snippet) with the stub `PATH` prepended:
```
PATH="$STUBBIN:$PATH" sh scripts/githooks/pre-commit
```
Output:
```
ok: CLAUDE.md is 135/200 lines
STUB: forcing git diff --cached --quiet -- .decisions to exit 129
ok: append-only
ok: 1 ledger file(s)
hookrun-exit=0
```
The stub line proves the simulated git failure was hit; `ok: append-only` and
`ok: 1 ledger file(s)` immediately after prove the "run the checks" branch was
selected — not skipped — despite the git call failing rather than reporting "no
changes". This is the whole point of the fix, demonstrated rather than argued.

**Which of the two fallback options was used:** the real hook script, run directly
(`sh scripts/githooks/pre-commit`), not an extraction of just the four branch lines
— because the full script was already small enough to run as-is and this exercises
the actual shipped file rather than a re-typed excerpt.

## Main-tree-untouched proof (checksums)

Before creating the clone (taken right after editing `pre-commit` in the main tree,
before any clone/stub work):
```
fde3e1911c0973af2595197955e08d7e2ebd71108c97e4da3d3a34b0019c9ce2  scripts/githooks/pre-commit
c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda  .decisions/orca-dev-09cc3ea1.jsonl
```
After all four branch tests and destroying the clone and the stub directory:
```
fde3e1911c0973af2595197955e08d7e2ebd71108c97e4da3d3a34b0019c9ce2  scripts/githooks/pre-commit
c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda  .decisions/orca-dev-09cc3ea1.jsonl
```
`diff` between the two checksum files → **identical, exit=0**. `git -C "$MAIN" status
--porcelain` before and after both showed only ` M scripts/githooks/pre-commit`
(my own in-progress, not-yet-committed fix) — the ledger file was never modified in
the main tree. The clone (`mutant-task-8-fix`) and the stub bin directory were both
`rm -rf`'d afterward and confirmed gone.

## `npm run verify`

Ran once on the main tree after the fix: `exit=0`, tail of output shows
`ok: 1 ledger file(s)` and `ok: CLAUDE.md is 135/200 lines`.

## Own commit passed through the installed hook, no `--no-verify`

`git commit` for `f7af633` printed `ok: CLAUDE.md is 135/200 lines` (the hook ran)
and succeeded with `commit-exit=0`; the `.decisions` branch was correctly skipped
since this commit touches no `.decisions/**` file. No `--no-verify` was used.

## Post-fix full suite / typecheck

```
npx tsc --noEmit → exit=0
npm test         → exit=0, Test Files 7 passed (7), Tests 89 passed (89)
```

## Confirmations

- `docs/handoff/handoff.md` — not touched (not present in `git diff HEAD~1 HEAD
  --name-only` for this commit; only `scripts/githooks/pre-commit` changed).
- The four Minor findings from the review (temp-file leak on a blocked commit,
  `wc -l` divergence for a file lacking a trailing newline, the raw stack trace when
  `CLAUDE.md` is missing, `verify`'s check ordering) were **not** addressed, per the
  coordinator's explicit instruction that they are deferred to the final whole-branch
  review.
- No push, branch, or worktree operations were performed. `/bin/rm` used throughout
  for cleanup, never a bare `rm -rf` needing confirmation bypass on user data — all
  destructive operations were scoped to scratch directories under this session's
  `/private/tmp/.../scratchpad/` path, created and destroyed entirely within this task.
