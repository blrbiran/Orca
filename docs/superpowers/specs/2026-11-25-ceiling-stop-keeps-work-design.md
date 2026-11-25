# A live-ceiling stop keeps its paid work — design

Status: **approved direction (human, 2026-11-25, session `5d3d0c09`: "同意这个方案，可以写spec，然后派独立subagent review，修复
review问题后写plan并实现"). Revised after the independent review (§9).** Tester issue: #478 (ledger
`orca_archived_files/issue-20261023.md`). Related: #431 (`2026-11-24-zero-change-spend-design.md`; its approach B is
superseded by this document for runs stopped at a ceiling), #479, tester follow-up G spec (live ceiling §2.1/§2.5), the
token-policy allowance park (protocol 4), reviewed acceptance (spec 2026-11-11 §7, 2026-11-16 ceiling branch).
Repositories: ccloop (producer) and Orca (consumer). Cross-repo rule (handoff §五): the fix goes on the side that produces
the observation — the stop's evidence changes in ccloop; Orca adapts its intake.

## 1. What the tester saw

A codex task in a group with a 3M limit: plan spent 1,321,575 tokens; execute wrote two files and ran the task's own tests
green (15/15 at the end of the transcript), and was then stopped mid-call at the live ceiling (2,357,487 used against
2,334,682, cause `group`). Result: `settled-recoverable`/`exhausted`, checkpoint `result:"partial"` with
`missing:["attempts/1/execution.json","attempts/1/verify.json"]`, `recoverable:false`, the workspace removed,
`task retry --as-person` refused, `recovery retry` a silent no-op, no `next:` line. Raising the limit re-claimed the task
**from scratch**, re-paying the plan. 2,973,063 tokens over two attempts bought nothing visible.

## 2. How it works today (verified in code: Orca main after `fddffd41`; ccloop `276114a` = `4a66656` for code)

- **The work is not physically lost.** ccloop records the attempt as a commit (`recordAttemptEnd`, temporary index,
  untracked files included — `ccloop/src/control/attemptRecord.ts`). At a ceiling stop Orca's `settleCeilingStop`
  (`src/control/executionDriver.ts`) archives the run (`archiveDriveRun` → `archiveRunV2`), pins the attempt as
  `refs/orca/runs/<runId>` in the target repository and records a complete tree snapshot; an incomplete archive would have
  blocked the run at C (`live-ceiling-snapshot-incomplete`). "The workspace is empty" is Orca dropping its result copy.
- **A continuation restores that tree.** `materializeSnapshotV2` (`ccloop/src/control/materialize.ts`) checks out the attempt
  commit and `reset --mixed` to its head: HEAD plus the dirty tree (v1 uses `restoreTree`/`restoreIndex`).
- **Orca already means a ceiling stop to be continuable.** `classifyCeilingStop` (`usagePause.ts`) sets
  `allowancePredecessorRunId`, `fundingReleased`, the group status, syncs the reserve, and for cause `group` auto-continues at
  ≥ `AUTO_CONTINUE_MIN_TOKENS` (1M) headroom or waits as `groupCapStop`; cause `pause-line` waits as `usagePause`. The live
  ceiling's causes are only `group | pause-line | task-cap` (`spend-cap` is a token-policy binding cause, not a ceiling cause);
  task-cap ends exhausted.
- **Why it restarts anyway.** `commitCandidate` (`checkpoints.ts`): `continuable = settled && missing.length === 0 &&
  !!snapshot`. ccloop's `buildHandoffPacket` (`ccloop/src/control/handoff.ts`) lists every phase file of the current attempt
  that does not exist; for a terminal run it does not apply the `enteredPhaseFiles` filter, and a phase cut mid-call never
  wrote its file. So the checkpoint is never continuable and `continueRestartsFresh` is true. Even if it were, the packet
  carries no `allowanceContinuation`, so the next run would start at plan.
- **The resume mechanism exists: the allowance park.** ccloop `parkAllowance` (`runLoop.ts`) ends a run out of group/spend-cap
  allowance as non-terminal `blocked_waiting_human`/`token-allowance` with `allowanceNextPhase`; the packet carries
  `allowanceContinuation {nextPhase, plan, execution, verification, state, usage}`; Orca's `settleTokenAllowance` validates
  it (`validateAllowanceCheckpoint`, `fundedAllowance.ts`); the next claim resumes at `nextPhase` with the paid evidence
  (`readAllowanceContinuation`, `materialize.ts`). The live ceiling (G round, later) was never wired into it.
