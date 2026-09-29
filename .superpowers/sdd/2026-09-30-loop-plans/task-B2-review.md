# Task B2 review — set-task-loop (3a75bd7..686e745)

Reviewer: task-reviewer subagent, session 1d7d9aa0 (Opus 5.5), 2026-09-30, reviewing commit 686e745 (read-only).
Inputs: task-B2-brief.md, task-B2-report.md, rulings.md (P1-P10), global.md, spec §5.2/§6, diff
review-3a75bd7..686e745.diff (read whole, in two passes because of its size).

### Spec Compliance

- ✅ Spec compliant. Every file the brief lists has its hunk: errors.ts (5 codes at the named positions), webProtocol.ts
  (verb, strict payload with strict `work` and no `sessions`, raw and effective variants on `taskCommandTargetSchema`,
  result `task-loop-set`, type), executionSnapshot.ts (`deriveContract` exported, nothing else changed),
  webService.ts (imports, `SetTaskLoopCommand`, `setTaskLoop` at src/control/webService.ts:569),
  web/src/controlTypes.ts (verb, result, `SetTaskLoopPayloadV1`), webParity.test.ts (additive), and the two new test
  files. The fixture and the brief's 15 criteria match the brief; 3 criteria were added under P3.
- Departures, judged on the merits:
  - **Not calling `prestart` (P5 wording).** Accepted. `prestart` (webService.ts:93-96) answers
    `grant-amendment-unsupported` for running/review/done. Spec §5.2 step 1 and criterion 8 require
    `group-state-invalid` for every status but draft/ready, and for a stopped group. The inline check at
    webService.ts:578 refuses `status ∉ {draft, ready} || stopped`. Against the group status enum (webService.ts:302:
    draft, ready, running, review, done, blocked) that refuses exactly running, review, done and blocked, plus
    stopped. That is spec step 1 word for word, and `prestart` does not check `stopped` anyway. Named risk (4)
    verified.
  - **`resetDraftReserve` instead of a "reserve + reopen" helper.** Accepted. The report's reason holds: editProposal's
    no-op check sits between the two steps (webService.ts:247-249).
  - **The work row is read through `workBodyOf`.** Accepted: it reuses B1 and needs no new parse.
  - **The commit message has one extra paragraph.** Accepted. It is accurate, and both trailer lines are present
    (checked with `git log -1 --format=%B 686e745`).
- ⚠️ Cannot verify from the diff: the confirmed branch's internals (webService.ts:629-641). These are the reserve delta,
  the re-derive, the `work.grant` write and `saveWebAuthority`. Until B3 adds the snapshot copy, step 8 always rolls
  them back. Only the whole-branch deletion (MB2-20) and the self-check (MB2-3) are seen red. B3's review must require
  a separate mutation for each line of that branch, including `committedRemaining[d] +=` at line 631.

### Named-risk checks

1. **Conservation** (spec criterion 9).
   - Draft path: `allocation.amount = next`, then `resetDraftReserve` sets reserve = residual(limit, used, Σ non-reserve
     + estimates). `reopenProposal` then sets `committedRemaining = commitments` and `saveWebAuthority` sets
     `reserved = committedRemaining` (webService.ts:140-151, 198). So reserved + reserve = limit − used holds in every
     dimension. The code never assigns `used`.
   - `sessions` comes from `{ ...before, ...three fields }`, and the payload schema is strict with no `sessions` field.
   - Criteria: the "raises…" and "lowers…" tests call `expectConserved`, `used` toEqual, and sessions toBe.
   - The pre-check at 586-589 uses `proposal.explicitUnallocatedReserve`. Step 1's `assertKnownConservation` has
     already proved that value equals the ledger's (116-117).
   - Confirmed path: arithmetic by reading only. It is correct because a draft/ready group has no running task, so
     `committedRemaining` equals Σ allocations. It is unobservable until B3 (see ⚠️).
