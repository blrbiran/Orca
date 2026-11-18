# Salvage a C path-policy block with `task accept-attempt` (#352 addendum, #321) — design

> **Status (Orca session ca534c51, 2026-11-18):** NOT BUILT — controller ruling (Orca session ca534c51): under loop plan v4 (#346) new groups cannot reach this state, and old groups are not kept compatible during dogfooding; kept as a reference if a v≤3 case matters.

**Who:** subagent of Orca session 2026-11-18 (the second of the day), for the controller. Design only; nothing implemented.
**Written against:** `feat/off-plan-writes-346` at `9209fa083284e54510091780889e4353988afed2` (worktree `.claude/worktrees/off-plan-346`),
which merges first. Every file:line below was read at that commit; re-measure before implementing (Rule 14).
**Builds on / amends:** `docs/superpowers/specs/2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §7
("`task accept-attempt`, corrected", item 2, line 160) and `docs/superpowers/specs/2026-11-16-completed-attempt-acceptance-design.md`.

## 1. Problem

A run that finished its work but wrote a path outside its plan's write set stops at C, and no command lands that work.
`task accept-attempt` admits only three shapes (`src/control/acceptAttempt.ts:122-124`: closed, ceiling, E-block). A person
who runs `close-run` first gets the closed shape, but the driver then harvests again against the same bound
(`acceptAttemptDriver.ts:136-138`) and refuses `out-of-bounds:<the same paths>`. The only other way is a full re-run
(`task retry --allow-observed-paths`), which paid 7.3M tokens twice in #321 and threw away a complete fix in #352. The
evidence that would let it land already exists: the stop at C archives the run (`executionDriver.ts:1079`) and keeps
ccloop's observed misses on the run (`:1086`, `drive.pathPolicyMisses`).

Two stop shapes exist. **Neither has `failureCause.cause === "path-policy"`.** ccloop sets no `failureCause` on
`blocked_waiting_human` (ccloop `runLoop.ts:1506-1508` at `0f475e8`), and `"path-policy"` is only the panel's *diagnosis*
(`src/panel/runDiagnosis.ts:78`). Decision 1 is therefore keyed on the markers that are really recorded:

| Shape | Recorded markers | Paths recorded at |
|---|---|---|
| **A. ccloop allowlist stop** | `state=blocked`, `drive.blockedAt="C"`, `drive.outcome="blocked_waiting_human"`, `drive.stopReason` starts with `allowlist miss: ` | `drive.pathPolicyMisses: {repoKey,path}[]` (`pathPolicyMisses.ts:4`; ccloop `collect.ts:310`) |
| **B. Orca's own bound** | `state=blocked`, `blockedAt="C"`, `outcome="succeeded"`, `drive.blockedReason` starts with `out-of-bounds:` | only as a `,`-joined string (`executionDriver.ts:1120`); a path containing `,` is ambiguous (`parallelClaims.ts:160-162`) |
| C. ccloop denylist stop | `outcome="blocked_waiting_human"`, `stopReason` starts with `denylist match: ` | the stop reason |

Shape C is always a protected path or a frozen sibling claim, so decision 3 refuses it by definition. Under #346's v4 plan
(allowlist `[]`, `harvestBound.ts:27-30`) shape A cannot happen and every shape B path matches the denylist, so all of them
are refused too. **This change helps v≤3 contracts only** (their bound is targetPaths ∪ allowlist). Shape B has a second
gap: a `succeeded` outcome is not archived at C (`:1079` runs only when `outcome !== "succeeded"`), so it has no snapshot
until a cleanup.

## 2. Decisions (controller's, with why and the cost if wrong)

1. **Admit shapes A and B with a complete snapshot, closed in the same command.** *Why:* the work and its evidence exist,
   and a separate `close-run` adds a step without adding any safety. *If wrong:* a run that should have been closed or
   retried lands instead. The checks re-run and the person reviews it, so the cost is one task's revertable merge (the
   ledger's `undo`). Closing reuses close-run's preconditions: usage known, worker gone, stop proof sealed, no open request.
   A run that is already closed (`settled-failed` after `close-run`) is admitted as the closed shape, as it is today.
2. **The person names the paths, and the named set must equal the recorded set.** CLI: repeatable `--accept-path <p>`
   (house style: `repeatable: true`, as in `--lock` and `--param`). Web: one checkbox per path, and all must be ticked.
   Recorded set: A ⇒ `drive.pathPolicyMisses[].path` (every `repoKey` must be null, because multi-directory groups are
   refused already). B ⇒ a new field `drive.outOfBounds: string[]`, written by `blockOutOfBounds` together with the
   reason. *Why:* the person accepts exactly what Orca observed, nothing more and nothing less. *If wrong (too strict):*
   a person cannot accept part of the set and must retry instead. That is today's state, so nothing is lost.
3. **Refused paths:** a frozen parallel-sibling claim (`confirmed.siblings` / snapshot `offPlan`, matched with
   `denylistMatches`); a path that an unfinished, unordered sibling may write (the rule `applyObservedPathAmendment` uses:
   `observedPathOverlaps` over tasks neither ordered before nor after this one; `webService.ts:325-337`); any path matching
   `safetyPolicy.denylistPaths`, which holds the protected paths; any path with a `.git` segment, a non-exact path
   (`exactObservedPath`), or a path that crosses a symlink (`validateObservedPathScopes`); a check-defining file (the
   driver's existing `criteria-*` refusal, unchanged). *Why:* a person's acceptance must not overwrite work another task
   owns or a file Orca protects. *If wrong (too lax):* a sibling's later landing conflicts. The merge refuses by name
   (`merge-conflict:`), so a conflict can surface but nothing is silently overwritten.
4. **Setup and required checks re-run as today, and the landing is recorded as `off-plan-write`.** The record names the
   accepted paths. *Why:* the checks are the only proof the work is complete. *If wrong:* none; the record is
   information only.
5. **Views.** `recovery list` offers accept-attempt beside close-run. `run show` says "work completed; stopped on paths
   outside the plan: …".
6. **Relax 2026-11-11 §7 item 2 only for the paths the person names.** Every other out-of-bounds path is still refused.
   The two specs get Corrections (Appendix).

## 3. Command & payload

`acceptAttemptPayloadSchema` (`webProtocol.ts:876`) gains `acceptPaths?: string[]` (`.min(1).max(128)`, unique, each
1..4096 bytes). When the field is absent the payload bytes are unchanged and every existing path behaves byte for byte as
before. CLI flag: `{ name: "accept-path", type: "string", repeatable: true, summary: "a path the run wrote outside its plan
that you accept (repeat for each; must be exactly the paths run show lists)" }`. `operatorAcceptance` gains
`acceptedPaths?: string[]` (sorted, and present only when given).

`applyAcceptAttempt` order. Steps 1–4 are new; the existing checks keep their order around them:
1. Classify the stop: A, B, C, closed-A (`settled-failed` and inactive with A's markers), or none.
2. If `acceptPaths` is absent and the stop is A, B or closed-A, refuse `accept-attempt-paths-required` with the recorded
   paths in the detail. This replaces today's `accept-attempt-run-not-settled` for A and the driver's late
   `out-of-bounds:` refusal for closed-A. If `acceptPaths` is present and the stop is none of these, refuse
   `accept-attempt-paths-unexpected`. A stop of shape B with no `drive.outOfBounds` refuses `accept-attempt-paths-unrecorded`.
3. Compare sets. Any difference refuses `accept-attempt-paths-mismatch`, and the detail names the missing and extra paths.
4. Check each path in the order of decision 3: `-path-invalid`, then `-path-protected` (shape C always ends here), then
   `-path-sibling`.
5. For an active shape A or B: run close-run's preconditions, extracted from `applyCloseRun`
   (`terminalRunClosure.ts:73-81`) into one shared helper. Unknown usage refuses `accept-attempt-run-not-settled`
   (detail `usage-unknown`; the hint names settle-usage). A live worker or an unsealed proof refuses the same code with
   detail `process-live` or `evidence`. Then convert the run as the E-block path does (`acceptAttempt.ts:152-157`):
   release `remaining`, mark allocations terminal, set `work.status=blocked`, `state=settled-failed`, `active=0`, and
   `operatorSettlement={kind:"completed-attempt", outcome}`. `drive.outcome` is never rewritten.
6. `prepareAcceptAttempt` is unchanged (it reads the snapshot). For shape B, stepC now archives before it blocks
   (`archiveRun`, wrapped in the same try/`savedSourceUnavailable` as `:1079`). A shape B run blocked before this change has
   no snapshot and refuses `accept-attempt-snapshot-missing`. That is honest, not a regression.

New refusal codes (`errors.ts`, HTTP 409 unless noted; texts for `web/src/locales/{en,zh}.ts` and `error-codes.md`):

| Code | en | zh |
|---|---|---|
| `accept-attempt-paths-required` | This run stopped on paths outside its plan. Name each one to accept them (run show lists them). | 这个运行停在计划之外的路径上。要接受，请逐一列出这些路径（run show 里有）。 |
| `accept-attempt-paths-unexpected` (400) | This run did not stop on paths outside its plan; accept it without naming paths. | 这个运行不是因为计划外路径而停下的；接受时不要列路径。 |
| `accept-attempt-paths-mismatch` | The paths you named must be exactly the ones this run stopped on. | 你列出的路径必须与这个运行停下时记录的路径完全一致。 |
| `accept-attempt-paths-unrecorded` | This run stopped before Orca kept a list of its outside paths; retry the task instead. | 这个运行停下时 Orca 还没有记录计划外路径的清单；请改为重试任务。 |
| `accept-attempt-path-invalid` (400) | A named path is not a plain file path in the repository (no .git, wildcards, .. or symlinks). | 列出的某个路径不是仓库里的普通文件路径（不能含 .git、通配符、.. 或符号链接）。 |
| `accept-attempt-path-protected` | A named path is protected by the plan and cannot be accepted. | 列出的某个路径受计划保护，不能接受。 |
| `accept-attempt-path-sibling` | A named path belongs to a parallel task, or one may still write it; retry after that task instead. | 列出的某个路径属于并行任务，或可能仍被它写入；请等那个任务完成后再重试。 |

## 4. Driver

`visit` (`acceptAttemptDriver.ts:129-140`) measures with the same bound as today, `primaryHarvestBound(contract)`. Then,
**only when `intent.acceptedPaths` is set**, the named paths are added to the bound **for this landing only**:
- `extra = measured.outOfBounds \ acceptedPaths` ≠ ∅ ⇒ `Refusal("out-of-bounds:<extra>")`, as today.
- `unused = acceptedPaths \ measured.outOfBounds` ≠ ∅ ⇒ `Refusal("accepted-paths-unused:<unused>")`. The rebuilt attempt
  does not match what the person was shown, so nothing lands.
- A `denylist` bound with `acceptedPaths` set ⇒ `Refusal("accepted-paths-protected")`. The command already refuses this;
  the driver check is the second line of defence.
Nothing is persisted: no contract, allowlist or plan changes, so a later run of this task keeps the original bound. The
criteria classification (`:139-140`), merge, setup and checks, compare-and-swap and staging are unchanged. In `land()`'s
staging write, the sibling check (decision 3) runs again against the current work items, because a sibling's observed-path
amendment may have widened its write set since the command; a hit becomes `Refusal("accepted-path-sibling:<task>:<path>")`.
The `orca-operator-accept` ledger decision adds `accepted-off-plan <paths>` to `evidence` and names them in `undo.blast_radius`.
`acceptedOffPlan` adds `acceptedPaths` to `OffPlanWriteBody` (optional; rows without it keep their bytes). `finish` records
it unchanged (`recordOffPlanWrite`).

## 5. Views

- **recovery list** (`terminalRunRows`, `controlViews.ts:2002`). A shape A row keeps `next: "close-run"` and gains
  `acceptAttempt: { paths, more }` (at most 64 paths, plus a count). Shape B rows are new. Today they appear in no list,
  because rows with `outcome="succeeded"` are skipped at `:2007`. They show with `next: "accept-attempt"` and the same
  field. The `webProtocol.ts:2503` enum gains `"accept-attempt"`. The CLI formatter prints the full
  `orca task accept-attempt <g> <t> --run <r> --accept-path … --note <why>`.
- **run show** (`commands/domains/reads.ts:605`). For a shape A, B or closed-A run with no pending or landed acceptance,
  print `work completed; stopped on paths outside the plan: <p, …>`, then the accept-attempt command line. The existing
  `--allow-observed-paths` retry line stays below it as the re-run alternative.
- **Web** (`web/src/AcceptAttempt.tsx`). `RunViewV1` gains `offPlanStop?: { paths: string[] }`, which the server computes
  with the same classifier as step 1. `offered` also becomes true for an active shape A or B run. The form lists each path
  with an unticked checkbox, and Send stays disabled until every box is ticked and the note is non-empty. It sends
  `acceptPaths` = all listed paths. New strings: `control.acceptAttempt.offPlanLead` ("Work completed; it stopped on paths
  outside the plan. Tick each path to accept it:" / "工作已完成；它停在计划之外的路径上。逐一勾选以接受：").

## 6. Tests (each with the mutation that must turn it red; see each red before calling it a criterion, Rule 9)

1. `acceptAttemptOffPlan.test.ts`: an active shape A run (v3, one miss `src/sla/breach.js`, complete snapshot) with
   `--accept-path src/sla/breach.js`. The run converts (settled-failed, inactive, remaining released), the driver lands it,
   the task is done, and the merged tree holds the file. *Mutation:* drop A from the classifier ⇒ `run-not-settled`.
2. The same run with no `acceptPaths` ⇒ `paths-required`, and nothing is written (byte-compare the run row).
   *Mutation:* admit A without paths ⇒ the driver refuses late, and the run row changes.
3. Named ⊂ recorded, and named ⊃ recorded ⇒ `paths-mismatch`. *Mutation:* subset check instead of equality ⇒ green on
   the subset case (red expected).
4. Path in the denylist; shape C stop ⇒ `path-protected`. *Mutation:* skip the denylist check ⇒ conversion happens.
5. Path in a frozen sibling claim (v4 `offPlan` fixture), and a path in an unordered unfinished sibling's targetPaths ⇒
   `path-sibling`. *Mutation:* drop each check in turn; each case goes red on its own.
6. `.git/config`, `a/../b` ⇒ `path-invalid`. *Mutation:* remove the `.git` segment test.
7. Driver: the rebuilt attempt has one out-of-bounds path more than accepted ⇒ `out-of-bounds:<it>`, and the tip is unmoved.
   *Mutation:* bound = claims ∪ all measured ⇒ it lands.
8. Driver: an accepted path is absent from the rebuild ⇒ `accepted-paths-unused:`. *Mutation:* drop the `unused` check.
9. Shape B: stepC archives before blocking and records `drive.outOfBounds`; accept lands. *Mutation:* remove the new
   `archiveRun` ⇒ `snapshot-missing`.
10. A required check fails on the merged tree ⇒ `check-failed:` and no `off-plan-write` row. On pass, the row's
    `acceptedPaths` equals the named set. *Mutation:* omit `acceptedPaths` in `acceptedOffPlan`.
11. Close-run preconditions: a run with unknown usage ⇒ `run-not-settled` detail `usage-unknown`, and nothing is released.
    *Mutation:* skip the shared helper ⇒ the reservation is released.
12. Views: recovery list shows the shape B row with `next:"accept-attempt"`; run show prints the lead line; the Web Send
    button stays disabled until all boxes are ticked (component test). *Mutation:* render the form with no checkboxes.
13. Regression: the existing `acceptAttemptCommand/Completed/Landing` suites stay green with no payload change
    (`npm test` quick tier; record its own skip and deferral lines as printed, Rule 18).

## 7. Non-goals

Multi-directory and `dir` groups (still `accept-attempt-unsupported`). Partial acceptance (dropping some paths and landing
the rest). Rewriting the attempt. Persisting the accepted paths into the contract or plan (that is what
`--allow-observed-paths` does, for a re-run). v4 denylist hits. Fixing #352's root cause (`fixTaskAllowlist` and the
`missing` paths), which is separate. No provider call, no budget change, no auto-acceptance by `orca-auto`: the command
needs a person principal (`settlingPersonFor`).

## 8. Open risks

- **"Work completed" may overstate the case.** If ccloop's allowlist gate fires during execute, the snapshot can be
  mid-work. The re-run checks are the only completeness proof. Decide whether the run show and Web wording should drop
  the claim when `failureCause`/progress shows that execute never finished. The controller's wording is kept here
  pending that decision.
- **The equality rule is strict.** If ccloop reports at most 128 misses (`pathPolicyMisses.ts:7`) while the rebuild
  measures more, the run is refused `accepted-paths-unused` or `out-of-bounds`, and a retry is the only way out.
- **Shape B runs recorded before this change** stay without a snapshot and keep needing a retry.
- **Sibling re-check timing.** The check runs at the command and again at staging, but a sibling could amend its write set
  after staging and before the compare-and-swap. The window is milliseconds, and the merge still conflicts by name.
- **Close-run precondition extraction** touches `terminalRunClosure.ts`. Keep `applyCloseRun`'s refusal codes and order
  byte-identical, and run its suite.

## Appendix: Correction texts (to append; the originals stay word for word, Rule 13)

**For `2026-11-11-budget-defaults-and-reviewed-acceptance-design.md`, new section after the last one:**

> ## N. Correction: person-named off-plan paths (2026-11-18, #352 addendum; spec `.superpowers/sdd/2026-11-18-tester-triage/spec-352-salvage-accept.md`, controller ruling of Orca session 2026-11-18 second)
> §7 "`task accept-attempt`, corrected" item 2 is kept as written, with one relaxation. If the owner's command names
> paths (`acceptPaths`) and they equal exactly the paths the run was stopped on (ccloop's `pathPolicyMisses`, or Orca's
> recorded `drive.outOfBounds`), those paths are added to the harvest bound for that landing only. Any other
> out-of-bounds path is still refused, as is any named path the rebuilt attempt did not write. A named path that is
> protected, a `.git` path, a parallel sibling's frozen claim or a path an unfinished, unordered sibling may write is
> refused before anything is recorded. Nothing persists into the contract. Item 5's refusals are unchanged.

**For `2026-11-16-completed-attempt-acceptance-design.md`, new section at the end:**

> ## Correction: a C stop on paths outside the plan (2026-11-18, #352 addendum; same spec and ruling)
> "Eligibility" gains a fourth admitted shape: `state="blocked"`, `drive.blockedAt="C"`, and either
> (a) `drive.outcome="blocked_waiting_human"` with a `stopReason` starting `allowlist miss: ` and non-empty
> `drive.pathPolicyMisses`, or (b) `drive.outcome="succeeded"` with a `blockedReason` starting `out-of-bounds:` and
> `drive.outOfBounds` recorded. It is admitted only with `acceptPaths` equal to those paths. The command first checks
> close-run's preconditions (usage known, worker gone, stop proof sealed, no open request), then converts the run as the
> E-block shape is converted. `operatorSettlement.kind` stays `"completed-attempt"` and `drive.outcome` is kept.
> `accept-attempt-run-not-settled` keeps its meaning for every other shape.
