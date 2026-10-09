### Task C4: Append the two ERRATUM sections (spec §3.3)

**Files:**
- Modify (append only, Rule 13 — original text untouched) `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`
  (1735 lines; last section `## ERRATUM (agent selection, 2026-09-26) — what the browser may send (section 3.1)` at line 1717; ends with a newline).
- Modify (append only) `docs/superpowers/plans/2026-09-25-handoff-delivery.md` (5576 lines; ends with a newline; gap row at line 75).

**Interfaces:** none (documents). Consumes the commit subjects of C1-C3.

- [ ] **Step 1: Write the failing check** — a command that is red now and green after the append:
```
cd /Users/biran/code/skills/loop/Orca-issues && grep -c -F '## ERRATUM (issue fixes, 2026-10-08) — idle groups at panel shutdown' docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md > $SCRATCH/c4-a.txt; echo rc=$?; grep -c -F '## ERRATUM (issue fixes, 2026-10-08) — gap D-RESUME-SHUTDOWN is closed' docs/superpowers/plans/2026-09-25-handoff-delivery.md > $SCRATCH/c4-b.txt; echo rc=$?
```
- [ ] **Step 2: Run, expect FAIL** — both rc=1 (count 0). Also re-measure the anchors cited in the web-spec erratum:
`grep -n -F 'for a dispatch-enabled group with no active run, persists a shutdown stop intent' docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` must list line 1274 (and 1677, the earlier erratum quoting it);
`grep -n -F 'A ready group with no active run receives a shutdown intent with an empty frozen set' …` must list line 1282. If the numbers differ, change only the numbers in the text below.

- [ ] **Step 3: Implement** — verify each file still ends with exactly one newline, then append the following text
verbatim (first line blank).

To `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`:
```markdown

## ERRATUM (issue fixes, 2026-10-08) — idle groups at panel shutdown

Appended 2026-10-08 by the implementer of Task C4 of the issue-fixes plan
(`docs/superpowers/plans/2026-10-08-issue-fixes/part-C.md`), under Orca development session `e34dc963`, in the commit
whose subject is `docs: errata for the shutdown stop-intent lifecycle`. The statements below are superseded by
`docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3 (invariant S1 and §3.2). The original text above, and the
earlier `ERRATUM (handoff delivery, 2026-09-25)` that quotes it, are kept verbatim.

