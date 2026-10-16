# Task 9 Step 1 -- ccloop full gate, re-run 2 (final tip)

Measured in session a852f96a (delegated agent), 2026-10-16 11:52-12:13. Measurement only: no repo file edited, no commit.
Tip: `/usr/bin/git -C ccloop-wt/every-agent-chain rev-parse HEAD` and the clone's rev-parse both = 60bcc6cd9777673e24b82c7bc02ae5c5b2a300ef (`ccg2-tip.txt`).
Clone G=/private/tmp/ccg2-e4LX, gate TMPDIR=/private/tmp/cl-wk7F, CCLOOP_CACHE_DIR=$G/cache. Logs: /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs/ccg2-*. Script: scratchpad/ccg2-run.sh (brief Step 1 verbatim + uptime per segment).
Uptime per segment (ccg2-uptime.txt, 1-min load): start 9.15, build 11.30, vitest 11.12, known-reds 15.03 (after vitest), verify-control 15.03, tmpleak 17.24, end 13.22. Load stayed 9-22 (previous run: up to 184).

## Commands, RC, counts (as printed)
| command | RC | result |
|---|---|---|
| npm run typecheck | 0 | tsc --noEmit clean |
| npm run build | 0 | |
| vitest run --reporter=json | 1 | JSON: numTotalTests 1826, passed 1822, failed 4; suites 445 / 437 passed / 8 failed |
| check-known-reds.mjs | 1 | "known reds in roster: 6 / failed: 4 / unexpected: 4" (all 4 UNEXPECTED) |
| npm run verify:control (read whole, ccg2-verify-control.log) | 1 | "Test Files  1 failed | 79 passed (80); Tests  1 failed | 865 passed (866)" -- the one red: extractFinalObject "(execute)" 4503 ms > 3000 |
| check-tmp-leak.mjs | 0 | "vitest exit 1, 1826 tests, 0 entries left in /private/tmp/cl-wk7F/cl-CKdYS7" (its inner vitest was red; no leftover) |
| ls -la $G/cache | 1 | No such file or directory |

## Reds off the known list (main run) and classification
Each file run alone 3x in the clone (same env: ORCA_CCLOOP_BIN, ORCA_AGENTS_TABLE, CCLOOP_CACHE_DIR, fresh TMPDIR); ccg2-alone-summary.txt has uptime before/after each.
| red | alone RC 1/2/3 | load | classification |
|---|---|---|---|
| tests/agents/agentCatalog.test.ts "criterion 1 ... writes under a relocated HOME's default path only when CCLOOP_CACHE_DIR and XDG_CACHE_HOME are unset (§4.2)": expected 2 to be 1 at agentCatalog.test.ts:110 (`readdir(redirected).length`) | **1/1/1** | 11-13 | **REAL RED** (deterministic, quiet machine; same failure in the main run). Cause (read from source, not a fix run): the test last changed before dcec5b3..60bcc6c; commit 34a14a3 made the codex catalog probe create a private `codex-home` dir under the cache dir (src/agents/codexCatalog.ts readIsolatedMcpServers, catalogCacheDir), so a CCLOOP_CACHE_DIR used by a codex capabilities call now holds 2 entries (agent-catalog + codex-home); the assertion still expects 1. Not on efcd5b3's red list, so it is new since efcd5b3 (git log efcd5b3..HEAD = dcec5b3, 34a14a3, 60bcc6c). The tmpleak log also shows codex-home paths under ccache-* dirs. |
| tests/controller/verifySavedResult.test.ts "r1 command interruption modified=true checks recovery integrity without inventing provider usage" | 0/0/0 | 9-12 | load flake (same shape as previous report's modified=false variant; green 3/3) |
| tests/validation/codexAdapter.test.ts "outer watchdog kills a previously observed TERM-ignoring detached Codex" (matcher 1500 ms) | 0/0/0 | 8-11 | load flake (timing matcher) |
| tests/runtime/codex/extractFinalObject.test.ts "16 MiB ... under 3 s" (main run plan 3717 ms; verify:control execute 4504 ms) | 0/0/0 | 11-19 | load flake (timing threshold; 3/3 green) |
verify:control's single red is the same extractFinalObject test: load flake. Nothing else red.

## Verdict
Gate does NOT pass: check-known-reds RC 1 and verify:control RC 1; of the 4 main-run reds, 3 are load flakes (3/3 green alone), 1 is a real, reproducible red (agentCatalog.test.ts:110 stale expectation after 34a14a3). Typecheck, build, tmpleak RC 0. Fixing the assertion is a criterion rewrite (ccloop Rule 15: human names it); not done here.

## Real cache path
`ls -la $HOME/.cache/ccloop` before (ccg2-realcache-before.txt) and after (ccg2-realcache-after.txt): "No such file or directory" both. Not written.

## Processes
`pgrep -fl "fake-omp|fake-codex|worker.js"`: before RC=1 (0 matches); after the gate RC=1 (0); after the alone runs, `ps` for those names and for "ccg2-e4LX": 0 matches. Nothing to kill; nothing killed. Clone /private/tmp/ccg2-e4LX and TMPDIRs /private/tmp/cl-* left in place.
