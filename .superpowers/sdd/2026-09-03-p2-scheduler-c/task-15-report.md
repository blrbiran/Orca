# Task 15 report: wrap-up — mutation re-run, verify tiering, ledger, README

All mutation and verification runs below happened against commit `edd6e49`
(the state Task 15 started from) and the final commit is `366ed92`. All
mutations ran inside a single `git clone --local` copy at
`<scratchpad>/orca-mutate`, cloned from `edd6e49`, with `node_modules`
symlinked from the main tree and `ORCA_CCLOOP_BIN` pointed at the sibling
ccloop's `dist/cli.js`. The main worktree was never touched during mutation
— see the restoration proof in §1.9.

## 1. Mutation table (§10.3's 14, plus the two added this round)

| Mutation | Scenario/criterion fed | Criterion seen red | Output file |
|---|---|---|---|
| `M-LOCK` | S21 | `S21: a second orca on the same target repo fails loudly` (`rejects.toThrow` on line 14) AND `S21: with the lock held, a second orca run never enters W` (line 39, `refSha(...)` must be null) | `p2-mut-M-LOCK.txt` |
| `M-DIRTY` | S22 | `S22: a dirty target worktree is rejected up front` — `expected [] to include 'dirty-worktree'` | `p2-mut-M-DIRTY.txt` |
| `M-ID` | S15 | `S15: running the same plan twice allocates a fresh id instead of colliding` and `steps past a directory left behind by a crashed earlier run` — both throw the raw `EEXIST` instead of retrying | `p2-mut-M-ID.txt` |
| `M-TRIE` | pathTrie.test.ts | `does not confuse a sibling whose name is a string prefix` — `expected [{kind:'new-inside-old',...}] to deeply equal []` | `p2-mut-M-TRIE.txt` |
| `M-OPT` | S3 | All 4 of S3's criteria go red, most tellingly `lands a merge commit whose first parent is the W tip and whose tree is the reconciled one` (`expected [] to have a length of 1 but got +0`) and `the conflicted commit never reaches W` (`expected 0 to be greater than 0`) — T2's entire result is silently dropped from W while the round still reports exit 2 | `p2-mut-M-OPT.txt` |
| `M-RECON` | S20 | Both S20 criteria — `S20: a reconciliation contract that names only one side's taskId is refused, and the run escalates` and the execution-budget variant — `expected false to be true` on `"escalate" in r` | `p2-mut-M-RECON.txt` |
| `M-EMPTYCHK` | S4 | `S4: an empty requiredChecks union refuses automatic reconciliation and escalates` — `expected false to be true` | `p2-mut-M-EMPTYCHK.txt` |
| `M-TREE` | S3 + reconcile.test.ts | `lands a merge commit whose first parent is the W tip and whose tree is the reconciled one`, `the bound line is blamed to the merge commit itself, not to the commit after it` (both S3), and `rebuilds a merge commit whose two parents are exactly the W tip and the incoming ref` (reconcile.test.ts) — content is right, parent ORDER is swapped, so `git log --first-parent` walks into the wrong branch | `p2-mut-M-TREE.txt` |
| `M-A1` | S7 | `S7: out-of-bounds writes that intersect a sibling in the same layer refuse to land and escalate` — `expected true to be false` on `d.land` | `p2-mut-M-A1.txt` |
| `M-A2` | S7 | Same two S7 criteria as `M-A1`, same observable result (`land:true`/exit 2) — by design: the intersect check and the whole tier are the only difference between the two mutations, so they converge on the same output | `p2-mut-M-A2.txt` |
| `M-B1` | S5 | `S5: a task ccloop calls succeeded but whose tree equals the base does not land` — `expected true to be false` on `d.land` | `p2-mut-M-B1.txt` |
| `M-C` | S5 + S6 + S7 + harvest.test.ts | 8 of 8 red across all four files (harvest returns a neutral "nothing measured, nothing empty" and disposition always lands at exit 0) | `p2-mut-M-C.txt` |
| `M-BOUND` | S3 | Exactly 1 of 5 red: `the bound line is blamed to the merge commit itself, not to the commit after it` — `git blame` names the NEXT commit, not the merge; the other 3 S3 criteria (content, both files land, exit 2) stay green | `p2-mut-M-BOUND.txt` |
| `M-MAIN` | S14 | `S14: a whole run leaves the default branch's ref byte-identical` — line 33's ref-sha assertion, `expected '71ea0a...' to be '6d055f...'` (the round's own exception handler catches the resulting crash and reports exit 3, but the ref assertion — which runs BEFORE the exit-code check — is what reddens, exactly as `f845305`'s earlier fix intended) | `p2-mut-M-MAIN.txt` |
| `M-PLAN-WIRE` (added) | `emptyRequiredChecksWarning.test.ts` | `prints the escalation warning through the real plan path, not a hand-built fixture` — `expected '...' to contain 'T1 x T2'` (and `'would escalate'`) | `p2-mut-M-PLAN-WIRE.txt` |
| `M-EXIT-RETURN` (added) | `roundFailure.test.ts` (both EACCES and ccloop-bin-not-found variants) | `expect(captured.result).toBe(3)` — `expected 2 to be 3` on BOTH exception-path tests, while `stdout`/`stderr` assertions in the same tests stay green, confirming this reddens the exit-code half independently of the rest of the catch block | `p2-mut-M-EXIT-RETURN.txt` |

