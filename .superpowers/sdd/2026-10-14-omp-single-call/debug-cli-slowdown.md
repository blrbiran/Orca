# Debug: cli.test.ts "returns 0 for the example contract run" slowdown

Who: debugging subagent of Orca session 02f047f6 (Claude-Session session_01NCgRiQLh17ENJdrmuJDcKL). When: 2026-10-15 ~00:16-00:25 local.
Subject: ccloop branch codex/omp-single-call HEAD 522cd61 vs base 7909637. Read-only on the worktree; all mutations in my own
`git clone --local` copies under /private/tmp/osc/mut/bisect-* (removed afterwards).

## Verdict

**Not a regression on the branch. No commit in 7909637..522cd61 adds the time.** The ~4 s comes from *where* the test
runs: the example contract has `repoPath: "."` and `worktreeRequired: true`, so the run makes its attempt commit
inside a worktree of the hosting repo. In `/Users/biran/code/skills/orca/ccloop-wt/omp-single-call` that repo is
`/Users/biran/code/skills/orca/ccloop/.git`, whose `hooks/post-commit` is a "Qoder AI tracker" hook that starts
`/Applications/Qoder CN.app/Contents/MacOS/Qoder CN` (Electron as node) on every commit. A `git clone --local`
(cli-base, bisect-*) gets no hooks from the source repo, so the same code is ~1 s there. The earlier base-vs-branch
comparison compared a clone (no hook) against the worktree (hook).

Triggering line: `src/workspace/worktreeManager.ts:111-115` (the attempt `git commit`, using `ATTEMPT_IDENTITY`
defined at `src/workspace/worktreeManager.ts:38`), which runs the hosting repo's hooks.

## Measurements (all `npx vitest run tests/cli/cli.test.ts -t "returns 0 for the example contract run" --testTimeout 60000`, rc=0 every run; logs in /private/tmp/osc/logs/)

1. Base clone vs branch clone, alternated (load 1-min 107-119):

| tree | run1 | run2 | run3 | logs |
|---|---|---|---|---|
| clone @7909637 | 1396 | 1685 | 2801 | bisect-7909637-run{1,2,3}.log |
| clone @522cd61 | 1793 | 1326 | 2031 | bisect-522cd61-run{1,2,3}.log |

=> no code difference.

2. Worktree vs clone, same commit 522cd61, alternated (load 79-93):

| tree | run1 | run2 | run3 | logs |
|---|---|---|---|---|
| worktree omp-single-call | 7187 | 6133 | 7215 | cmp-omp-single-call-run*.log |
| clone @522cd61 | 2676 | 3349 | 2449 | cmp-bisect-522cd61-run*.log |

