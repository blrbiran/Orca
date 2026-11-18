# Repair attempt: a retry after `required-check-failed` starts from the failed attempt's change (#321 B)

> **Status (Orca session ca534c51, 2026-11-18):** NOT BUILT — waiting for the human: two existing ccloop criteria change (protocol4.test.ts:13, savedResultEvidence.test.ts:112) and ccloop rule 88 needs each approved by name; also the open question below (re-check weakened tests at landing).

Written by a subagent of Orca session 2026-11-18 (the second Orca session of that day), on 2026-11-18, read-only.
Against: Orca `main` `6f597477`, ccloop `main` `0f475e8` (Orca's `package.json` pins ccloop `dd491c1`, one commit behind);
#346 read on `feat/off-plan-writes-346` `9209fa08`, #341 L3 read on the `pre-341` worktree `a45ac0c8`.
Status: **design only, cross-repo; nothing is built.** The ccloop half needs the human's per-criterion approval (§7).

## 1. Problem

Tester #321, `T8` (`orca_archived_files/issue-20261023.md` lines 1027-1094): run 2 ended `required-check-failed`, run 3
started over from the base, re-planned and re-wrote nearly the same change. Runs 2 and 3 used 3,463,512 + 3,752,184 tokens
(tool-reported). Cause A of #321 (allowlist miss) is removed by #346; cause B is this design.

Code facts (ccloop `0f475e8` unless marked Orca):
- Every attempt gets a fresh worktree at `repoPath`'s HEAD: `createAttemptWorkspace` (`src/workspace/worktreeManager.ts:19`,
  called at `src/controller/runLoop.ts:1948`). Attempt 1 alone may instead be materialized from a continuation bundle.
- After an attempt, its tree is committed with parent = the worktree's start and pinned at
  `refs/ccloop/<runDir basename>/attempts/<n>` (for control runs `refs/ccloop/run/attempts/<n>`, overwritten by later
  runs) and at `refs/ccloop/<claim runId>/attempts/<n>` (`publishAttemptCommit`, same file).
- The next attempt sees only text: `lastFailure` inside a run, the envelope's `priorFailures` across runs
  (`runLoop.ts:1744-1765`). Inside a run, `evaluateStopDecision` allows attempt 1 -> 2 only (`src/stop/stopController.ts:89`).
- Orca: each retry is a new ccloop run (`executionDriver.ts` step A2). The failed run's workspace is removed; its work
  survives as Orca's archive snapshot (`acceptAttempt.ts:58` `latestRunSnapshot`), which `task accept-attempt` already
  rebuilds into a commit (`acceptAttemptDriver.ts:312` `restoreSnapshotAttempt`). Orca reaches ccloop only through the
  control start envelope (`accept`; `work` validated `.strict()`, ccloop `src/control/protocol.ts:300,339,348`).

A "verify-only rerun" cannot turn a deterministic red check green; the attempt's change has to change.

## 2. Decisions (each: why / cost if wrong)

D1. **A repair attempt** starts from the previous attempt's tree, skips plan, gets the failing command and its output
tail as execute input; verify runs as usual. Why: the plan and most of the change were right; only the delta to green is
missing. Cost if wrong: one attempt anchored on a bad approach, bounded by D4.

D2. **The worktree HEAD stays at the run's base; the source tree is laid over it as uncommitted changes**
(`git read-tree -u --reset <source>` then `git reset -q`). Why: every HEAD-relative reader keeps its meaning (path policy
observation, task-result `git status`, omp `worktreeSnapshot`, `AttemptCommit.base` = parent, Orca's harvest from
`drive.base`), so the repair's result is the whole task change and is judged whole. Cost if wrong (source committed as
HEAD instead): inherited paths escape the path policy and the commit chain grows a ccloop-authored link.

D3. **The option lives in the envelope's `work`, not in `loop-contract.json`.** The controller said "contract option";
the contract is Orca's frozen, hashed task contract (`contractHash`, loop plan versions), and a retry-time choice there
would move every contract hash and golden. `work` already carries per-run inputs (`priorFailures`, `operatorNote`,
`handoff`), each optional so an envelope without it parses and hashes as before. Cost if wrong: none for compatibility;
a later per-task policy would still belong in the contract.