Every row above names a criterion that was actually seen red; none crashed
before its own assertion could run (the one historical case where that
happened — `M-MAIN`'s first attempt, task 10 — was already fixed in
`f845305` and confirmed still fixed here).

### 1.9 Restoration proof

```
$ shasum -a 256 <9 mutated files> > pristine.sha256      (before any mutation)
$ shasum -a 256 <9 mutated files> > post-mutation.sha256 (after all 16, clone still present)
$ diff pristine.sha256 post-mutation.sha256              → exit 0, no output
$ git status --porcelain                                  → only `?? node_modules` (the symlink)
$ git diff | wc -c                                        → 0
$ git diff --cached | wc -c                                → 0
```
The clone was then torn down per Rule 15/G8: `/bin/rm -f node_modules`
(unlink the symlink) then `/bin/rm -rf <clone>`. The main worktree's
`git status --short` was empty both before and after the whole exercise.

## 2. `verify` timing and tiering decision

```
$ /usr/bin/time -p npm run verify > p2-verify-time.txt 2>&1; echo "RC=$?"
...
Test Files  42 passed (42)
     Tests  141 passed (141)
real 23.29
user 66.96
sys 74.10
RC=0
```
(The overall `npm test` step inside the same run reported `Test Files 49
passed (49)`.)

**Tiering decision: no new tier needed.** `npm run verify` (23.29s wall) is
not on the pre-commit hook at all — `scripts/githooks/pre-commit` only runs
`check-claude-md-lines.mjs` (cheap) and, when a commit's staged diff touches
`.decisions/**`, `check-append-only` plus `ledger validate` against exactly
that diff and directory. Those two ledger checks run in well under a second
regardless of how large the scheduler suite grows, because they operate on
the diff and on `.decisions/` only, never on `tests/scheduler/**`. The
tiering §10.1 asks for already exists structurally: the pre-commit hook is
the fast gate, and `npm run verify` is the full gate a person or CI runs
before trusting a round — it does not need a `verify:fast` sibling because
it was never wired onto the thing that has to stay fast.

## 3. `undoHowIsExecutable` audit

Run once, mechanically, over all ten drafted `undo.how` strings before any
`appendEvent` call:

