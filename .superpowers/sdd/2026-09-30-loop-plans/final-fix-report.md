# Final fix wave report: loop plans (F1–F11)

- Who: final-wave fix implementer (subagent of controller session `1d7d9aa0`). When: 2026-09-30.
- BASE `4117725`. Commits (on `main`, local, not pushed):
  - `704da81` fix(scheduler): report loop tasks together with the plan's other rejections (F8)
  - `deea8f9` test(control): make the loop-plan import and route criteria see what they name (F1, F6, F11)
  - `a9af9c2` chore(control): order the loop-plan error codes and mark previousContractHash as history (F9, F10)
  - `07240ff` fix(web): freeze the plan card where the server refuses, and name its discard button (F2, F3, F4, F5, F7)
- Trailer: both lines present on all four (`final/commits.txt`, from `git log -1 --skip=N --format=...`).
- Evidence is under `SCRATCH/final/`, where SCRATCH=`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`.
  The mutation clone is `SCRATCH/mut-final`. I kept it. Every mutation's restore file (`final/<name>-restore.txt`) is empty, and each restore `cmp` returned rc=0.

## Final GREEN (main tree, working tree = the four commits)

- `npm run typecheck`: rc=0 (`final/final-typecheck.txt`).
- Web typecheck: rc=0 (`final/final-web-typecheck.txt`).
- Root criteria, 8 files, 48 passed (`final/final-root.txt`): loopPlanImport, taskLoopApi, loopPlanCli, errorClassification,
  taskAmendments, planFileLoop, and the pre-existing scenarios S11 and S13. I added S11 and S13 because they are the
  pre-existing criteria that exercise `loadRound`'s rejection path, which F8 changed.
- Web criteria, 5 files, 29 passed (`final/final-web.txt`): loopPlanEdit, loopPlanCard, loopBudgetRows, loopPlanDraft, and
  the pre-existing taskLabelsDraftBase. taskLabelsDraftBase selects the label editor's "Discard draft" by name, so it
  depends on F3.
- `tests/control/loopPlanE2E.test.ts` ran against the real ccloop build and passed: 1 passed, 14.3 s (`final/e2e-real.txt`).
  - Setup: `ORCA_CCLOOP_BIN=SCRATCH/gate-partA/cc/dist/cli.js`, `ORCA_AGENTS_TABLE=SCRATCH/agents/agents.json`, with HOME, XDG and TMPDIR relocated (`final/e2e-env.txt`).
  - Its TMPDIR was empty afterwards (`final/e2e-tmp-after.txt`).
  - `~/.orca` was unchanged: `stat -f '%m %z'` returned `1790516258 128` before and after (`final/orca-stat-before.txt`, `final/orca-stat-after.txt`).
  - The same file without the binary: 1 skipped (`final/e2e.txt`).
- The TMPDIR of the final root and web runs held only `node-compile-cache` afterwards (`final/final-tmp-left.txt`). That is node's compile cache, not a test root.

## Per finding

### F1: restore the planHash equality (Important)

- **Change:** `tests/control/loopPlanImport.test.ts`. `expect(sha256Canonical(archived.plan)).toBe(archived.planHash)` is back as the first assertion of "puts the recipe under planHash".
- **Comment:** the P7 comment above the test is replaced by one that says why the equality is needed (Rule 13: the original ruling stays in rulings.md).
- **Production:** none (test-only).
- **Mutation evidence:**
  - **MF1-1** (the one the findings name). `planImport.ts` computes planHash over the plan without recipes. Result: rc=1, 2/3 red (`final/MF1-1.txt`).
    - Where it went red: at import (`recovery-blocked` thrown from `webFixture`), not at the assertion.
    - Why: import self-verifies the planHash in several places, so a mutant that is inconsistent with the rest of the system cannot reach the assertion.
  - **MF1-2** (the mutant that tests the equality itself). planHash is computed over `{ ...plan, tasks: [] }` ("anything else"). The four self-checks that would otherwise throw first are bypassed:
    - `writeCanonicalRecord` hash check;
    - `readCanonicalRecord` hash check;
    - `readArchivedPlan`'s `sha256Canonical(plan) !== planHash`;
    - `estimator.ts:67` planHash check.
    - Result with the new criterion: rc=1. Red **at the restored equality** (line 37: expected `216fabc6…`, received `740f57e9…`) (`final/MF1-2.txt`).
    - Result with the HEAD version of the criterion under the same mutant: rc=0, 3/3 green (`final/MF1-2-oldtest.txt`). This shows that the dropped equality was the only half that could see it.