D4. **Bounds**: at most one repair per lineage. A repair attempt that fails verify sends the next attempt (inside the run
or Orca's next run) back to the base with a plan. Why: a second repair compounds anchoring. Cost if wrong: one extra
from-base attempt where a second repair would have sufficed.

D5. **Ownership**: ccloop owns workspace and phase sequence, Orca decides when to ask (by code, Rule 5) and freezes the
decision in the envelope at A2, as `priorFailures` is. ccloop never learns why Orca chose.

D6. **Accounting**: a repair attempt is an attempt (`consumeAttemptBudget` unchanged); same token, time and attempt
limits; no grant of its own; no plan-phase usage is settled because none runs.

D7. **From-base is the fallback**, never an error, except a seed that fails ccloop's own check (§3.4), which is a bug and
fails loud before any agent runs.

## 3. ccloop contract change

### 3.1 Schema (`work`, protocol 4 only; optional)

```ts
repair?: {
  redAtBase: string[];            // 0..16 commands, each 1..4096 UTF-8 bytes: Orca's base check said red at this base
  seed?: {                        // attempt 1 is a repair of this commit
    sourceRunId: Id; sourceAttempt: PositiveInt;
    commit: Oid;                  // present in repoPath's object store
    failingCommand: string;       // 1..4096 bytes
    outputTail: string[];         // 1..16 entries, each 1..4096 bytes, tail-cut with a leading "…[N bytes omitted]"
  };
}
```
Presence of `repair` permits ccloop's own in-run repair (§3.2 b); `seed` makes attempt 1 a repair (§3.2 a). Refinements:
refused beside `mode: "verify-saved-result"`, beside a non-null `inputCheckpoint`, and beside `work.additionalRepos`
(multi-repo is a v1 non-goal). `features` answers `repairAttempt: "v1"` (`src/control/command.ts:317,369`).

### 3.2 Phase sequence of a repair attempt

Entered (a) for attempt 1 when `seed` is present, or (b) for attempt k+1 when `repair` is present, no repair has run in
this run, the stop decision after attempt k was `retryable` (rules unchanged), attempt k's verification was
`required-check-failed` with a non-null `failingCommand` not in `redAtBase`, its published commit exists, and
`base..commit` is non-empty. Otherwise the attempt is today's attempt, byte for byte.

1. Worktree at HEAD (base) as today; lay the source tree (D2); check `git diff --name-only HEAD` (plus untracked) equals
   the source's path set. Event `repair_started {attempt, sourceRunId?, sourceAttempt, sourceCommit, failingCommand}`.
2. `consumeAttemptBudget`; setup commands where they run today.
3. No plan call. The attempt's plan artifact is code-built: `{summary: "Repair: the worktree holds attempt <n>'s change; required check <cmd> failed. Change what makes it pass without weakening, skipping or deleting any check.", primaryTargetPaths: <source paths, first 64>, origin: "repair"}` (the
   allowance continuation's `nextPhase: "execute"` path already runs execute without a plan call).
4. Execute with `AttemptContext.repair = {failingCommand, outputTail, sourceAttempt}`; `buildExecutorPrompt` adds a
   repair block after `lastFailureLines` (all three adapters use it). Absent `repair`, prompt bytes are unchanged.
5. Path policy on the union of reported files and `base..worktree` observed paths, so inherited paths are judged under
   this run's contract (the denylist #346 freezes included).
6. Verify, publish, stop decision: unchanged. `loop-state.json` gains optional `repairs: [{attempt, sourceCommit}]` so a
   crash resume does not re-plan and `collect` reports which attempt was a repair.

In-run source (b): attempt k's commit as `publishAttemptCommit` returned it; outputTail from attempt k's verification
evidence entry for the failing command.

### 3.3 Bounds

One repair per run (a seeded attempt 1 uses it). No repair for a command in `redAtBase`. Same `executeTimeoutMs`,
token threshold and live ceiling as any execute.

### 3.4 Failure modes

| Case | Result |
|---|---|
| `seed.commit` missing, base not its ancestor, or its tree equals base's | `accept` refuses `control-repair-seed-invalid`; nothing runs, no attempt spent |
| In-run source unpublished (best-effort cleanup failed) or empty | attempt k+1 from base with plan; event `repair_skipped {reason}` |
| `read-tree` / path-set check fails | the existing workspace infra retry, then `blocked_waiting_human` `workspace unavailable` |
| Inherited path hits the denylist | `blocked_waiting_human` `denylist match`, as any attempt |
| Repair fails verify (same command) | existing repeated-failure stop `exhausted`; Orca's next run is from base |
| Handoff / token-allowance park during repair | checkpoint as today; the continuation carries the code-built plan; no new `repair` (refused beside `inputCheckpoint`) |

## 4. Orca side

**When it asks** (one pure function `repairDecision`, at A2, frozen in the envelope): seed only when all hold, else a
from-base reason:
`not-required-check-failed` (predecessor's `lastFailure`), `could-not-run` (ladderSkip's own test), `red-at-base`
(#341 L3 row `red` for (repo, group base, command)), `repair-already-failed` (predecessor's envelope had `repair.seed`
or its collect reports a repair attempt), `path-policy-stop` (incl. #346 `parallel-claim`), `contract-changed`
(confirmed contract hash differs from the predecessor's: `--after`, narrow-path, allowance), `snapshot-unusable`
(`prepareAcceptAttempt`'s checks), `empty-diff` or `out-of-bounds` (harvest from the predecessor's base),
`criteria-changed` (`classifyCriteriaChange`), `multi-dir`, `continuation`, `ccloop-unsupported` (features lack
`repairAttempt`), `person-chose-from-base`.
When seeding: rebuild with `restoreSnapshotAttempt`, fetch into the run's workspace repo as `refs/orca/repair/<runId>`
(deleted by `cleanupRunWorkspace`), keep the predecessor's base (the continuation precedent; D lands onto the tip as
today), `failingCommand`/`outputTail` from `readStoredRejection`. Every run that carries `repair` also gets
`redAtBase` = the L3 rows answered `red` at its base (a `pending` row is not red: cost, at most one wasted repair).

**#341 L3**: a command red at the base is never repaired: no seed (`red-at-base`), and in-run ccloop skips it via
`redAtBase`. The run still carries the L3 evidence line in `priorFailures` and the L2/L3 problem row, unchanged.
**#346**: a `parallel-claim` stop is not `required-check-failed`; its `--after` retry (person or `orca-auto`) is from
base, and the amended contract alone would make it `contract-changed`. Off-plan writes in a seed are inherited and judged
again by ccloop (§3.2 step 5); W3's `off-plan-write` record reads the landed commit from base, unchanged.

**What the person sees** (en below; zh strings by the builder):
- Activity `repair-attempt {taskId, runId, sourceRunId, sourceAttempt, failingCommand}` or `repair-skipped {taskId,
  runId, reason}`.
- Task view and `task show`: `Attempt 3/3 · repairs attempt 2 (run-0261f50f): starts from its change, no planning, fixes `npm test``
  or `Attempt 3/3 · from the base: <reason>` (e.g. ``npm test` already failed at the group's base``).
- CLI: `orca task retry <g> <T>` prints which of the two it will do; `--from-base` forces a fresh start. Ladder level 1
  (`orca-auto`) uses the same decision.
- Web: on a `required-check-failed` problem row, primary "Retry as repair", secondary "Retry from base"; when not
  eligible, the single "Retry" with the reason beside it.

## 5. Versioning and compatibility

| Side | Changes | Bumps |
|---|---|---|
| ccloop | optional `work.repair`; `features.repairAttempt: "v1"`; optional `loop-state.repairs`; `collect` reports the repair | none: protocol stays 4, package unversioned (ruling S7); envelopes without `repair` keep bytes and hashes |
| Orca | `featuresSchema` and `startEnvelopeSchema` gain the optional keys; `repairDecision`; drive-record field; CLI flag; Web | `package.json` ccloop pin to the ccloop commit that ships it; no loop plan version (contracts unchanged) |

- New Orca, old ccloop (old pin or `ORCA_CCLOOP_BIN`): no `repairAttempt` -> never sends `repair`; reason
  `ccloop-unsupported`; today's behaviour. `requireFeatures` refuses an envelope with `repair` to such a ccloop
  (`control-repair-unsupported`) as a guard.
- Old Orca, new ccloop (override only): Orca's strict `featuresSchema` (`ccloopPort.ts:254`) rejects the new key, as it
  did for `transcripts`; the pin prevents it. Orca's change and its re-pin land in one commit (the `f4de340` precedent).

## 6. Tests (each: the mutation that must turn it red)

ccloop (all new; existing ones untouched except §7):
1. Envelope with `repair` parses; an existing v4 fixture's canonical hash is unchanged. *Mutation*: make `repair`
   required or rename a key.
2. `seed` beside `mode`, `inputCheckpoint`, `additionalRepos` refused. *Mutation*: drop each refine (one at a time).
3. Seeded run: attempt-1 worktree HEAD == base, `git status` lists the seed's paths, plan adapter never called, execute
   context carries `repair`, verify runs. *Mutation*: create the worktree at the seed commit; call plan.
4. Seed touching a denylisted path stops `denylist match`. *Mutation*: judge reported files only.
5. In-run: attempt 1 `required-check-failed` -> attempt 2 starts with attempt 1's tree, no plan. *Mutation*: drop step (b).
6. Seeded attempt 1 fails -> attempt 2 is from base with a plan. *Mutation*: drop the one-repair bound.
7. `failingCommand` in `redAtBase` -> attempt 2 from base. *Mutation*: ignore `redAtBase`.
8. Empty source diff / unpublished source -> from base + `repair_skipped`. *Mutation*: drop the emptiness check.
9. Repair attempt commit's parent == base; attempts used +1. *Mutation*: skip `consumeAttemptBudget` for repair.
10. Executor prompt with `repair` has the block; without it the bytes equal today's. *Mutation*: render the block always.
11. `accept` with a seed commit absent / not descending from base / tree-equal -> `control-repair-seed-invalid`.
    *Mutation*: drop the ancestry check.
12. Crash after `repair_started` resumes without a plan call. *Mutation*: omit `repairs` from loop-state.

Orca:
1. `repairDecision` table: one row per reason plus the eligible row. *Mutation*: delete each guard (each row must red).
2. A2 envelope: seed present after `required-check-failed`; absent with `--from-base`; absent with a fake port lacking
   `repairAttempt` and reason `ccloop-unsupported`. *Mutation*: ignore the feature flag.
3. L3: `red` row -> no seed and command in `redAtBase`; `pending` -> seed. *Mutation*: treat pending as red / ignore red.
4. Predecessor was a repair -> from base. *Mutation*: drop `repair-already-failed`.
5. #346: `parallel-claim` stop, then `--after` -> from base. *Mutation*: seed from a path-policy stop.
6. Real ccloop E2E (`ORCA_CCLOOP_BIN` = ccloop source build, scripted agent): run 1 writes `a.txt`, check `test -f
   b.txt` red; retry repairs, agent writes only `b.txt`; landed tree has both. *Mutation*: omit the seed (landing lacks `a.txt`).
7. Accounting: the repair run consumes one task attempt; after it the task has 0 attempts left. *Mutation*: grant it apart.
8. `features` with and without `repairAttempt` parses (extend `ccloopTranscriptsSchema`-style test). CLI/Web strings.

## 7. Existing ccloop criteria that would change (per-criterion approval, ccloop Rule 15 / 人裁 88)

Only two; both pin the exact `features` answer and would gain `repairAttempt: "v1"` (whole-line rewrite, not a loosening):
1. `tests/control/protocol4.test.ts:13`, in `it("negotiates implemented recovery independently of core capabilities")`.
2. `tests/control/savedResultEvidence.test.ts:112` (the `features` `toEqual` line).
`tests/control/collectTranscripts.test.ts:48` uses `toMatchObject` and is unaffected. Everything else is add-only because
`repair` is opt-in; if the human declines both, the fallback is no feature flag and Orca gating on its pin alone (an old
ccloop would then refuse `repair` at `accept` with `control-request-invalid` instead of degrading). Line numbers measured
at ccloop `0f475e8` with `grep -rn "transcripts: *[\"']v1" tests`.

## 8. Non-goals

#321 A (allowlist; #346) and C (per-task cost hints); multi-repo repair; a repair inside a continuation; changing stop
rules (`attemptNumber > 1` still blocks in-run); any "verify only" rerun; rebasing the seed onto the moved group tip;
a review-prompt fact for repaired landings.

## 9. Open risks

- Anchoring: the repair keeps a wrong approach. Bound: one repair, then from base.
- Weakening the check: the prompt forbids it and Orca refuses a `criteria-changed` seed, but the repair's own result is
  checked only by verify and review (normal landings do not run `classifyCriteriaChange`). The human may want it there.
- In-run repair changes attempt 2 of every first run that carries `repair`; savings are unmeasured. Acceptance should
  compare tool-reported tokens on a dogfood group (Rule 14: no estimate is given here).
- A stale base: the seed keeps the predecessor's base; a moved tip means a merge at landing, as for continuations.
- Orca's strict `featuresSchema` keeps the old-Orca/new-ccloop direction breaking on every new feature key; out of scope.