```
1. PASS  src/scheduler/ccloopRunner.ts: 把 spawn 换成 import ccloop 的 dist/cli.js 导出函数，并在 package.json 加 ccloop 依赖
2. PASS  src/scheduler/runId.ts: 删掉 deriveRunId 与 allocateRunId 的区分，把 run-id 直接固定成 taskId 本身
3. PASS  src/scheduler/ccloopRunner.ts: 把读取 loop-state.json 的 status 那步删掉，改回只判子进程退出码是否为 0
4. PASS  src/scheduler/graph.ts: 把 while 循环里【每步取全部零入度任务】改回【每步只取一个，且已出现过 ** 边的分量此后强制一个个来】
5. PASS  src/scheduler/writeSet.ts: 把 normalizeClaim 里 posix.normalize(prefix) 换回不做归一化的 prefix 原样返回
6. PASS  src/scheduler/ledgerWiring.ts: 把 reconcileDecision/boundaryDecision 生成的 question/chose/because 改回中文
7. PASS  tests/scheduler/scenarios/S3.test.ts: 把 expect(rc).toBe(2) 改回 expect(rc).toBe(0)
8. PASS  src/scheduler/ledgerWiring.ts: 把 writeEscalationFile 与 escalationFilePath 移出 exitCode.ts 所在的模块边界，单独拆成 escalation.ts
9. PASS  src/scheduler/run.ts: 在 route.escalates 分支里加一次 writeEscalationFile 调用，sides 留空数组，conflictBlocks 留空数组
10. PASS  给 .decisions/orca-dev-c2fd0c3b.jsonl 每一条决策重新推算并回填各自的真实 at 时刻

ALL PASS
RC=0
```
All ten passed the predicate on the first pass — no rewrite round was
needed (contrast the brief's "prior round 10 of 14 failed" measured fact;
every `undo.how` here was drafted with a concrete file path or command
already in mind, which is what the predicate's `NAMED_TARGET`/command-shape
checks look for).

## 4. Decisions written

`.decisions/orca-dev-c2fd0c3b.jsonl`, ten decisions, all through `appendEvent`
(none hand-written), all validated on write and again by `npm run ledger --
validate .decisions` afterward (clean except the seven pre-existing,
by-design `orca-dev-09cc3ea1.jsonl` downgrades):

| id | kind | scope | question (short) |
|---|---|---|---|
| `orca-dev-c2fd0c3b/1` | dependency | cross-repo | spawn subprocess vs. A′ §9.1's npm dependency |
| `orca-dev-c2fd0c3b/2` | interface | cross-repo | two-layer identity as a clarification of A′ §3.0 |
| `orca-dev-c2fd0c3b/3` | criteria | cross-repo | §1.2 rule 4's "exit code only" correction (§6.0 measurement) |
| `orca-dev-c2fd0c3b/4` | criteria | repo | batched Kahn layering vs. the plan's over-read `**` criterion |
| `orca-dev-c2fd0c3b/5` | interface | file | `.`/`..` resolution in claim normalisation |
| `orca-dev-c2fd0c3b/6` | boundary | cross-repo | runtime ledger prose (English) vs. Orca's own dev ledger (Chinese) |
| `orca-dev-c2fd0c3b/7` | criteria | task | S3 asserts exit 2, not the spec table's exit 0 |
| `orca-dev-c2fd0c3b/8` | interface | task | §5.4's escalation file assigned to the exit-code task |
| `orca-dev-c2fd0c3b/9` | boundary | task | `blocked_waiting_human` gets no escalation file |
| `orca-dev-c2fd0c3b/10` | criteria | file | this file's `at` field is one batch-backfilled timestamp (repo convention) |

Decisions 1–3 are the brief's three named spec deviations; 4–9 are the six
controller rulings named in this task's instructions; 10 follows the
convention every prior `.decisions/orca-dev-*.jsonl` file in this repo has
used for its own closing entry. The plan's own six P2-specific decisions
were already recorded earlier, as `orca-dev-10762e47/11`–`/16` (task order,
repo-lock primitive, `M-C`'s expression, implementation-detail level,
`ledgerMode: out-of-repo`'s scope, and the `at`-field convention for that
file) — they were not duplicated here.

## 5. README section

`README.md` did not exist anywhere in this repository's history (`git log
--all -- README.md` and `--diff-filter=A -- '*README*'` both empty) — the
brief's "English, like the rest of the README" assumed one already existed.
Treated as reversible (Rule 1's ladder): created `README.md` at the repo
root rather than escalating. Its contents:

- An overview paragraph naming Orca as subsystem C.
- `orca plan` / `orca run` usage (flags, what each prints, what `--serial`
  and `--keep-workdirs` do).
- The plan file's shape (every field, with `ledgerMode: out-of-repo`'s
  accepted-but-rejected-at-runtime status called out explicitly).
- The nine up-front rejections, split into the six plan-level codes and the
  three runtime codes, plus a note that `malformed` is a zeroth case, not
  one of the nine.
- Exit codes 0/1/2/3, each with what contributes to it.
- The escalation file's location, its content order, and the
  `blocked_waiting_human` exception (no file at all).
- The spec's twelve known gaps (§10.4), translated in full — not
  paraphrased down — one bullet per gap.
- A short closing note on `npm run verify` vs. the pre-commit hook, tying
  back to the Step 2 tiering decision.

## 6. Final verification

```
$ npm run verify > p2-final.txt 2>&1; echo "VERIFY_RC=$?"
...
Test Files  49 passed (49)        (whole-repo `npm test`)
...
.decisions/orca-dev-09cc3ea1.jsonl:8-14: downgraded to tier 0: taskId: Required; runId: Required   (7 lines, known, by design)
...
Test Files  42 passed (42)
     Tests  141 passed (141)      (verify:scheduler)