1. **Invariant S1.** A persisted `shutdown` stop intent exists only when the shutdown froze at least one active run
   (including strengthening a pause because a run was active). The idle-group clause of §6.4 step 3 (line 1274: "for a
   dispatch-enabled group with no active run, persists a shutdown stop intent so no claim can begin during drain") no
   longer holds. During drain no claim can begin anyway: step 1's in-memory admission gate refuses every mutation and
   every scheduler claim, so the durable row protected nothing and its only lasting effect was a dead end after restart.
2. **The sentence at line 1282** — "A ready group with no active run receives a shutdown intent with an empty frozen set,
   reaches `handoff-complete`, and after restart uses an empty `resume-from-handoff` followed by an explicit `start`." —
   is superseded. A group with no active run (ready, never started, or all done) that has no earlier stop intent and is
   not driver-owned is listed in the shutdown result with the disposition `unchanged-idle` (`changed: false`): no stop
   intent, `stopped` unchanged, command revision and projection unchanged. After a restart it is started like any ready
   group, with no resume step. Driver-owned groups (`skipped-driver-owned`), paused groups with no active run
   (`preserved-pause`) and groups under an existing handoff or shutdown intent are unchanged; `skipped-driver-owned` is
   decided before `unchanged-idle`. Implemented in `src/panel/controlLifecycle.ts` (`shutdownGroup`), the strict result
   enum in `src/control/webProtocol.ts` and its mirror in `web/src/controlTypes.ts`, in the commit whose subject is
   `fix(control): shutdown writes no stop intent for an idle group`.
3. **Stores written before this change are healed at startup.** Panel startup recovery (`recoverControl`,
   `src/control/recovery.ts`), in its own transaction before scheduler wakes are delivered, deletes every `shutdown`
   intent whose `frozenRunIds` is empty, sets that group's `stopped` to `false`, records one projection change per healed
   group without advancing the command revision, and writes one `stop-cleared` activity row with
   `{reason: "empty-shutdown-intent"}`. An empty frozen set has no requests or outboxes, so crash-after-commit
   redelivery of a real shutdown is unaffected. Commit subject: `fix(control): recovery heals empty-frozen-set shutdown intents`.
4. **A real shutdown is left through the resume dialog.** A group whose stop mode is `shutdown` and whose stop state is
   `handoff-complete` is offered the same resume dialog as a human handoff-stop (`resume-from-handoff`, with or without
   selections), and every stopped group shows one banner naming how it stopped, its stop state and the way out. Commit
   subject: `feat(web): stop banner and the resume dialog for a completed panel shutdown`.
```

To `docs/superpowers/plans/2026-09-25-handoff-delivery.md`:
```markdown

## ERRATUM (issue fixes, 2026-10-08) — gap D-RESUME-SHUTDOWN is closed

Appended 2026-10-08 by the implementer of Task C4 of the issue-fixes plan
(`docs/superpowers/plans/2026-10-08-issue-fixes/part-C.md`), under Orca development session `e34dc963`, in the commit
whose subject is `docs: errata for the shutdown stop-intent lifecycle`. The text above is kept verbatim.

§0.1 row `D-RESUME-SHUTDOWN` recorded as a known gap that the panel renders no continuation or resume button for a group
with `stopMode === "shutdown"`, so a non-driver group frozen by a panel shutdown had no exit in the panel. The gap is
closed by `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3.2 (3): `ControlGroupView`'s `handoffActive` now
covers both `handoff` and `shutdown`, so a `shutdown` group in stop state `handoff-complete` gets the same resume dialog
(`Continue selected tasks (n)` or `Resume (no continuation)`) as a human handoff-stop. The idle groups that most often hit
the gap no longer get a shutdown intent at all (same spec, §3.2 (1), disposition `unchanged-idle`), and stores written
before that change are healed at startup (§3.2 (2)). Implemented in the commits whose subjects are
`fix(control): shutdown writes no stop intent for an idle group`,
`fix(control): recovery heals empty-frozen-set shutdown intents` and
`feat(web): stop banner and the resume dialog for a completed panel shutdown`; pinned by
`web/tests/stopBanner.test.tsx`, `tests/control/shutdownHealing.test.ts` and the rewritten criteria in
`tests/panel/controlLifecycle.test.ts`, `tests/panel/shutdownDriverGroup.test.ts` and `tests/control/webFaults.test.ts`.
```

- [ ] **Step 4: Run, expect PASS** — rerun the Step 1 command: both rc=0 with count `1`. Then prove the originals are
untouched: `git -C /Users/biran/code/skills/loop/Orca-issues diff -U0 -- docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md docs/superpowers/plans/2026-09-25-handoff-delivery.md > $SCRATCH/c4-diff.txt` and read it whole: every hunk header starts at the old file's end (`@@ -1735,0 …` and `@@ -5576,0 …`), and there is no `-` line.
- [ ] **Step 5: Mutation** — not applicable (documents; the Step 4 diff check is the criterion: an edit inside the
original text shows as a `-` line and a hunk not at the end).
- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md docs/superpowers/plans/2026-09-25-handoff-delivery.md
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "docs: errata for the shutdown stop-intent lifecycle

Issue-fixes spec §3.3: the web control spec's idle-group shutdown clause and its
empty resume-from-handoff sentence are superseded by invariant S1; the handoff
delivery plan's gap D-RESUME-SHUTDOWN is closed. Appended; original text untouched.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Points for the controller (flagged, design not changed)

1. **§3.4's rewrite list is incomplete.** Four more existing criteria pin the old idle-group intent and go red under C1
   (table above, marked "not named in §3.4"). The plan rewrites them under the same approval; the human should see them
   listed in the ledger.
2. **`continue-task` buttons are refused buttons that stay rendered.** `applyContinueTask` refuses any group with a stop
   intent (`group-stopped`, `src/control/continuation.ts`), yet the per-task `Continue task <id>` buttons are rendered
   only at `handoff-complete`, i.e. always under a stop intent. Spec §3.2 (4) ("buttons the current stop mode refuses are
   not rendered") read strictly would remove them, which rewrites `web/tests/handoffResume.test.tsx` ("offers only the
   handed-off task…", `getByRole("button", { name: "Continue task b" })`) and `web/tests/controlI18n.test.tsx` /
   `controlPanel.test.tsx` lines asserting them — not named in §3.4. C3 keeps them (scope read as Start / Pause /
   Handoff-stop, the buttons §3.4's web criterion names). Decide whether they should go.
3. **Banner "one action" for `handoff-partial` / `handoff-unresolved`.** The spec names only `stopping` and
   `handoff-complete`. Web spec §6.4 says partial/unresolved groups "remain stopped" with no resume; the banner text
   points to Retry recovery "when it is offered". Whether a `handoff-partial` group (a frozen run `settled-unrecoverable`)
   has any exit at all is not defined by either spec.
4. **The banner names the way out in words; the buttons stay in the Dispatch section.** Moving them into the banner was
   not needed for any criterion and would split the resume dialog from `Continue task` buttons. Reversible.
5. **`stop` activity rows for shutdown-created intents.** Spec §5.2's table writes `stop` when "a group stop intent is
   created", while §1 lists shutdown among commands with no activity rows. C1 writes none from `shutdownGroup`; Part B owns
   the per-kind writing sites and should state which reading it took.
6. **Equivalent mutant in C2** (explicit `recordProjectionChange` masked by `recordActivity`), stated in C2 Step 5.
