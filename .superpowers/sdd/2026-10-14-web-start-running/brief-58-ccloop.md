# Brief: feedback #58 (ccloop part) — OMP model resolution is slow and its error says nothing

Repository: ccloop, NEW worktree /Users/biran/code/skills/orca/ccloop-wt/omp-catalog-diagnostics, branch codex/omp-catalog-diagnostics, stacked on codex/omp-single-call (bd1ddc3, unpushed). Read /Users/biran/code/skills/orca/Orca-wt/omp-single-call/.superpowers/sdd/2026-10-14-omp-single-call/hard-rules.md (ccloop work in THIS worktree only) and ccloop's CLAUDE.md first; ccloop Rule 15: existing criteria are never rewritten unless the human names them — if one would have to change, STOP and report.

## Facts (re-read; Rule 8)
- src/agents/ompModels.ts `runOmpJson`: PROBE_TIMEOUT_MS 10 000; stderr is discarded; every failure (timeout kill, output limit, spawn error, non-zero exit) rejects with the bare `omp-model-catalog-unavailable`; bad JSON → `omp-model-catalog-invalid`.
- Callers: `readOmpCatalog` / `readOmpModels` are used by resolveAgent (src/agents/materialize.ts), detect/updates (src/agents/*), and the single call's SPAWN-TIME re-read (src/runtime/omp/ompSingleCall.ts ~38). Grep all callers yourself.
- Orca reports a failed resolution as `control-peer-exit` (Orca side; not this task).

## Controller ruling (design; reversible)
1. Diagnostics: keep the error CODE prefix exactly (`omp-model-catalog-unavailable`, `omp-model-catalog-invalid`) so every existing caller and test that matches the code keeps working; add a detail after `: ` naming the reason — one of `timeout <ms>ms`, `exit <code>`, `signal <name>`, `spawn <errno>`, `output-limit` — followed by ` · stderr: <tail>` when stderr is non-empty. The tail is the LAST ≤ 400 bytes of stderr decoded as UTF-8 (no split multibyte char), with control characters (except none) replaced by spaces and whitespace collapsed; never include stdout or env. Capture stderr up to a bounded buffer (keep only the last 4 KiB) instead of discarding. FIRST check how existing tests assert these errors (exact `toThrow("…")` string vs `toThrowError(/…/)` vs `.message ===`): vitest `toThrow("x")` is a substring match, but an `===` or `toEqual` on the message would break — if any existing criterion compares the whole message, STOP and report.
2. Memo: an in-process memo of `readOmpCatalog` results keyed by the installation's (command, profile, configDir) for the lifetime of one ccloop process (no disk, no TTL needed since a ccloop control call is one short process — verify that claim by reading src/control/command.ts dispatch; if some long-lived ccloop process exists (worker, runner), add a 30 s TTL instead). Only successful reads are memoised. The single call's spawn-time re-read MUST bypass the memo (spec §3.3.1: re-read immediately before spawning) — make that explicit in the API (e.g. `readOmpCatalog(installation, { fresh: true })` or a separate uncached function) and pin it with a criterion.
3. Do NOT change PROBE_TIMEOUT_MS (triage: raising it only waits longer).

## Criteria (each seen red first; then each seen red under its named mutation in a fresh `git clone --local` under /private/tmp/osc/mut/w58c)
- C58a: a fake omp whose `models --json` exits 3 with stderr "boom: no config" ⇒ rejection message starts with `omp-model-catalog-unavailable: exit 3` and contains `stderr: boom: no config`. Mutation: drop the stderr tail.
- C58b: timeout ⇒ `omp-model-catalog-unavailable: timeout` (use an injectable timeout for the test if PROBE_TIMEOUT_MS is not injectable — add a parameter, default unchanged). Mutation: report exit instead.
- C58c: stderr tail is bounded and sanitised (≥10 KiB of stderr with control bytes and a multibyte char across the cut) ⇒ ≤ 400 bytes, no control bytes, valid UTF-8. Mutation: no cap.
- C58d: two resolutions of the same installation in one process spawn `omp models` once (count via the fake's calls file). Mutation: no memo.
- C58e: the single call's spawn-time re-read spawns `omp models` again even after a memoised resolution. Mutation: spawn-time read uses the memo.
- Use tests/fixtures/fake-omp.mjs (extend with NEW options only; default behaviour byte-identical for existing callers).

## Gates
`npm run typecheck`, `npm run build`, tests/agents/ tests/runtime/omp/ tests/control/ (redirect to /private/tmp/osc/logs/w58c-*.log, read whole, RC). Known: tests/cli/cli.test.ts "returns 0 for the example contract run" is slow/red when run from a worktree (main repo's Qoder post-commit hook) — environment; tests/runtime/codex/runCodexPhase.test.ts "kills a TERM-ignoring process" intermittent. Rerun any other red file alone 3x.
Commit(s) with `/usr/bin/git commit -F` (fix(omp)/feat(omp)); trailers per hard-rules. Never `git add -A` (node_modules symlink).

## Report
Write the full report to /Users/biran/code/skills/orca/Orca-wt/web-start-running/.superpowers/sdd/2026-10-14-web-start-running/report-58-ccloop.md (if refused, in your final message): callers found, how existing tests assert, design as built, RED/GREEN, mutation table, gates with RC, commits. Reply with ONLY: Status, commits, one-line test summary, concerns.