VERIFY_RC=0
```
`/usr/bin/git status --short` in Orca: clean before the commit except the
two new files (`README.md`, `.decisions/orca-dev-c2fd0c3b.jsonl`); clean
after. ccloop: `git status --short` empty throughout, `HEAD` unchanged at
`7f2c5f6` the entire session.

## 7. Files changed

- `README.md` (new)
- `.decisions/orca-dev-c2fd0c3b.jsonl` (new, 10 decisions, via `appendEvent`)

No `src/`, `tests/`, or `scripts/` file was touched — Task 15 is
documentation- and ledger-only, and every mutation ran and was reverted
inside a disposable clone.

## 8. Self-review findings

- Checked every mutation's target location against the CURRENT file (not
  against the historical patches from tasks 3/6/7/9/10/11/12) before
  applying it — all nine touched files (`harvest.ts`, `pathTrie.ts`,
  `writeSet.ts`, `repoLock.ts`, `preflight.ts`, `runId.ts`, `reconcile.ts`,
  `run.ts`, `land.ts`) were byte-for-byte the same at the relevant
  functions as when the original mutation was designed, so no patch needed
  adaptation beyond confirming line numbers.
- Checked `M-A1`/`M-A2`'s converging result against the historical record
  before treating it as a bug: task 9's report already registered this as
  "not two independent pieces of evidence," and the re-run reproduces the
  same convergence for the same reason (the intersect check and the tier
  boundary are the only difference between the two mutations).
- Checked that `M-EXIT-RETURN` reddens the exit-code assertion specifically,
  not the whole test, by confirming `stdout`/`stderr` assertions in the same
  two tests stayed green while only `expect(captured.result).toBe(3)` failed
  — this is the exact gap the brief named (the mutation that used to exist,
  `M-CATCH`, killed the whole `catch` block and reddened on an earlier
  assertion, so the exit-code line itself was never independently proven).
- Checked `M-PLAN-WIRE` reddens through the CLI's real `plan` path (not a
  unit test of `emptyRequiredChecksPairs` in isolation) — the criterion it
  feeds, `emptyRequiredChecksWarning.test.ts`, calls `runCli(["plan", ...])`
  end to end.
- Re-read the full `route.escalates` branch in `run.ts` before drafting
  decision 9 (`blocked_waiting_human` gets no escalation file) to confirm by
  inspection, not assumption, that `writeEscalationFile` is genuinely never
  called on that branch.
- Confirmed decision 7 (S3 exit 2 vs. spec's exit 0) against the actual
  assertion in `tests/scheduler/scenarios/S3.test.ts:92`
  (`expect(rc).toBe(2)`), not against a paraphrase of it.
- Confirmed the "this plan's own six decisions" the brief refers to are
  already on the ledger (`orca-dev-10762e47/11`–`/16`) rather than assuming
  they needed to be re-written here — re-reading them side by side with the
  brief's Step 3 wording resolved what would otherwise have been a 6-vs-9
  ambiguity in "how many decisions go in this file."
- Verified no Chinese characters leaked into `README.md` with a CJK-range
  regex scan (0 matches) — per CLAUDE.md, README-class documentation is
  English.

## 9. Concerns

- `README.md` is a new file with no prior version to match conventions
  against; a maintainer familiar with a different Orca README this session
  never saw could reasonably want a different shape. Flagged rather than
  hidden (see §5).
- The "no new tier needed" conclusion in §2 rests on the pre-commit hook's
  current content, which this task read but did not modify — if a future
  task widens what the hook runs to include `npm test` or `verify:scheduler`
  directly, this tiering decision should be revisited against the new
  timing.
