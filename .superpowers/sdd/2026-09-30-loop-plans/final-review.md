# Final whole-branch review: loop plans (65e64a3..4117725)

- Who: final whole-branch reviewer (subagent of controller session `1d7d9aa0`, model Fable 5.1). Read-only on the tree.
- When: 2026-09-30. HEAD at review time: `41177255a6464acfef332db1474b4dfb3ccada0f` (`git rev-parse HEAD`).
- Inputs: spec `docs/superpowers/specs/2026-09-30-loop-plans-design.md` (rev 2 + §11), plan
  `docs/superpowers/plans/2026-09-30-loop-plans.md` ("Controller rulings on the draft" first), `rulings.md` P1–P10,
  `progress.md`, `review-65e64a3..4117725.diff` (4409 lines, read whole in six passes), the A1/A2/B1/B2/B3 implementer
  reports' mutation tables, the A6/B6 task reviews, and the HEAD sources named below (every line number re-measured at
  HEAD with `grep -nF`; the diff's own line numbers are not cited).
- Ignored as instructed: `ab4f2c9` (controller checkpoint) and its `.orca/checkpoints/*.json` hunk.

## Verdict

**Ready after fixes.** No Critical finding. The end-to-end path is sound and measured; what remains is (a) one criterion
that cannot see what it claims to protect, (b) four cheap Rule 9 / accessibility items the controller already intends to
fix, and (c) the Part B gate (plan Task B8), which has not run: the last whole-suite evidence in the ledger is the Part A
gate at `a2010f0`, eight feature commits ago.

## Strengths

- **The amendment layer is right and every reader goes through it.** `effectivePlanTask` (`src/control/taskAmendments.ts:68`)
  verifies hash, group, task, `loopVersion`, contract hash and re-expansion, then is called from all five reader sites the
  plan's reader table names: `verifyTaskSet` and A2 in `executionSnapshot.ts`, `readArchivedContract` in `queries.ts`,
  confirm in `webService.ts`, `readControlGroup` in `controlViews.ts`. B1's MB1-1..5c saw each bypass red; B3's MB3-6 saw
  the A2 bypass red again after the command existed. `readArchivedPlan`'s planHash authority is untouched (spec §5.1).
- **Conservation is kept on every path and is checked by the code itself.** Draft path reuses `resetDraftReserve` +
  `reopenProposal` (P5 honoured, no duplicated ledger arithmetic; `editProposal` and `proposalSetAgent` were refactored onto
  the same helper and the existing suite stayed green). Confirmed path moves `committedRemaining`, the reserve row,
  `explicitUnallocatedReserve` and `work.grant.work` together (`webService.ts:572-656`) and ends with
  `readConfirmedTaskExecution` + `assertKnownConservation` inside the transaction (`:650`, `:653`); the self-check
  rollback is measured (`setTaskLoop.test.ts` "rolls a confirmed change back"). `expectConserved` pins
  reserved + reserve = limit − used per dimension, before and after confirmation, raising and lowering.
- **Snapshot copy, not rebuild.** `replaceTaskInSnapshot` (`executionSnapshot.ts:274`) touches one derived entry and two
  allocation rows, re-parses, and refuses a snapshot missing either (both refusals seen red, MB3-15/16). `proposalVersion`
  is unchanged and measured (MB3-2 red). B7 runs the changed contract through the real ccloop build and compares the rest
  of the snapshot byte-for-byte with a budget raise (P4), so the full-rebuild mutant is red on the shipped criterion.
- **Hand-written groups are byte-identical.** `normalizeControlPlan` and `readSchedulerControlPlanSource` add `loop` only
  when present (never `undefined`, never defaulted — the labels lesson applied); `loadPlan` still returns the old task
  shape for contract tasks (`planFileLoop.test.ts` "still loads the contract form unchanged"); a hand-written task's
  archived entry has no `loop` key (criterion). The only additions a hand-written task sees are the spec'd view fields
  `loopPlan: null` and `objective`.
