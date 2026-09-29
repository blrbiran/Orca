# Task B3 review — 686e745..6a44547

Reviewer: session `1d7d9aa0` (B3 reviewer subagent), 2026-09-30, reviewing HEAD `6a44547` read-only.
Evidence read: diff package `review-686e745..6a44547.diff`, brief, report, `global.md`, `rulings.md`, implementer evidence under
`SCRATCH/b3/` (`b3-mut-summary.txt`, `b3-MB3-1.txt`, `b3-green.txt`). No test was re-run.

### Spec Compliance

- ✅ Spec compliant. `replaceTaskInSnapshot` (src/control/executionSnapshot.ts:268-289) and the confirmed-branch block
  (src/control/webService.ts:639-644) match the brief character for character; the two import edits (webService.ts:9, :18) are as
  specified. The six brief criteria are copied verbatim (tests/control/setTaskLoopConfirmed.test.ts:1-121). Extra: one P3 criterion
  (lines 123-138) and its two imports, required by rulings P3 — justified, not scope creep.
- ⚠️ Cannot verify from diff / measured-gap (registered): a full rebuild of a task in `held` / `continuing` / `terminal` state (U8,
  R-F12) is still unmeasured. See Minor 1.

### Named-risk checks (one focused check each)

1. **Other tasks byte-identical, proposalVersion unchanged.** Checked: the byte-identical criterion
   (test:71-82) compares the whole canonical snapshot minus task `a`'s derived-contract entry and its two allocation rows — so
   `agents` (including `a`'s own agent entry, which `without` does not filter), `proposalVersion`, `groupLimit`, the reserve row and
   `b`'s entries are all pinned. `proposalVersion` is pinned separately (test:39, :42) and MB3-2 is red. MB3-1's evidence
   (`b3-MB3-1.txt`) shows it goes red only on the byte-identical assertion, i.e. only through the reserve row: in every fixture the
   other tasks are pending/ready or running, so their live allocations equal the frozen ones and a re-derivation would reproduce the
   same bytes. A full rebuild that re-derived a *re-amounted* (held/continuing/terminal) task would change that task's derived hash, and
   no criterion builds that state. This is the admitted U8 gap (R-F12 accepted); no criterion here would catch it beyond the reserve row.
2. **A2 on the changed task / B running while A changed.** Checked `readConfirmedTaskExecution` (executionSnapshot.ts:308-341): it
   compares snapshot non-reserve allocations to the live proposal, re-derives from `effectivePlanTask` and compares with the
   snapshot's `derivedContractHash` — so the copied snapshot must carry the new hash and new allocations, which it does. test:48-50
   asserts the new goal and token budget through A2; test:109-122 changes `b` while `a` is `accepted` and asserts `a` settles with no
   `blockedReason`, and A2 on `b` returns the new goal. (The criterion changes the waiting task while the other runs — the named shape.)
3. **Race with the driver claim, both orders.** Checked `deliverScheduledStart` / `createStartingRun` (src/control/webDispatch.ts:176-
   322). The claim's check-and-insert runs in one `store.transaction`, and `derivedContractHash` and `grant` are read from the work item
   inside it (webDispatch.ts:283-295); `setTaskLoop` checks `runs` inside its own transaction (webService.ts:585-586). Both orders are
   tested (test:86-107). One interleaving is not tested: `setTaskLoop` committing during the claim's `await probeFrozen` — the claim then
   uses a `snapshot` read before the await (webDispatch.ts:183). By inspection this is safe: the stale snapshot supplies only
   `graphVersion` and `profiles`, neither of which `setTaskLoop` changes, and the contract hash and grant come from the fresh work item.
4. **Every pointer to the new snapshot hash moves in the same transaction; old snapshots kept.** `grep executionSnapshotHash src`:
   the proposal (webService.ts:644) and the group mirror (`saveWebAuthority`, webService.ts:145) are updated in the same transaction;
   `readBudgetProposal` refuses any mirror mismatch (queries.ts:198), and every criterion calls it after the change, so the mirror is
   checked implicitly (MB3-12, MB3-14 red). `writeCanonicalRecord` never deletes; nothing removes the old record. Not updated: the
   `executionSnapshotHash` in pending/armed start-wake bodies (webDispatch.ts:131, stopIntent.ts:408), which the driver's re-arm copies
   forward (executionDriver.ts:705-709). No code compares it to the proposal, so it is inert today — see Minor 2.

### Strengths

- The copy-and-replace is minimal and exact: `structuredClone`, two targeted replacements, re-parse through
  `executionSnapshotSchema` (which re-checks sort order and task/allocation coverage), then hash of the parsed value.
- The byte-identical criterion measures what matters directly (canonical bytes of everything else) rather than a few fields.
- Mutation coverage is broad: 17 mutations, 17 red, restores proven by `cmp` (all restore files 0 bytes), copy check empty;
  MB3-7 now makes B2's self-check deletion observable, and MB3-8 covers the "any run, not only active" predicate.
- The implementer's three concerns are accurate and honestly stated.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. tests/control/setTaskLoopConfirmed.test.ts:71-82 — MB3-1 is caught only via the reserve row. A rebuild that kept the frozen reserve
   row but re-derived all tasks from live allocations would stay green, since no fixture has a re-amounted (held/continuing/terminal)
   task. Registered as U8 / R-F12; B7 (P4) is where it is measured. Keep it in the round ledger.
2. src/control/webService.ts:639-644 — pending start-wake bodies keep the superseded `executionSnapshotHash`, and
   executionDriver.ts:709 propagates it to later `drive:` wakes. It is inert today (no reader compares it), but a future consumer that
   trusts it would see a stale hash. Either note in a comment that the wake's hash records what was scheduled, or leave it and register it.
3. src/control/webService.ts:640 — a malformed stored snapshot throws a ZodError / SyntaxError, not `recovery-blocked` (implementer
   concern 2). The transaction still rolls back. Matches the brief as written.
4. tests/control/setTaskLoopConfirmed.test.ts — nothing asserts that the old snapshot record is still readable after the change
   ("old snapshots are kept"). Nothing deletes it today, so this is a coverage gap, not a defect.
5. The `ExperimentalWarning: SQLite` and `input.bundle is okay` lines in the test output predate this task. Noted for completeness.

### Assessment

**Task quality:** Approved

**Reasoning:** The change is the brief's code, exactly. Every named risk checked out either by a criterion that was seen red or by a
focused code check. The only real gap is the full-rebuild case for re-amounted tasks, which was already known and registered (U8)
and is not new to this task.
