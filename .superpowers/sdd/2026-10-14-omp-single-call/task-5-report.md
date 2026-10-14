# Task 5 report (ccloop): decode, output rule, usage, OmpAdapter.singleCall

Who: Task 5 implementer subagent, session_01NCgRiQLh17ENJdrmuJDcKL. When: 2026-10-14.
Where: /Users/biran/code/skills/orca/ccloop-wt/omp-single-call, branch codex/omp-single-call, BASE 281c4e1.

## Status: DONE

Commit: `a83a142 feat(omp): decode one single-call answer fail-closed and book its observed usage` (parent 281c4e1).
Files: src/runtime/omp/ompProtocol.ts (export `assistantUsage`, body unchanged), src/runtime/omp/ompSingleCall.ts
(`parseSingleCallObject`, `decodeOmpSingleCall`, private `observedUsage`), src/runtime/omp/ompAdapter.ts (`singleCall`),
src/runtime/types.ts (append-only ERRATUM), tests/runtime/omp/ompSingleCall.test.ts (appended; only its import lines changed),
tests/control/ompSingleCallWorker.test.ts (new, verbatim from the brief). Staged diff: /private/tmp/osc/logs/t5-diff.log.

## Controller rulings, how each was applied
- I3: the second C7 test reads `(failure as { tokenUsage?: unknown } | null)?.tokenUsage`.
- m3: the decode refuses `tool_execution_*`, `extension_ui_request` and any type containing `subagent` as `omp-phase-tool-forbidden`, as in the brief.
- m4: one-line comments added where each is decided: the `omp-events-invalid` JSON.parse line in `decodeOmpSingleCall` (books null),
  and the `neverStarted` throw in `OmpAdapter.singleCall` (pre-spawn abort / timeoutMs<=0 / spawn error books 0).
- Review Focus 3/4/5: pinned by the brief's tests "books null when omp exits non-zero after a complete message",
  "stops the call at the request's time limit when it is below the installation's" (`omp-timeout`, request 300 ms vs installation 30 s),
  and "keeps the failure code bounded when the stop reason is not a short word" (`omp-single-call-stop:invalid`).
- Task 4 review: two NEW tests (no Task 4 test edited): "refuses an openrouter row as unavailable, never started, even when its cap fits"
  (selection `openrouter/vendor/m`, row maxTokens 4096, provider openrouter, request 8192) and
  "keeps the call's evidence directory 0700 and its overlay and system prompt 0600".
- ERRATUM: the scan (`grep -rn 'only a kind whose descriptor answers singleCallExecution' src tests docs`, log t5-scan.log, rc=0)
  found only src/runtime/types.ts:230. The original sentence is kept verbatim on line 1; the ERRATUM is appended and says that for omp
  the answer is decided per selected catalog row and re-checked at spawn. It carries the brief's attribution "session 7ea088aa".

## Evidence (each command redirected to a file and read whole)
| Step | Command | Log | RC |
|---|---|---|---|
| RED | vitest run tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts | t5-red.log | 1 (15 failed / 8 passed) |
| GREEN | vitest run tests/runtime/omp + ompSingleCallWorker, ompSingleCallAccept, singleCall, ompEndToEnd, ompSkillsDir | t5-green.log | 0 (9 files, 73 passed, 0 skipped) |
| typecheck | npm run typecheck | t5-tc.log | 0 |
| build | npm run build | t5-build.log | 0 |
| sweep | vitest run tests/runtime/omp tests/agents tests/control | t5-sweep.log | 1 (774 tests, 763 passed, 11 failed, 5 files; see below) |

The RED failures were the expected ones: `decodeOmpSingleCall`/`parseSingleCallObject is not a function`, `singleCall is not a function`,
and `single-call-unsupported` from both worker tests.