- **Names, codes and strings agree across the seam.** Every `set-task-loop` refusal code named in the plan exists in
  `errors.ts` with a sensible status (409 for the version conflict, 422 for the rest); the `errorCatalog` served to the web
  is built from the same map, so no web mirror is needed. The five plan names are mirrored in `WEB_LOOP_PLANS` with a
  runtime parity criterion against the registry (`taskLoopApi.test.ts`); the `set-task-loop` payload has compile-time
  parity both ways (`webParity.test.ts`). Every web string I checked is the R-F5/P1 English form, singulars included.
- **Rule 17.** Every criterion writes under `mkdtemp` roots scoped by `tests/setup/scopeTmpdir.ts`; the E2E relocates HOME
  (`relocateHome`); the Part A gate recorded `~/.orca unchanged`. `planFileLoop.test.ts`'s `mkdtemp` under `tmpdir()` is
  inside the scoped root and removed by its `afterAll`.
- **Rule 9 across the spec's mutation list.** All 13 spec §6 mutations were run and seen red (A1: MA1-1/2/3/4/5; A2:
  MA2-1; B1/B3: MB1-1, MB3-6; B2/B3: MB2-1/MB3-8, MB2-2, MB2-8/MB3-3, MB2-3/MB3-7; B3/B7: MB3-1, MB3-2). The spec §6
  criteria 1–13 each map to a shipped criterion (list at the end).

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **The "recipe is under planHash" criterion cannot see what it protects.**
   `tests/control/loopPlanImport.test.ts:32-39`. After P7 dropped `sha256Canonical(archived.plan) === archived.planHash`,
   the remaining assertion (`sha256Canonical(withoutRecipe) !== archived.planHash`) is true whatever `planHash` was computed
   over — a planHash computed over the plan *without* recipes, or over anything else, passes it. The dropped equality is not
   a read-back of the test's own input: it recomputes the hash from the archived bytes and compares with the stored value,
   so it is the half that makes the pair meaningful. The ledger already records this ("P7 was wrong for A4 … restore it in the
   final fix wave"); I confirm, and rate it Important rather than Minor because criterion 6 (R12) is the recipe-integrity
   guarantee the whole amendment design rests on. Fix: restore the equality as the first assertion of the same test.

2. **The Part B gate has not run.** `progress.md` ends at "Final review: dispatched"; there is no B8 line. Eight commits
   (`3a75bd7`..`4117725`) changed `executionSnapshot.ts`, `queries.ts`, `webService.ts`, `controlViews.ts`, three web files
   and two shared fixtures since the last whole-suite run. Per-task runs were single files plus typecheck. Before hand-off:
   run B8 as written (fresh clones, ccloop pin, full root + web suites, tmp-leak, `~/.orca` unchanged), and re-check the two
   registered flakes (`driverLanding`, `driverRecovery`) solo if they go red under load again.

### Minor (Nice to Have)

New findings (not in the ledger):

3. **`loadRound` reports loop-task refusals only when the plan has no other rejection.** `src/scheduler/run.ts:162-167`
   runs after `loadPlan` returned no rejections, so a plan with, say, a cycle *and* a loop task reports the cycle first and
   the loop task only on the next run — against `loadPlan`'s stated "all reported at once" design. CLI-only and the CLI
   refuses loop tasks wholesale, so low impact; fix by appending the loop rejections to `loadPlan`'s list instead of
   returning early. Not asked of any task; report to the controller.

4. **`chosenByLabel` is recomputed at view time from the label table, not stored.** `src/panel/controlViews.ts:494` runs
   `choosePlanByLabels(task.labels)` on every read. If the §2.4 table ever changes, an old recipe with `chosenBy: "labels"`
   would show the label the *new* table picks, which may not even choose `task.loop.planId`. Today the table is v1 and the
   recipe schema is inside planHash, so nothing is wrong now; register with the "first v2" items (A1's newest-version note).

5. **A budget-only change writes an amendment whose contract bytes equal the previous ones and marks the card "changed".**
   `webService.ts:609` treats same-bytes + different budget as not a no-op (correct: the budget moved), and `:623` then
   writes a record with `previousContractHash === originalContractHash`. Harmless, but the card's " · changed" then means
   "changed through set-task-loop", not "contract changed". Either wording in the card or a note in the spec's §4.1.

6. **`previousContractHash` is stored but never verified.** `taskAmendments.ts:30` requires it; `:80` checks group, task and
   version but not that `previousContractHash` names the archived hash or the prior amendment's `originalContractHash`. The
   record is content-addressed so it cannot be tampered without detection, and the command always writes the true value;
   it is history only. Fine for v1; say so in the schema comment so nobody relies on it as a chain.

7. **`durableCommandErrorStatuses` entries are out of the map's alphabetical order.** `src/control/errors.ts:49`,
   `:119-126` (`group-reserve-insufficient` after `group-state-invalid`, `task-already-started` / `task-has-no-loop-plan` /
   `budget-owned-by-loop-plan` between `group-state-invalid` and `group-stopped`). Style only; move when next touched.

8. **`tests/control/fixtures/ccloopWorld.ts` `Task.targetPaths` stays required for a loop task and is ignored for it.**
   The E2E passes `targetPaths: ["shared.txt"]` and a `loop` that names its own paths. Make `targetPaths` optional when
   `loop` is set, or drop it from the two E2E entries, so the fixture cannot lie.

Deferred minors from the ledger that I looked at again and agree should stay registered are listed in the triage below.

## Deferred-minor triage

The controller asked which deferred minors must be fixed before hand-off and which may stay registered. "Fix in final
wave" lines are the controller's intent; each is confirmed or overruled.

### Must fix now

| Ledger line | Ruling | Why |
|---|---|---|
| A4: restore `sha256Canonical(plan) === planHash` (marked for the final wave) | **Confirm** | Important 1 above: without it criterion 6's import half is vacuous. |
| B4: MB4-9/10 — add one criterion seen red under each guard, keep both guards (marked) | **Confirm** | Rule 9 / P3: two live branches in `web/src/BudgetEditor.tsx:275` with no red. A non-task row whose `ownerId` equals a loop task id is a real shape (an estimate row cannot today, but the guard exists for it). One fixture row + one assertion. |
| B6: rename the plan form's discard button to `Discard plan draft` (marked; P1 amended in the ledger) | **Confirm** | `web/src/LoopPlanCard.tsx:140` vs `TaskDetail.tsx:152`: two enabled buttons with one accessible name, each destroying typed text with no undo. One string plus the one `getByRole` in `loopPlanEdit.test.tsx` that selects it inside the form. |
| B6: hide "Change plan" where the server always refuses `group-state-invalid` (marked) | **Confirm, narrowly** | `LoopPlanCard.tsx:110-112` gates on the task only. A paused group (`stopMode !== null`) is reachable on the Web path and is exactly the case where a person fills the whole form and is refused. Freeze on `view.summary.state` not draft/ready or `stopMode !== null`, and show the same "frozen" line. A criterion for it is cheap (render with `state: "running"`). |

### Recommended in the same wave (cheap; not blocking)

- B6: the three branches with no named mutation (`LoopPlanCard.tsx:60` blank-line filter, `:93` first-dimension-only
  shortfall, goal/success `.trim()`): each is a few lines in `loopPlanEdit.test.tsx` (type `" a \n\n b"` and expect two
  lines; two short dimensions and expect the first named). P3 asks for them; the server re-checks everything, so the risk
  is display only.
- B5: `tests/panel/taskLoopApi.test.ts:63` says "before the ledger" but asserts only the 400; add the command-lookup 404
  so the name is true (Rule 12).
- A6: one assertion that a hand-written task renders no `span.plan-chip` (`web/src/ControlGroupView.tsx:130`, null arm).

### Stay registered (agree with the ledger)

- A1: dead `startsWith("/")` (equivalent mutant MX-4); "current version is the highest" criterion when a v2 appears
  (MX-20b/c); R-F15 sub-condition mutations.
- A2: `", "` joiner unpinned; `describeLoopPlan` trusts expanded recipes.
- A3: `run.ts` `!isLoopPlanTask` filter is type narrowing only (MA3-11); `orca run` exit-code assertion not discriminating
  (stderr is); `loop!` assertion.
- A5: MA5-10 — `webParity` cannot see a missing optional field; needs a compile-time key-set check (follow-up for the
  parity file, not this feature). The other A5 minor ("B1 must switch the view's objective to the effective contract") is
  **done**: `readControlGroup` maps every task through `effectivePlanTask` before `workViews`/`taskPlanView`, and
  `taskAmendments.test.ts` asserts `objective` and `summary[0]` from the amended contract. Mark it closed.
- B1: dead rethrow (MB1-P3e), `row === undefined` (MB1-P3f) equivalents; the bare `.toThrow()` at
  `tests/control/taskAmendments.test.ts:84-85` — the only thing that can throw there is the schema parse, and MB1-P3h saw
  its deletion red, so the criterion does discriminate; naming `ZodError` would be tidier, not necessary.
- B2: MB2-12 (`work.status` half unreachable without a hand-built state), MB2-15 typecheck-only, `expectUntouched` checks
  task a only, refused-before-write vs rolled-back indistinguishable to the helper, SQLite warning noise.
- B3: no re-amounted held/continuing/terminal task criterion (U8/R-F12; needs the handoff machinery — registered);
  start-wake bodies keep the old snapshot hash (R3: nothing reads it); malformed stored snapshot throws ZodError not
  `recovery-blocked` (rolls back either way); old snapshot readability; MB3-16 red by error type; mirror hash covered only
  through `saveWebAuthority`.
- B4: hint repeated per dimension cell with a leading space; `loopTasks` read from the archived plan (correct while a
  hand-written task cannot gain a loop).
- B5: runtime `WEB_LOOP_PLANS` const in `controlTypes.ts` (brief-mandated; it is what the picker renders).
- B6: `aria-describedby` from the disabled button to the shortfall alert; negative "left" figure on the disabled button;
  `"; "` joiner density; unused `config` in `loopPlanEdit.test.tsx`.
- B7: comment that tasks a and b sharing `answer.txt` is deliberate (`tests/control/loopPlanE2E.test.ts:26` already says
  why `answer.txt` is there; add the one clause about the overlap); other `ccloopWorld` users re-run by the B8 gate.

## Cross-task consistency — what I checked and found consistent

- **Refusal order vs spec §5.2.** Ledger (`assertKnownConservation`) → group state/stopped → `work-not-found` →
  `task-already-started` (status *or* any `runs` row, inside `BEGIN IMMEDIATE`) → `estimate-in-flight` (the
  `webDispatch` predicate, F8) → `task-loop-version-conflict` → `task-has-no-loop-plan` → `loop-plan-invalid:<reason>`
  → `no-op-command` → `group-reserve-insufficient:<dim>:<shortfall>` → `numeric-overflow` → writes. The reserve refusal is
  moved before any write (`webService.ts:611-614`), which is stricter than the spec's step order and correct.
- **Version arithmetic** is the same on both sides: `effectivePlanTask` reads `loopVersion ?? 0`
  (`taskAmendments.ts:80`), the command reads `typeof work.loopVersion === "number" ? … : 0`, the view reports
  `body.loopVersion ?? 0`, and the form sends the version it started from.
- **"Started" is the same predicate in three places:** server (`status` not draft/ready or any `runs` row), web
  (`status` or `lineageRunIds.length > 0`, and the projection proves `lineageRunIds` equals the persisted run ids for the
  task, `controlViews.ts:529-532`), and `assertKnownConservation` (draft/ready ⇒ full allocation).
- **repoPath** is never in the recipe (F9): import uses `plan.targetRepo`; every re-expansion (projection, amendment
  reader, command) takes the stored contract's own `context.repoPath`; A2 overwrites it with the run workspace as before.
- **`chosenBy`**: import records `labels`/`explicit`; every `set-task-loop` records `explicit` (spec §2.4: labels never
  choose after import); the card title maps the three cases to the R-F5 strings.
- **The stale reserve row inside the copied snapshot** is by design (spec §5.2 step 7, F12) and safe: the only readers of
  snapshot allocations filter `ownerKind !== "reserve"` (`executionSnapshot.ts:318`, `controlViews.ts:352`);
  `stopIntent.ts:757` reads the *proposal's* reserve row, which the command does update.
- **`proposal.state` is only `editable | confirmed`** (`webProtocol.ts:1092`), so the command's else-branch and its
  `executionSnapshotHash!` are sound.
- **The English table.** Registry names/disciplines (`loopPlans.ts`), summary lines (`describeLoopPlan`, `:240`), card
  title and fixed lines, field labels, consequence text, both validation messages, the version notice, the budget-editor
  hint and the frozen line all match R-F5 + P1 (singular forms included). No Chinese string reached code.
- **Import → view → change (draft) → confirm → A2 → ccloop.** Measured end to end: `setTaskLoop.test.ts` (draft change,
  stale confirm refused, fresh confirm, A2 sees the new goal and raised `tokenBudget`) and `setTaskLoopConfirmed.test.ts`
  (confirmed change, claim runs the new contract to settled; claim-first refused; sibling keeps running) and
  `loopPlanE2E.test.ts` (real ccloop build, envelope carries the changed goal, both tasks land, rest of snapshot
  byte-identical). The draft-path change is not itself driven to a run, but its confirm output is the same snapshot shape
  the confirmed-path E2E drives.

## Declined to judge

Set aside as outside this spec/plan; the executor rules on each.

- Panel threat model: `set-task-loop` now carries executable `checks` over HTTP. The panel binds `127.0.0.1` with a
  one-time token by default and `--bind` is explicit (`src/panel/server.ts:112`, `src/cli.ts:52`), and D5/§4.2 require the
  form to edit checks. Whether the panel's auth model should be revisited for command-carrying payloads is a product
  question, not this feature's.
- Git-backed `denylistPaths` / `maxFilesTouched` (spec §8, R4) — registered by the spec.
- `rejectOn` tokens against a real verifier (C4, §8) — needs a paid call; registered.
- `proposal-edit` on a Web group whose tasks have started (§8) — pre-existing, registered.
- Re-estimating after an amendment estimates the archived (old) contract (spec §5.1, R-F14) — spec-accepted.
- The amendment record carries no actor/timestamp (Rule 13). Consistent with every other canonical record here (derived
  contracts, snapshots); attribution lives in the `commands` ledger row that wrote it. A spec-level convention, not this
  branch's to change.
- The re-amounted-task case of the full rebuild (U8) — the controller registered it; needs handoff machinery to reach.
- Loop tasks on the CLI path, user-defined plans, per-plan budget defaults (§0.1).

## Spec §6 criteria → shipped criteria (coverage map)

1 `loopPlans.test.ts` "expansion is pure and pinned" · 2 "each plan's rules land in the contract" · 3 "refusals" (+
`investigate-max-files`, P2) · 4 `planFileLoop.test.ts` + `loopPlanCli.test.ts` (plan/run/controlled/profiled) · 5
"choosing a plan from labels" · 6 `loopPlanImport.test.ts` + `planFileLoop.test.ts` (import half; **Important 1**) +
`loopPlanDrift.test.ts` (tampered = registry drift; a directly edited recipe is caught earlier by planHash) · 7
`loopPlanSummary.test.ts` (F6 form) · 8 `setTaskLoop.test.ts` refusals + `loopBudgetOwner.test.ts` · 9 draft
(`setTaskLoop.test.ts`) and confirmed (`setTaskLoopConfirmed.test.ts`), raise and lower · 10 `setTaskLoopConfirmed.test.ts`
"byte-identical" + `loopPlanE2E.test.ts` (real ccloop) · 11, 12 `setTaskLoopConfirmed.test.ts` driver block · 13
`taskAmendments.test.ts` nine tamper rows.

## Recommendations

- Run B8 first; then the must-fix list; then B8 again only if a production file changed (the four must-fix items touch
  one production string and one web guard-free criterion; the A4 fix is test-only).
- When the first plan v2 lands: add the "current version is the highest" criterion (A1) and decide whether `chosenByLabel`
  belongs in the recipe (Minor 4).
- Fold Minor 3 (`loadRound` all-at-once) into the next CLI touch; not worth its own commit now.