### F2: the budget hint's two guards (MB4-9 / MB4-10)

- **Change:** `web/tests/loopBudgetRows.test.tsx`, new criterion "points only the loop task's own work row at the card, not another bucket of it nor another owner with its id".
  - It adds two rows to the fixture: `task a / reserve` and `estimate a / work`.
  - It asserts that the rows carrying "Change it in the plan card" are exactly `["task a / work"]`.
- **Production:** none. Both guards are kept.
- **HEAD:** green (`final/f2-head.txt`, 4 passed).
- **MF2-1 (= MB4-9)**, `owned` without `allocation.bucket === "work" &&`: rc=1. Received an extra row, `task a / reserve` (`final/MF2-1.txt`).
- **MF2-2 (= MB4-10)**, `owned` without `allocation.ownerKind === "task" &&`: rc=1. Received an extra row, `estimate a / work` (`final/MF2-2.txt`).

### F3: `Discard plan draft`

- **Change:** `web/src/LoopPlanCard.tsx:144`. The button now reads `Discard plan draft`. The label editor keeps `Discard draft`.
- **Criterion:** loopPlanEdit, "says a lowered budget … and Discard plan draft drops the draft". It now:
  - asserts there is exactly one `Discard draft` button (the label editor's);
  - asserts the form has none;
  - clicks `Discard plan draft` by its own name.
- **RED at HEAD:** `final/web-red.txt`: "expected … to have a length of 1 but got 2".
- **GREEN:** `final/web-green.txt`.
- **MF3-1** (rename back): rc=1, same assertion red (`final/MF3-1.txt`).

### F4: no "Change plan" where the server always refuses

- **Change:** `web/src/LoopPlanCard.tsx:111-114`. After the "Started" check, the editor is offered only when `summary.state` is draft or ready and `summary.stopMode === null`. Otherwise it shows `The group is not open for changes; the plan is frozen`.
- **Criterion:** loopPlanEdit, "offers no change while the group is past ready or stopped, where the server always refuses (group-state-invalid)".
  - Negative cases: `running`, `review`, and `ready` with `stopMode "pause"`.
  - Positive control: `draft` still offers the button.
- **RED at HEAD:** `final/web-red.txt`: "expected <button>Change plan</button> to be null".
- **Mutations:**
  - **MF4-1** (delete the guard line): rc=1 (`final/MF4-1.txt`).
  - **MF4-2** (drop the state half): rc=1 (`final/MF4-2.txt`).
  - **MF4-3** (drop the stopMode half): rc=1 (`final/MF4-3.txt`). This one goes red at the same line inside the loop. That it is the `pause` case follows by deduction: under MF4-3 the state guard is intact, so `running` and `review` still hide the button.
- **Knock-on edit, loopPlanDraft (a this-round criterion):** its fixture group was `state: "running"`, which is a state where the server refuses set-task-loop. After F4 the card shows no button there (`final/web-green.txt` first run, since overwritten; the failure was "Unable to find … Change plan").
  - I changed the fixture to `ready` (confirmed, not started), with a comment, and changed its group button selector from `/^g · running/` to `/^g · ready/`.
  - This does not weaken what it measures: the draft still survives a refusal and clears on success.
  - The findings allow edits to criteria written in this round.

### F5: the three unmutated B6 branches

- **New criteria in loopPlanEdit:**
  - "names only the first dimension the reserve cannot cover": tokens short by 1 and activeMs short by 2 → expects the tokens alert.
  - "sends the goal and the done-when trimmed, and one entry per non-blank line, trimmed":
    - goal `"  fix login  "`;
    - done-when `" the login test passes "`;
    - Only changes `" src/auth/** \n\n  \n src/login/** "`.
- Both are green at HEAD, because the code was already right. The red evidence comes from the deletion mutations below.
- **Mutations:**
  - **MF5-1**, `lines()` without `.filter(line => line !== "")`: rc=1 (`final/MF5-1.txt`). Also red: the existing first criterion, where the empty list fields become `[""]`.
  - **MF5-2**, goal without `.trim()`: rc=1 (`final/MF5-2.txt`).
  - **MF5-3**, successCondition without `.trim()`: rc=1 (`final/MF5-3.txt`).
  - **MF5-4**, shortfall without `&& shortfall === null`: rc=1, "activeMs short by 2" instead of tokens (`final/MF5-4.txt`).

### F6: "before the ledger" asserts absence from the ledger

- **Change:** `tests/panel/taskLoopApi.test.ts`. After the 400, `GET …/commands/loop-shape` must answer 404 `command-result-not-found`.
- **Production:** none.
- **Mutations:**
  - **MF6-1**, raw schema payload `z.unknown()`: survived, rc=0 (`final/MF6-1.txt`). The effective-command schema still refuses before the ledger, so there are two independent guards.
  - **MF6-2**, both schemas loosened: rc=1, but the status goes to 500 before the lookup is reached (`final/MF6-2.txt`).
  - **MF6-3** (the discriminating mutant): both schemas loosened, and the shape check moved *inside* `setTaskLoop`'s apply (it throws `control-non-json-payload`, so the refusal is ledgered as 400).
    - With the new criterion: rc=1, red at the lookup, "expected 200 to be 404" (`final/MF6-3.txt`).
    - With the HEAD version of the criterion: rc=0, 4/4 green (`final/MF6-3-oldtest.txt`). The old test could not see a ledgered refusal.

### F7: no plan chip for a hand-written task

- **Change:** `web/tests/loopPlanCard.test.tsx`, new criterion "puts no plan chip next to a hand-written task". It renders the task list with `loopPlan: null`, checks the row is there, and checks there is no `span.plan-chip`.
- **Production:** none.
- **HEAD:** green.
- **MF7-1**, chip rendered when `item.loopPlan !== undefined` (with `?.planName`): rc=1, an empty chip rendered (`final/MF7-1.txt`).

### F8: loadRound reports loop refusals together with loadPlan's

- **Change:** `src/scheduler/run.ts:158-172`.
  - Loop tasks are now read from the raw `tasks` array, because a plan that loadPlan rejects has no parsed tasks.
  - A task counts when it is an object with a `loop` key and a string `taskId`.
  - Their `loop-plan-cli-unsupported:<id>` rejections are appended after loadPlan's rejections.
  - If both lists are empty, the flow is unchanged.
- **Criteria:** `tests/scheduler/loopPlanCli.test.ts`.
  - (a) "reports it together with the plan's other rejections, all at once": a relative `runsDir` plus loop task T1 → `["relative-path", "loop-plan-cli-unsupported:T1"]`.
  - (b) "reads loop tasks from a malformed plan's raw tasks without failing on their shape": `tasks: "not a list"`, and `["x", null, {taskId: 7, loop}, {taskId: "T2", contract}]` → only `malformed`.
  - Criterion (b) was written after the implementation, so its red comes from mutations. It was added because the raw scan's guards had no criterion that could go red (see Self-review).
- **RED at HEAD for (a):** `final/f8-red.txt`: received `["relative-path"]`.
- **GREEN:** `final/f8-green3.txt` (with S11 and S13).
- **Mutations on the final code:**

| Mutation | Edit | Red on | Evidence |
|---|---|---|---|
| MF8-1 | the old early `return result` for loadPlan rejections | (a): `["relative-path"]` | `final/MF8-1.txt` |
| MF8-2 | loadPlan's rejections dropped from the combined list | (a) and (b) | `final/MF8-2.txt` |
| MF8-3 | `"rejections" in result ||` dropped | S11, S13 ×4, (b): `result.plan` undefined | `final/MF8-3.txt` |
| MF8-4 | `Array.isArray(rawTasks) ? … : []` → cast | (b): `rawTasks.flatMap is not a function` | `final/MF8-4.txt` |
| MF8-5 | `typeof task === "object"` dropped | (b): `'in'` on the string `x` | `final/MF8-5.txt` |
| MF8-6 | `task !== null` dropped | (b): `'in'` on null | `final/MF8-6.txt` |
| MF8-7 | `"loop" in task` dropped | (b): `loop-plan-cli-unsupported:T2` | `final/MF8-7.txt` |
| MF8-8 | `typeof taskId === "string"` → `!== undefined` | (b): `loop-plan-cli-unsupported:7` | `final/MF8-8.txt` |

- An earlier form of the scan (an `entry` variable) had two mutants that survived (null check and `"loop" in`). Those results are in the earlier `MF8-5` and `MF8-7` files, overwritten by the reruns above.
- I simplified the scan to one expression and widened criterion (b). All MF8 mutations were then re-run on the committed code.

### F9: previousContractHash is history only

- **Change:** `src/control/taskAmendments.ts:30`, one comment line.
- No behavior change and no criterion. taskAmendments.test.ts: 12 passed.

### F10: error codes in alphabetical order

- **Change:** `src/control/errors.ts`. Five moves, no status changed:
  - `task-loop-version-conflict` after `target-version-conflict`;
  - `budget-owned-by-loop-plan` after `budget-overflow`;
  - `group-reserve-insufficient` after `group-project-binding-required`;
  - `loop-plan-invalid` after `landing-needs-review`;
  - `task-already-started` and `task-has-no-loop-plan` after `snapshot-required`.
- The served `errorCatalog` is sorted in `controlConfig.ts:243-245`, so key order has no effect there.
- errorClassification.test.ts: 9 passed.

### F11: the answer.txt overlap is deliberate

- **Change:** `tests/control/loopPlanE2E.test.ts:28-29`. The comment now continues: tasks a and b share answer.txt in their write sets on purpose; it is the fake codex's file, not a real overlap.
- The criterion ran green against real ccloop (see above).

## Files changed

- `src/scheduler/run.ts`
- `src/control/errors.ts`
- `src/control/taskAmendments.ts`
- `web/src/LoopPlanCard.tsx`
- `tests/scheduler/loopPlanCli.test.ts`
- `tests/control/loopPlanImport.test.ts`
- `tests/panel/taskLoopApi.test.ts`
- `tests/control/loopPlanE2E.test.ts`
- `web/tests/loopBudgetRows.test.tsx`
- `web/tests/loopPlanCard.test.tsx`
- `web/tests/loopPlanDraft.test.tsx`
- `web/tests/loopPlanEdit.test.tsx`

## Departures and concerns

1. **F4's frozen line is a new string, `The group is not open for changes; the plan is frozen`.** The review suggested reusing `Started; the plan is frozen`. That would be false for a task that has not started in a running or paused group (Rule 12). The string is not in the R-F5 table; the controller should confirm it or pick another.
2. **F1's MF1-1 goes red by a throw at import, not at the restored assertion.** Import self-verifies planHash in four places. MF1-2 is the mutant that bypasses them, and it shows the equality itself red and the HEAD criterion green.
3. **F6 needed a two-part mutant (MF6-3) to reach the lookup assertion.** The simple payload-schema loosening (MF6-1) survives because a second schema guard exists.
4. **loopPlanDraft's fixture state changed from `running` to `ready`.** This was forced by F4. The old fixture described a state the server refuses.
5. **F8 criterion (b) was not seen red before implementation.** It was added afterwards to cover the raw-scan guards. It was seen red under MF8-2 and MF8-4..8.
6. I ran no full suite, per the dispatch. The Part B gate (B8) is still owed; final review Important 2.