- **Ceiling sites in ccloop `runLoop.ts`** (lines at `4a66656`, orientation only): before an attempt (~1950); plan mid-call
  (~2165–2180); before execute (~2208); execute mid-call with no result (~2269); a partial execute result not sent to verify
  (~2372–2381, ends `failed` with the ceiling reason); execute mid-call with a result, or before verify (~2411); verify
  mid-call (~2516).
- **`task accept-attempt`** already admits a `settled-recoverable`/`exhausted` ceiling run (`acceptAttempt.ts`, the
  2026-11-16 `ceiling` branch). The tester's run qualified; no surface named it.

## 3. Intent, goals, non-goals, anti-goals

**Intent.** A ceiling is a brake on spending, not a reason to throw away what was already paid for. When a run hits it, the
person can (a) give it more and have it **continue where it stopped**, or (b) **take what it already made** without paying more.

Goals:
1. A ceiling stop Orca can lift (cause `group` or `pause-line`) leaves a **continuable** checkpoint whose continuation resumes
   at the interrupted (or next) phase, on the saved tree, with the paid phases' evidence. No re-plan.
2. Resuming does **not** cost the task an attempt: the resumed phase belongs to the interrupted attempt (controller call, §9 H1).
3. Every surface that shows the stopped task names the exits that work (`next:` lines), including `accept-attempt`.
4. A person's `accept-attempt` that is refused does not destroy the continuation.