3. Hooks toggled by env only (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<dir>`, no file changed), load 43-49:

| tree / hooks | run1 | run2 | run3 | logs |
|---|---|---|---|---|
| worktree, default (Qoder hooks) | 3343 | 3204 | 2593 | hk-wt-default-run*.log |
| worktree, empty hooks dir | 1176 | 1078 | 1115 | hk-wt-nohooks-run*.log |
| clone @522cd61, default (no hooks) | 995 | 1018 | 1048 | hk-clone-default-run*.log |
| clone @522cd61, hooksPath = ccloop/.git/hooks | 2643 | 2383 | 2492 | hk-clone-qoderhooks-run*.log |
| clone @7909637, default | 1004 | 1077 | 1149 | hk-base-default-run*.log |
| clone @7909637, logged Qoder hooks | 4115 | 3091 | 3132 | hk-base-qoderhooks-run*.log |

Hook timing log (wrapper hooks dir around the real ones, base clone): per run one `post-checkout` (old head all-zero ->
the tracker skips it, 15-35 ms) and one `post-commit` taking 1.92 s, 1.96 s, 1.64 s at load ~40. Under load 66-110
(the gate's) the Electron start grows to ~4 s, which with the ~1 s of real work crosses vitest's 5 s default.

## Bisect

Not needed past the endpoints: base and head clones are equal (table 1), and the base commit is slowed the same when the
hook is pointed at (table 3). First bad commit: none in the branch.

## Other tests (step 4)

Only this test runs a contract whose `repoPath` is the hosting repo (`examples/v1/minimal-contract.json`, `"."`).
The sweep test in the same file `git init`s its own temp repo (no hooks); no other test file references the example
contract or `repoPath` = cwd (grep of tests/). `src/control/savedResultRecovery.ts:76` and
`src/controller/executionFormatFailure.ts:23` already pass `-c core.hooksPath=/dev/null`, so the two 30 s timeouts in
`savedResultRecovery.native.test.ts` in /private/tmp/osc/gate/ccloop-full.log are not this cause (not investigated further).
Global git config has no hooksPath / templateDir.

## Proposed fix (verified in my clone only; NOT applied to the worktree)

Product option, with in-repo precedent (the two `core.hooksPath=/dev/null` call sites above): ccloop's mechanical attempt
commit should not run the hosting repo's hooks.

```diff
--- a/src/workspace/worktreeManager.ts
+++ b/src/workspace/worktreeManager.ts
@@ -35,7 +35,7 @@
-const ATTEMPT_IDENTITY = ["-c", "user.name=ccloop", "-c", "user.email=ccloop@invalid"];
+const ATTEMPT_IDENTITY = ["-c", "user.name=ccloop", "-c", "user.email=ccloop@invalid", "-c", "core.hooksPath=/dev/null"];
```

Verified (clone @522cd61 + this diff, built rc=0, hooks still forced to the Qoder dir via env, load ~22): 1435 / 1130 /
1047 ms, and the hook log shows zero `post-commit` calls (only the zero-head `post-checkout` from `git worktree add`,
worktreeManager.ts:27, which the diff does not cover). Logs: fix-diff.txt, fix-build.log, fix-qoderhooks-run*.log.
Without the diff (mutation = the original line): 2383-4115 ms with the hook (table 3), so the change is what is seen.

The existing test that shows it: `tests/cli/cli.test.ts` > "parseArgs > returns 0 for the example contract run", run from
a worktree of /Users/biran/code/skills/orca/ccloop (red by 5 s timeout under load before, ~1 s after). No existing test
asserts hooks are skipped; a criterion for that would be new (a repo with a post-commit hook that writes a marker).

Environment alternative (human's call, outside any agent's write scope): remove the Qoder tracker block from
`/Users/biran/code/skills/orca/ccloop/.git/hooks/post-commit` (and post-checkout). This is a change to the user's machine,
not to ccloop.

Since this changes when user hooks run on ccloop's commits, it is a behaviour change for the ccloop owner to rule on;
it is not a fix of the omp-single-call branch, which can be treated as unaffected (rerun that test with the env override
above, or accept it as a known environmental flake).

## Side observations (reported, not touched)

- Each run of this test from the worktree leaves `refs/ccloop/ccloop-cli-scripted-*/attempts/1` in the main ccloop repo
  (165 non-branch refs, oldest 2026-09-19); my 6 worktree runs added some. Pre-existing behaviour.
- `git -C /Users/biran/code/skills/orca/ccloop worktree list` shows a prunable
  `.../T/cl-urgA5S/.../ccloop-cli-scripted-hjULkX/worktrees/attempt-1` (not mine; the cl-urgA5S tmpdir is not one I used) and
  `/private/tmp/orca-results-ccloop-20261010` prunable.

## Process hygiene

Before: pids 7541 (fake-omp, /private/tmp/osc/mut/t6), 9260, 38130 (fake-codex, worktree), 39296, 58085, 85784.
After: 7541, 9260, 58085, 85784 remain (all pre-existing, not mine); 38130 and 39296 ended on their own. None started by me left.
Removed: my clones bisect-7909637, bisect-522cd61 (symlinks first with /bin/rm -f) and my temp hook dirs emptyhooks-WH4a,
loghooks-J1i7. cli-base and the other /private/tmp/osc/mut entries untouched. Worktree `git status --short`: `?? node_modules` only, before and after.
