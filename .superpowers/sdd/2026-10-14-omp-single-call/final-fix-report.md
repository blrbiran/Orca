# Final fix wave report

Who: final-fix-wave subagent of Orca session 02f047f6 (Claude-Session session_01NCgRiQLh17ENJdrmuJDcKL).
When: 2026-10-15 ~00:26-00:36 local. Base: ccloop 522cd61, Orca f00d6910.

## Status: DONE (items 1-4)

## Commits
- ccloop (branch codex/omp-single-call, worktree ccloop-wt/omp-single-call):
  - 5ee1c6e docs(agents): attribute the singleCallExecution erratum to its session (registry.ts:42 header now reads
    `*** ERRATUM (OMP single call, Orca spec 2026-10-14 §3.2, Orca session 02f047f6, 2026-10-14) ***`; nothing else in the comment changed)
  - bd1ddc3 fix(omp): keep a decoded single-call answer when its usage evidence write fails
    (ompAdapter.ts:83-84 `.catch(() => undefined)` + one-line comment; new test
    "OmpAdapter.singleCall, the usage evidence write is best-effort > returns the decoded answer and its observed usage when usage.json cannot be written")
- Orca (worktree Orca-wt/omp-single-call): d1b89c34 docs(spec): record the omp single-call residuals found during implementation
  (append-only §8; `git diff --numstat` 37 insertions / 0 deletions; HEAD-prefix sha256 425f24fc...fa18 equals the pre-append file's).

## Evidence (logs under /private/tmp/osc/logs/, each read whole)
| Command | Log | RC |
|---|---|---|
| new test before the fix (worktree) | fw-red-before.log | 1 (EISDIR at ompAdapter.ts:83, promise rejected instead of resolving) |
| new test after the fix | fw-green-after.log | 0 |
| vitest tests/runtime/omp/ | fw-omp.log | 0 (4 files, 54 tests) |
| vitest tests/agents/ | fw-agents.log | 0 (14 files, 136 tests) |
| vitest tests/control/ompSingleCallWorker.test.ts | fw-worker.log | 0 (2 tests) |
| npm run typecheck | fw-typecheck.log | 0 |
| npm run build | fw-build.log | 0 |
| ccloop mutation (clone /private/tmp/osc/mut/fw-ccloop at bd1ddc3, drop the usage.json `.catch`) | fw-ccl-mut.log | 1 (same EISDIR red) |
| Orca mutation (clone /private/tmp/osc/mut/fw-orca at d1b89c34, drop `.nullable()` from singleCallOutputCap), `-t "C10: accepts" --testTimeout 60000` | fw-orca-mut.log | 1 (red at `{ singleCallOutputCap: null }` -> false) |

Mutation sha256 (ompAdapter.ts): before 6830a041...dff01, mutated b3fb0efe...49a6, restored 6830a041...dff01; git diff / --cached 0 / 0 bytes.
Mutation sha256 (ccloopPort.ts): before d73d2dd3...d437, mutated ae53ee1e...1f58, restored d73d2dd3...d437; git diff / --cached 0 / 0 bytes.
Both clones removed (symlinks first with /bin/rm -f; main checkouts' node_modules still present).

## Processes (`pgrep -fl "fake-omp|worker.js"`), same four before and after, none started by this seat, none killed
- 7541 fake-omp.mjs from /private/tmp/osc/mut/t6 (that clone directory no longer exists)
- 9260 worker.js from /private/tmp/ccloop-omp-agent-20261012
- 58085, 85784 worker.js from ccloop-wt/codex-429

## Concerns
- The two ccloop commits ran in the worktree, so the main ccloop repo's post-commit hook (Qoder tracker, debug-cli-slowdown.md) ran on them; no change made to that.
- §8 bullet 2's "about killGraceMs + ~1 s" overrun is the final review's estimate; I verified the arithmetic path (probe <= 10 s outside the limit; worker margin 10 s, singleCall.ts:47/:87), not the 1 s by measurement.
- This report file is left uncommitted in the Orca worktree.