Non-goals: how the ceiling is computed or split (#479 keeps the even split); usage booking; a zero-change run "succeeding"
(#431 A); a reading-only brake (#431 C); multi-directory runs (excluded, §5.1).

Anti-goals: continuing on a tree that is not the one the run produced; granting more tokens than the person or policy allowed;
softening a task-cap; a continuation whose usage lineage double-counts or loses paid tokens; landing code without Orca's checks.

## 4. Approaches considered

- **A — Orca only: a complete-snapshot ceiling checkpoint is continuable from the tree.** Restarts at plan on the saved files.
  Rejected: re-pays the plan (1.32M for the tester) and carries no phase evidence.
- **B1 — ccloop turns a ceiling stop into a non-terminal allowance park; Orca settles it through `settleTokenAllowance`
  and bolts `classifyCeilingStop` on.** (The first draft.) Rejected after review: writes a false `tokenBudgetRemaining:0`,
  changes the run's outcome to `blocked_waiting_human` (which breaks the accept-attempt ceiling branch), and duplicates the
  ceiling settle's idempotency guards.
- **B2 — the ceiling stop stays terminal `exhausted` + `liveCeilingStop`, and ccloop attaches the continuation evidence
  (chosen).** Orca keeps settling it through `settleCeilingStop`, which already classifies, has the #313/orphan idempotency
  guards, and keeps `outcome=exhausted` (accept-attempt unchanged).
- **C — don't interrupt a phase; stop at the next boundary.** Rejected: one codex phase's overspend is unbounded.
- **D — keep the run and its worktree alive, waiting.** Rejected: holds live state indefinitely; B2 gets the same from the checkpoint.

## 5. Design (B2)

### 5.1 ccloop: a ceiling stop carries its continuation (producer)

At each ceiling site, when the stop is **resumable**, ccloop still ends the run `exhausted` with `LIVE_CEILING_STOP_REASON`
and `liveCeilingStop` exactly as today, and additionally:

1. records an event `ceiling_interrupted` (`<phase> in attempt N`) when a phase was cut mid-call — mirroring how
   `handoff_interrupted` is excluded — and `enteredPhaseFiles` (`handoff.ts`) **excludes** the interrupted phase's file, so
   the candidate's `missing` lists no file of a phase that was never meant to finish;
2. applies the entered-phase filter for such a terminal run (today it applies only to non-terminal runs and token-allowance
   parks);
3. writes the paid phase files that exist (helpers already used by parks/handoffs);
4. puts `allowanceContinuation {nextPhase, plan, execution, verification, state, usage}` into the handoff packet and the usage
   ledger (`allowanceUsage`, `worker.ts` — set it for this case the same way as for a park), with `contractHash`,
   `acceptedContract` and `tokenPolicy` as a park does.

**Resumable** = not a recovery run, protocol 4 with a `tokenPolicy`, a single-directory run (multi-directory continuation is
unsupported in Orca: `multi-dir-continuation-unsupported`), `stop.cause !== "task-cap"`, observations known (as
`parkAllowance` reads them), `attemptsUsed ≥ 1` (a stop before the first attempt has nothing paid to carry and stays exactly as
today), and no open handoff request (a handoff owns that run). Not resumable ⇒ byte-identical to today.

**`nextPhase` per site** (same attempt):

| Site | nextPhase | Paid evidence carried |
|---|---|---|
| before an attempt (boundary; `attemptsUsed ≥ 1`) | `plan` of the next attempt | previous attempt's `verify.json` (the rejection) |
| plan mid-call | `plan` | the previous attempt's `verify.json` if attempt ≥ 2, else none |
| before execute (boundary) | `execute` | plan |
| execute mid-call, no result | `execute` | plan; the tree holds the interrupted execute's changes |
| a **partial** execute result (any site, incl. ~2372) | `execute` | plan; the tree holds the changes |
| a **complete** execute result, mid-call or before verify | `verify` | plan, execution |
| verify mid-call | `verify` | plan, execution |

(A partial result maps to `execute` because `savedExecutionSchema` refuses `completionStatus`; only a complete result can
be carried to verify.)

**Saved-state rules for a ceiling continuation** (in ccloop's packet builder and reader, and Orca's validator — every other
rule stays): `waitingCause` is absent (the run is terminal); the reader accepts the continuation when the saved state is
`token-allowance` **or** carries a `liveCeilingStop` with cause `group`/`pause-line`; `tokenBudgetRemaining` is the real value
(not forced to 0) when `liveCeilingStop` is present; `nextPhase:"plan"` may have `verification:null` only when
`liveCeilingStop` is present and the interrupted attempt is attempt 1. `liveCeilingStop` reaches the reader through
`savedStateSchema`'s passthrough and the canonical-hash equality with `packet.runState` — keep both.

**Attempts (goal 2).** A run resumed from a ceiling continuation continues the interrupted attempt: it does not charge a new
attempt for that resumed attempt, and a ceiling stop on the task's last attempt is still resumable. The builder chooses the
smallest correct mechanism across both repos (e.g. ccloop skips `consumeAttemptBudget` for the resumed attempt and the
saved-state schema allows `attemptsRemaining` 0 with `liveCeilingStop`; Orca's continuation grant and the `inheritedUsage`
lineage check count the attempt once). Criterion 3 pins the behaviour, not the mechanism.

**Interrupted-phase note.** When the continuation resumes a phase that was cut mid-call (`liveCeilingStop.at === "mid-call"`
and `phase === nextPhase`), that phase's prompt carries one note: the previous run of this phase stopped at the token ceiling
before it finished; the worktree already holds its changes; review them and finish, do not start over. Use the existing note
channel (`liveNotesAt` or a constraint), not a new prompt section.

**Protocol.** No new envelope/report fields. Append a dated, named Correction to ccloop's protocol spec: a terminal
`exhausted` + `liveCeilingStop` candidate may carry `allowanceContinuation`; the relaxed saved-state rules above; the
`ceiling_interrupted` event.

### 5.2 Orca: intake (consumer)

- `settleCeilingStop` (`executionDriver.ts`): when the candidate's packet carries `allowanceContinuation`, run the relaxed
  `validateAllowanceCheckpoint` before committing; a validation failure blocks at C by name (`ceiling-continuation:<why>`),
  as `settleTokenAllowance` does for parks. The rest is unchanged: archive, snapshot check, `commitCandidate`,
  `classifyCeilingStop` in `onSettled`, the #313 and orphan guards.
- The checkpoint is now continuable (`missing` empty), so `continueRestartsFresh` is false and the next claim (auto-continue,
  after `set-limit`, after `decide-usage continue`, or a person's retry) is a continuation of the stopped run.
- Continuation funding: the new run's grant and ceiling come from the existing continuation path; verify that the attempts
  dimension follows goal 2.
- Run view (`run show`, Web run page): a resumable ceiling stop reads `stopped at the live ceiling in <phase> (<at>); continues
  at <nextPhase> with the paid <plan/execution>`; a non-resumable one keeps today's wording plus why it cannot continue.

### 5.3 Orca: `accept-attempt` (exit 2)

Already eligible for ceiling runs. Two fixes:
- **A refused acceptance keeps the continuation.** Today `acceptAttempt.ts` converts the run to `settled-failed` before the
  checks run, so a refusal makes `continuableRun` false. On refusal, restore `settled-recoverable` and the task's wait
  (`groupCapStop`/`usagePause`), or convert only on landing — builder's choice.
- **Landing clears the wait.** On landing clear `groupCapStop`, `usagePause` and `allowancePredecessorRunId`
  (`completeAcceptedAttempt` sets only `done`), so no continuation starts afterwards. Refused while a run is active
  (`work-already-active`), as today.

### 5.4 Exits on every surface

For a task waiting after a ceiling stop, `group show`, `group brief` (`firstFailure.next`), `recovery list` and the Web card
name the exits that work in the current state: `orca group set-limit <g> --limit <n> --as-person` (group cause) or
`orca task decide-usage …` (pause-line), **and** `orca task accept-attempt <g> <t> --run <r> --note <why>`. Align with the
short-term message fix from batch A (session `5d3d0c09`).

## 6. Success criteria (red on the old code unless marked "regression guard")

ccloop (fake adapters, no real model):
1. For each row of the §5.1 table, a resumable ceiling stop ends `exhausted` with `liveCeilingStop`, the packet's
   `allowanceContinuation` carries exactly the listed evidence and `nextPhase`, and the candidate's `missing` has no
   `attempts/N/*.json` entry; the `ceiling_interrupted` event is present for mid-call rows.
2. Not resumable — task-cap, no `tokenPolicy`, protocol < 4, unknown observations, `attemptsUsed = 0`, multi-dir, open handoff
   request — each byte-identical to today (regression guard, except where a new branch could leak: each such case must be
   checked against a mutation that drops its condition).
3. A task with `maxAttempts` 1 stopped mid-execute resumes after the ceiling is raised, runs **execute, not plan**, on a
   worktree containing the interrupted execute's file, with the interrupted-phase note in the execute prompt, and is not
   refused for attempts; a continuation from a boundary stop carries no note.
4. A second ceiling stop inside a continuation is again resumable, and its continuation resumes correctly.
5. The reader accepts `nextPhase:"plan"` without verification only with `liveCeilingStop` on attempt 1.

Orca (fake ccloop through the real port where possible, e.g. the `handoffWire` harness):
6. A resumable ceiling report settles `settled-recoverable` with `recoverable:true`; cause `group` with ≥ 1M headroom ⇒ ready,
   and the next claim is a continuation (predecessor = the stopped run), not fresh; < 1M ⇒ `groupCapStop`, and after
   `set-limit` the next claim continues; `pause-line` ⇒ `usagePause`, and `decide-usage continue` continues.
7. Lineage: the continuation's `inheritedUsage.tokens` equals the predecessor's `cumulative.work`, and its usage ledger has
   no plan event when `nextPhase` is `execute`.
8. A crash between commit and `onSettled`, and a re-settle of the same report, end in the same state (the #313/orphan guards).
9. `accept-attempt` refused on a resumable ceiling run ⇒ still continuable and still waiting; landed ⇒ wait cleared, no
   continuation starts.
10. The surfaces in §5.4 print the exits for a waiting ceiling-stopped task.
11. A plain allowance park and a non-resumable ceiling stop are unchanged (regression guards).

Paid acceptance (human allowed "必要的付费真跑" this session; once, small): a real codex run in a scratch group whose limit lets
plan finish and stops execute at the ceiling; then `set-limit`; the second run's usage shows **no plan phase** and the task
completes. Record the commands and token counts in the handoff.

## 7. Order of work

1. ccloop §5.1 + criteria 1–5 + protocol Correction; ccloop `npm test` (affected) and its known-reds check; merge; push ccloop
   main (human allowed this session).
2. Orca repin; Orca §5.2–5.4 + criteria 6–11; gate; merge; push (allowed after repin).
3. Paid acceptance; README/handoff notes; tell the tester how to recover their old run (`accept-attempt`, or
   `git show refs/orca/runs/<runId>`).

## 8. Left to the builder

Helper names and placement; the attempt mechanism for goal 2; whether the note rides `liveNotesAt` or a constraint; run-view
wording; refuse-restore vs convert-on-landing in §5.3.

## 9. Independent review (2026-11-25, session `5d3d0c09`) and what changed

A fresh reviewer read the first draft against both repos. Verified: the checkpoint rule, the classifier, the routing order,
`parkAllowance`, the tree restore on continuation, the site line numbers. Corrected: accept-attempt already admits ceiling
runs; a seventh site (partial execute result, ends `failed`); `spend-cap` is not a ceiling cause; a park does not clean the
worktree itself. Findings and resolution:
- **H1** resuming costs an attempt / the last attempt cannot park ⇒ goal 2 (controller call under the human's "有问题先按你的
  建议执行"; reported for review at the end of the session).
- **H2** interrupted phase files land in `missing` ⇒ `ceiling_interrupted` event + entered-phase filter (§5.1 items 1–2).
- **H3** partial execute results cannot be carried to verify ⇒ partial maps to `execute`.
- **M1** `attemptsUsed = 0` boundary throws ⇒ not resumable. **M2** plan on attempt ≥ 2 ⇒ carry the previous verify.
  **M3** false `tokenBudgetRemaining:0` ⇒ real value. **M4** simpler shape ⇒ B2 adopted. **M5** refused accept destroys
  continuability ⇒ §5.3.
- Low: multi-dir excluded; open handoff request excluded; the passthrough dependency stated.
- Criteria: crash/idempotency, lineage, second ceiling, last attempt, refused accept added; regression guards marked.