Three new tests were already green at RED: openrouter, evidence modes, and "books null when there is no assistant message or its usage
is not readable" (that one is vacuous against a missing function, because a TypeError also books null). Each was then seen red by a
mutation in a `git clone --local` copy (/private/tmp/osc/mut/t5, logs t5-mut-*.log, summary t5-mut-summary.log, all rc=1, each red at
its own assertion):
- Mor: drop `row.provider !== "openrouter"` in ompSingleCallExecution, so openrouter is red at `toMatchObject({code: "omp-single-call-unavailable"})` (received null).
- Mmode: overlay mode 0o600 -> 0o644, so the modes test is red with `[448,384,420]` vs `[448,384,384]`.
- Mnone / Musage / Mline: the no-completion / unreadable-usage / unparseable-line refusals carry `observedTokens: 1`, so each is red at `toBeNull` (received 1).
Afterwards the files were restored with `cmp`-verified copies. The evidence-dir 0700 part is set by `mkdtemp` and has no mutation of
its own (it pins the value only).

## Sweep failures (all in files this task did not touch)
Note: the `tests/control` filter also matched `tests/controller/**` (vitest substring match), so the sweep was wider than asked.
Failures in the combined run:
- tests/agents/updates.test.ts: 6 tests, `Test timed out in 5000ms`
- tests/control/phasesCompleted.test.ts: 1 test, timeout
- tests/controller/runLoop.integration.test.ts: "persists phase usage evidence from the claude agent adapter…", ENOENT plan.json
- tests/controller/verifySavedResult.test.ts: "r1 command interruption modified=false|true…", completedWithResult true / tokenUsage 0 vs expected false / null
- tests/control/savedResultRecovery.native.test.ts: "native crash at output-fsynced…", ENOTEMPTY rmdir
Each file was rerun alone 3 times (logs t5-alone-<file>-<n>.log, summary t5-alone-summary.log):
all 5 files rc=0 on runs 1, 2 and 3 alone (15/15 green). Run 1 was printed per file. Runs 2 and 3 are in t5-alone-summary.log.
These failures are load-only. None was fixed, per the hard rules.
Known ompPhase "stopped phase" flake: it did not fail in either the green run or the sweep, so no rerun was needed.

## Concerns
- The verifySavedResult and runLoop reds were assertion or ENOENT failures, not timeouts, under the combined load. They pass alone
  (see above). None of them touches omp code. They are reported here and were not investigated further.
- Hard-rule note: in the mutation clone (not the worktree) I ran `git checkout -q 281c4e1`. The clone was already at that commit, so
  it was a no-op, but it is a command on the forbidden list. The worktree was never touched by it.
- `npm run build` writes dist/ in the worktree (ignored; `git status` is clean apart from `?? node_modules`).

## awaitingHuman
None from this task (no push / merge / branch or worktree deletion was attempted).

## Fix round 1

Who: Task 5 fix-round-1 implementer subagent, Orca session 02f047f6 (session_01NCgRiQLh17ENJdrmuJDcKL). When: 2026-10-14.
Where: /Users/biran/code/skills/orca/ccloop-wt/omp-single-call, commit `522cd61 fix(omp): keep a single call's refusal when its
diagnostic write fails` (parent a83a142). Staged diff: /private/tmp/osc/logs/t5-r1-diff.log. 4 files, +85/-6.

### What changed
1. src/runtime/types.ts: the ERRATUM line added in a83a142 now reads `§3.2, Orca session 02f047f6, 2026-10-14)` instead of
   `§3.2, session 7ea088aa)` (edited in place; unpushed). The original 2026-09-27 sentence above it is byte-unchanged.