2. **`resetDraftReserve` must be byte-identical at its call sites.** The helper body (webService.ts:186-190) is the two
   removed statements, verbatim.
   - editProposal (247): it still runs after `proposal.groupLimit` is updated and before the no-op check. The helper
     reads `proposal.groupLimit` and `group.used` exactly as the inline code did.
   - proposalSetAgent (279): same position as before.
   - `grep` shows no other copy of the pattern (line 488 is a different expression).
   - The implementer's green run covers proposal, agentFreeze, agentPlanImport, confirmation, estimator, stopIntent,
     webMutations and the panel APIs (b2-green-final.txt: 201 passed, 3 skipped). The skipped ones are estimateE2E,
     which is gated off.
3. **A refused command leaves every body unchanged.**
   - `applyWebCommand` runs `apply` inside `SAVEPOINT web_command_apply`. A `ControlError` triggers `ROLLBACK TO`
     before the refusal is ledgered (commandLedger.ts:179-191). Any other error rethrows out of `store.transaction`.
   - The self-check criterion compares the raw `budget_proposals` and `groups` bodies before and after, plus the work
     item's `amendmentHash`.
   - MB2-19b (b2-MB2-19b.txt) shows that MB2-8's refusal is the step-8 conservation check, not something incidental.
4. **The inline status check refuses exactly the right statuses.** Verified above under Departures.

### Strengths

- Step order follows spec §5.2:
  - ledger, then group state, then work-not-found, then task-already-started;
  - estimate, then version, then hand-written, then expand, then no-op;
  - reserve pre-check, then overflow, then writes.
  - A P3 criterion pins that the ledger check comes first ("unknown usage on a stopped group", MB2-18 red).
- Mutation work goes well beyond the plan. The brief lists 9 mutations; the implementer ran 22, each with a restore and
  cmp evidence (b2-mut-summary*.txt, all restore rc 0). The implementer reports honestly the ones that stayed green
  (MB2-12, 15, 19) and adds a criterion wherever a mutation had been masked (MB2-18, MB2-21).
- The P5 extraction is minimal, and its doc comment names all three callers.
- The "any runs row" test for task-already-started is killed by the spec's own named mutation (MB2-1, `AND active=1`).

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. **The `work.status` half of the task-already-started check has no red mutation** (src/control/webService.ts:585).
   MB2-12 stays green: b2-MB2-12.txt, 18/18 pass.
   - I checked the production paths. Every place that sets a work status other than draft/ready also leaves a run row
     (stopIntent.ts:690, 701, 710). So this half is reachable only in a hand-crafted state, for example a `blocked`
     work item with a `terminal` allocation and no run. Such a state passes step 1, because
     `assertKnownConservation` returns zero for a terminal allocation without looking up a run (webService.ts:129).
   - The spec names the check, so keeping it is right.
   - Fix: add a criterion that writes `status: "blocked"`, sets the allocation state to `terminal`, and reduces
     `reserved` to match. That would see this half red. Otherwise, leave it registered as the report does.
2. **MB2-15 is red only in the type checker** (webService.ts:601). The `!allocation || !handoff` guard is unreachable at
   runtime, because step 1's conservation check already refuses a missing row. The typecheck red is real evidence for a
   narrowing guard. This is acceptable as reported.
3. **`expectUntouched` only inspects task `a`** (tests/control/setTaskLoop.test.ts:18). The refusals on `c` (line 77),
   `zzz` (line 81) and `b` (the task-already-started test) never check their own work rows. The only thing that holds
   is the proposal-version half. Low risk, because every one of these refusals happens before any write.
4. **The implementer's D3 point stands.** `expectUntouched` cannot tell "refused before writing" from "wrote, then
   rolled back". The spec only requires the rollback, so this is informational.
5. **The test output is not clean:** `ExperimentalWarning: SQLite is an experimental feature` appears in every run
   (b2-green-final.txt). This comes from node:sqlite, is not introduced by this task, and is noted for the controller.

### Assessment

**Task quality:** Approved

**Reasoning:**
- The command matches spec §5.2 steps 1-8 for the draft path.
- Conservation, rollback and helper equivalence hold both by reading and in the tests.
- The departures are well founded.
- The remaining gaps are one masked defensive branch and the confirmed branch, which cannot be observed until B3.