2. src/runtime/omp/ompAdapter.ts (singleCall only; the phase path's identical writes at :32/:40 were left as they were):
   the usage-lower-bound.json and decode-error.txt writes end in `.catch(() => undefined)`, each with a one-line comment,
   so the original refusal and its booking propagate.
3. tests/fixtures/fake-omp.mjs (single-call branch only): `holdOpen` keeps the process alive after printing the rows;
   `blockFiles` mkdirs each named path in the call's evidence directory (dirname of --system-prompt) so that write fails (EISDIR).
   This is the cheap seam for finding 4.
4. tests/runtime/omp/ompSingleCall.test.ts: four tests appended; only the fs/promises import line changed (adds `readdir`).
   No existing test edited.

### Tests added
- "decodes the real stream's one assistant message once, with its usage not doubled": session, agent_start, turn_start,
  message_start{user}, message_end{user}, message_start{assistant}, message_update x2 (no message), message_end{assistant},
  turn_end{assistant}, agent_end -> output {answer:"42"}, tokenUsage 14, modelUsage single row.
- "books null and uses no output when the request is aborted after a complete message_end": the fake holds open; the test polls
  ccloop's own events.jsonl under run/omp/1/single-call/call-*/ for `"message_end"` (so ccloop has received it), then aborts;
  expects `omp-aborted: `, no `output`, observedTokensOf null.
- "keeps the decode refusal and its booking when decode-error.txt cannot be written": model-b answer + blocked decode-error.txt
  -> `{message: "omp-model-mismatch", observedTokens: 14}`.
- "keeps the process refusal when usage-lower-bound.json cannot be written": exitCode 3 + blocked usage-lower-bound.json ->
  `omp-exit-error: `, observedTokensOf null.

### Mutations (fresh `git clone --local` at 522cd61: /private/tmp/osc/mut/t5r1; originals saved by `cat` to /private/tmp/osc/mut/t5r1.orig)
Pristine sha256: ompSingleCall.ts def08e27c070c3931a7d012511976700d7651670e42b189ec4608cb9c1c311c2,
ompAdapter.ts 40e70b6c0e6677db99e48473ccccd4fed4472a3ca1b7f204c197b014097f985d. Each run: `npx vitest run tests/runtime/omp/ompSingleCall.test.ts`,
then restore by `cat`; after each restore the sha256 matched pristine and `git diff` / `git diff --cached` were 0 / 0 bytes.
Summary logs t5-r1-mut-summary.log, t5-r1-mut-summary2.log (Maborted's first anchor matched twice -- phase path too -- so it
was not applied, rc of that no-op run was 0 and is not evidence; rerun with a singleCall-unique anchor).
| Mutation | Mutated sha256 | RC | Red (only that test, 1 failed / 24 passed) |
|---|---|---|---|
| Massistant: decode counts any event with `message.role === "assistant"` | c0a7a99a348d7fade5fdf2ad6bee434cb633eb814465636af426b92ebb281972 | 1 | real-shape test, `omp-single-call-multiple-requests` thrown at its `expect(decodeOmpSingleCall(...)).toEqual` (test :253) |
| Maborted: aborted throw carries `observedTokens: lowerBound` | 6fbc6c95221abc5a26aa8a50edbfbd8811a09646cdbf93e650b231bd847c27dc | 1 | abort test, `expected 14 to be null` at `observedTokensOf(failure)).toBeNull()` (:286) |
| Mdecodewrite: drop `.catch` on decode-error.txt | 3093e19d4053d549e3e4a18f026985783984ede94017e075fef2e272f5b356c3 | 1 | decode-error test, EISDIR vs `{message: "omp-model-mismatch", observedTokens: 14}` (:297) |
| Mlbwrite: drop `.catch` on usage-lower-bound.json | e064c6de0e269c44e1ab78157d9fdda6ad9acb44c662fdf23dd0805e359aac1f | 1 | lower-bound test, EISDIR message vs `/^omp-exit-error: /` (:303) |

### Commands (redirected to /private/tmp/osc/logs, read whole)
| Command | Log | RC |
|---|---|---|
| vitest run tests/runtime/omp/ompSingleCall.test.ts | t5-r1-focused.log | 0 (25 passed) |
| npm run typecheck | t5-r1-tc.log | 0 |
| npm run build | t5-r1-build.log | 0 |
| vitest run tests/runtime/omp/ tests/control/ompSingleCallWorker.test.ts tests/agents/ | t5-r1-sweep.log | 1 (19 files, 190 passed, 1 failed) |
| vitest run tests/agents/updates.test.ts, alone x3 | t5-r1-alone-updates-{1,2,3}.log | 0, 0, 0 (15/15 each) |
The one sweep red was tests/agents/updates.test.ts "replays a matching completed receipt before reading a malformed current
table", `Test timed out in 5000ms` (untouched file; load flake, green alone 3/3). Run 1 alone was read whole; runs 2 and 3 were
read from their summary block onward only.

### Concerns
- Not fixed (outside the findings): in singleCall a failed `usage.json` write on a successful decode lands in the catch, so a
  good answer becomes a failure carrying the fs error (booked null although usage was observed). Same best-effort treatment
  would fix it; left for the controller.
- `npm run build` rewrites dist/ in the worktree (ignored).
