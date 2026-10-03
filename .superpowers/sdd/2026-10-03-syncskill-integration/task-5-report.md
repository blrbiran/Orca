# Task 5 report — set-task-loop carries `skills`; the panel keeps them

- Who: Task 5 implementer subagent, session https://claude.ai/code/session_011R9aYJnHfJXDpdJ3YM1YW9
- When: 2026-10-03
- Base: 7ab2fa2. Commit: **edf59e3** `feat(set-task-loop): change a task's skill set, before or after confirmation` (main, local, not pushed)
- All runs in the `git clone --local` copy at `scratchpad/t5` (node_modules symlinked; HOME + 4 XDG roots → `scratchpad/env/*`; TMPDIR = `/private/tmp/oc-bV74`).

## What changed

| File | Change |
|---|---|
| `src/control/webProtocol.ts` | `setTaskLoopPayloadSchema.skills: loopSkillsSchema.optional()`; `loopPlanViewSchema.skills: loopSkillsSchema.optional()` |
| `src/control/webService.ts` | `setTaskLoop` → `async`: admission gate entered, replay preflight, then `lookupPayloadSkills(payload.skills, syncskill)` before the transaction (reuses Task 4's `SkillLookup`, `UNCONFIGURED_SYNCSKILL`, `syncskillRefusal`). In the transaction: names normalised (`normalizeLoopSkills`; bad ⇒ `loop-plan-invalid:skills-shape`); `kept` still compares `inputs` only; `keptExpansion` builds the recipe from the current one minus its old `skills` plus the payload's (key omitted when none); non-kept path passes skills to `expandLoopPlan`; no-op test also compares `current.loop?.skills` with `expanded.recipe.skills` (canonical bytes); lookup failure thrown after `numeric-overflow` (after every existing check, before any write); confirmed branch passes `{profile:null,names}` / `{profile, names: looked-up members}` / `null` to `replaceTaskInSnapshot` |
| `src/control/executionSnapshot.ts` | `replaceTaskInSnapshot(..., skills: {profile, names} \| null)`: filters the task's entry out, adds the new one, sorts by taskId, deletes the key when empty |
| `src/panel/controlApi.ts` | `await service.setTaskLoop(command)` |
| `src/panel/controlViews.ts` | loop plan view exposes `skills` (conditional spread; absent when none) |
| `web/src/controlTypes.ts` | `LoopSkillsV1`; `LoopPlanViewV1.skills?`; `SetTaskLoopPayloadV1.skills?` |
| `web/src/LoopPlanCard.tsx` | `payloadOf(draft, plan.skills)` carries the task's current skills unchanged (key omitted when none) |
| `web/src/BudgetEditor.tsx` | `suggestedLoopActions` payload carries `plan.skills` unchanged (see decision D3) |
| `tests/control/setTaskLoopSkills.test.ts` (new) | C13 / C15 + refusals (9 tests) |
| `web/tests/loopPlanSkillsPayload.test.tsx` (new) | C14 (4 tests) |

### Existing tests touched (each unavoidable)

- `tests/control/setTaskLoop.test.ts`, `setTaskLoopConfirmed.test.ts`, `setTaskLoopLabels.test.ts`, `setTaskLoopModel.test.ts`, `setTaskLoopVersion.test.ts`, `estimateEffectiveContracts.test.ts`, `loopPlanE2E.test.ts`: `await` added before every `.setTaskLoop(` call (49 call sites, mechanical perl rewrite) — setTaskLoop is now async (controller ruling).
- `tests/control/setTaskLoopConfirmed.test.ts` L173, L175: `replaceTaskInSnapshot(..., rows("a"))` → `..., rows("a"), null)` — new required parameter (brief's signature).
- `tests/control/requirementGuards.test.ts`: already `await`s its call — untouched.

## TDD

- RED (server, before implementation): 9/9 failed. Measured reason: `unrecognized_keys` (payload schema strict; 16 occurrences) and one `no-op-command`. Output: `scratchpad/red1.txt`.
- RED (web, before implementation): 3/4 failed (both card cases and the suggestion case); the "no skills key when none" case passes before and after by construction (it guards against M15). Output: `scratchpad/red-web.txt`.
- GREEN: `npx vitest run tests/control/setTaskLoopSkills.test.ts` 9/9; `web: npx vitest run tests/loopPlanSkillsPayload.test.tsx` 4/4.

## Verification (clone, all with the final code)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (root) | exit 0 |
| `web: npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `web: npm run build` | exit 0 |
| `npx vitest run tests/control/setTaskLoop tests/control/confirm tests/control/executionSnapshot tests/control/loopPlan tests/control/estimateEffectiveContracts.test.ts tests/control/requirementGuards.test.ts tests/panel/assemblyHandoffGrace.test.ts tests/panel/webParity.test.ts tests/panel/taskLoopApi.test.ts tests/panel/controlApi` | 24 files, 259 passed, 1 skipped (loopPlanE2E, env-gated) — exit 0 |
| same E2E with `ORCA_CCLOOP_BIN=/Users/biran/code/skills/loop/ccloop/dist/cli.js` (ccloop checkout af26a22, read-only) | 1/1 passed |
| `web: npm run check` | 62 files, 387 tests passed — exit 0 |
| `npx vitest run` (root, whole) | 262 files passed, 9 skipped (env-gated), 23 failed — all 23 `ccloop bin not found at scratchpad/ccloop/dist/cli.js (sibling-directory default)`, i.e. the clone's location, not the change |
| rerun `npx vitest run tests/scheduler tests/control/schedulerBridge.test.ts` with `ORCA_CCLOOP_BIN` set as above | 56 files, 203 tests passed — exit 0 |

`uptime` at the runs: load 2.99–29.05 (17:02–17:09). No flakes seen.

After the wide runs I added two `viewPlan` assertions (view exposes skills) to the new test; re-ran it 9/9 and root tsc 0; production code was unchanged since the wide runs.

## Mutations (each applied in the clone, run, restored from the main tree by `cat`; driver `scratchpad/mutate.py`, outputs `scratchpad/mut-M*.txt`)

| # | Mutation | Red |
|---|---|---|
| M1 | `skills` added to `kept` comparison (brief) | C13 v1 test (re-expanded at v2) |
| M2 | `skills` left out of the no-op test (brief) | 7 tests, incl. C13 skills-only change ⇒ no-op |
| M3 | `replaceTaskInSnapshot` ignores skills (brief) | both C15 snapshot tests |
| M4 | kept recipe keeps previous skills (no strip) | removal test + both C15 |
| M5 | shape check removed | skills-shape test (kept path) |
| M6 | lookup failure not thrown | draft and confirmed refusal tests |
| M7 | lookup failure thrown before existing checks | precedence test (task-loop-version-conflict) |
| M8 | names need no syncskill (unconfigured check dropped) | draft and confirmed unconfigured tests |
| M9 | profile frozen as `[profileName]` instead of members | C15 add/change/remove |
| M10 | entries not sorted by taskId | "keeps the other task's entry, sorted" |
| M11 | empty array kept instead of dropping the key | C15 golden hash comparison |
| M12 | view does not expose `skills` | profile test (`viewPlan(h).skills`) |
| M13 | card payload without skills (brief) | both C14 card cases |
| M14 | suggestion payload without skills | suggestion case |
| M15 | card sends `skills: undefined` key when none | "no skills key" case |

Restore proof (clone `git diff | wc -c` / `git diff --cached | wc -c`): before 53633 / 0, after 53633 / 0; every changed file `cmp`-identical to the main tree before commit.

## Decisions

- D1 (ruling): no `skills-unsupported-agent` anywhere; the brief's "codex task ⇒ skills-unsupported-agent" test was not written.
- D2: a bad skill name in the payload is refused as `loop-plan-invalid:skills-shape` (the same code `expandLoopPlan` already yields on the non-kept path), checked once up front so the kept path is covered too. Profile names are already checked by the payload schema's regex.
- D3: `BudgetEditor.suggestedLoopActions` also builds a set-task-loop payload (an estimate's suggestion applied in one click). Under the "absent removes" ruling it would have silently dropped a task's skills, so it now carries `plan.skills` too (same C14 reasoning; mutation M14).
- D4: on a confirmed task, a payload with a profile is re-resolved on every set-task-loop, including a budget-only edit with the profile unchanged — the frozen names then follow syncskill's current answer. This follows "the payload is the full desired state" and the ruling that the lookup always runs for a profile payload. See concern C1.
- D5: names (no profile) spawn nothing but still require ORCA_SYNCSKILL_BIN (ruling; same as confirm). Removing skills needs no syncskill.
- D6: setTaskLoop holds the admission gate across the await and replays a duplicate command before spawning, exactly as `confirm` does; the `mutate` wrapper is no longer used by it. The apply body was left at its old indentation to keep the diff surgical.
- D7: the defensive `skills-lookup-missing` branch confirm has was not copied: the lookup resolved this very profile from this very payload, so it is unreachable (an unreachable branch cannot be shown red). A non-null assertion is used instead.

## Concerns

- C1: D4 means a budget-only edit on a confirmed task with a profile can change its frozen skill names if the profile's membership changed since confirm, and refuses the edit if syncskill is unset or failing. The alternative (keep the frozen entry when the profile is unchanged) was rejected for simplicity; flag for the human if that is not the intended product behaviour.
- C2: the whole-suite run in the clone fails 23 scheduler files on the sibling-directory ccloop default; they pass with `ORCA_CCLOOP_BIN` pointed at the user's ccloop checkout (read-only use of a different repo).
- C3: 9 files skipped in the whole-suite run are env-gated (real ccloop / claude); not run.

---

## Fix round 1 (review `task-5-review.md`: I1, M2, M1)

- Who/when: Task 5 implementer subagent, same session, 2026-10-03. Base edf59e3. The fix commit is the one that follows edf59e3 on main (subject `fix(set-task-loop): keep an unchanged skill set frozen and never look up for a draft task`).

### Changes (`src/control/webService.ts`)

- `lookupPayloadSkills` was replaced by `profileToLookUp(store, groupId, taskId, payload.skills)` and `lookupProfile(profile, syncskill)`. The first is read synchronously before the first await. It returns a profile to look up only when (1) the proposal is not `editable` (the task is confirmed) and (2) the payload declares `{profile}` and (3) that profile differs from the profile in the current effective recipe. In every other case it returns null and nothing is spawned.
- `syncskill-unconfigured` now applies only when a lookup is needed. `profileMembers` already refuses `bin === null` with `syncskill-unconfigured`, so I removed my explicit check: mutation F11 showed it changed nothing (it survived the run). Names, draft tasks and unchanged declarations no longer need ORCA_SYNCSKILL_BIN.
- Transaction: `skillsUnchanged` (canonical bytes of the current recipe's skills vs the expanded recipe's) is computed once and used by both the no-op test and the confirmed branch.
  - On the confirmed branch, an unchanged declaration keeps the frozen snapshot entry exactly as it is (`frozen.skills` entry, or null). `readConfirmedTaskExecution` at the end still checks that it agrees.
  - A changed `{profile}` that has no lookup result throws `proposal-version-conflict`. This is the race where the proposal was read as a draft and confirmed before the transaction. I chose `proposal-version-conflict` because it is the existing code for "the proposal moved under this command".
- M1: the `applyWebCommand` body inside the new `try` is re-indented by 2. That is most of the line count; `git diff -w` shows only the logic change.
- `planChanged` was left as it is: skills are not part of the contract, and H12's "changed" is about the contract (review M3).

### Tests (`tests/control/setTaskLoopSkills.test.ts`, now 12)

Replaced or changed tests that pinned the old behaviour:
- "a profile is looked up and stored by name" became "a profile on a draft task is stored by name and not looked up". It now expects the fake log to be `[]`.
- "refuses syncskill-unconfigured for declared names, and a lookup failure by name, on a draft task" became "a draft task needs no syncskill and never asks it". It covers names with no syncskill deps, a profile with `bin: null`, and a profile with a failing fake. All are accepted and the log is empty.
- "decides a lookup failure after the existing checks" now runs on a confirmed task (a draft no longer looks up). Its second case is now a profile with syncskill unset instead of names.
- "a lookup failure on a confirmed task ...": its second assertion is now a profile with syncskill unset ⇒ `syncskill-unconfigured` (no deps and `bin: null`). It also adds "names need no lookup": a names change with no syncskill is accepted and frozen.

New tests (`describe "an unchanged declaration keeps its frozen entry (H3)"`):
- (a) Task a is confirmed with `{profile:"p"}`, frozen as `["alpha"]` by the fake's `waits-for-stdin` answer. A budget-only edit then sends `{profile:"p"}` with a fake that would answer `["alpha","beta"]`. The snapshot entry stays `["alpha"]`, `readConfirmedTaskExecution` agrees, and the fake log is `[]`.
- (b) The same budget-only edit with no syncskill deps and with `bin: null` is accepted both times, and the entry is unchanged.
- Race: a confirmed group whose proposal row is temporarily rewritten to `editable` around the synchronous part of the call, then restored before the transaction. A changed profile ⇒ `proposal-version-conflict`, no spawn, no `skills` key.

### Verification (t5 clone; HOME, the 4 XDG roots and TMPDIR redirected as before)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (root) | exit 0 |
| `web: npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx vitest run tests/control/setTaskLoop tests/control/confirm tests/control/executionSnapshot tests/control/loopPlan tests/control/estimateEffectiveContracts.test.ts tests/control/requirementGuards.test.ts tests/panel/taskLoopApi.test.ts tests/panel/controlApi tests/panel/webParity.test.ts` | 23 files, 258 passed, 1 skipped (loopPlanE2E, env-gated); exit 0 |
| `web: npx vitest run tests/loopPlanSkillsPayload.test.tsx tests/loopPlanCard.test.tsx tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx tests/loopSuggestionApply.test.tsx tests/loopSuggestionDraft.test.tsx tests/budgetSuggestions.test.tsx tests/loopBudgetRows.test.tsx` | 8 files, 44 passed; exit 0 |

`uptime` load 6.04–11.49 at 17:18–17:19. No flakes.

### Mutations (driver `scratchpad/mutate2.py`, outputs `scratchpad/mutf-F*.txt`)

| # | Mutation | Red |
|---|---|---|
| F1 | always re-resolve (pre-read always returns the profile, and the transaction ignores `skillsUnchanged`) | H3 (a) and (b) |
| F2 | spawn for a draft (`editable` check removed) | both draft tests (fake log non-empty) and the race test |
| F3 | race check removed | race test |
| F4 | `skills` in `kept` | C13 v1 test |
| F5 | `skills` out of the no-op test | 8 tests |
| F6 | kept recipe keeps the previous skills | removal test and both C15 tests |
| F7 | shape check removed | skills-shape test |
| F8 | lookup failure not thrown | confirmed lookup-failure test |
| F9 | lookup failure thrown before existing checks | precedence test |
| F10 | profile frozen as `[name]` | C15 add/change/remove |
| F11 | explicit `bin === null` check dropped | **survived** (`profileMembers` already refuses it), so the check was removed from the code (see Changes) |

The web mutations M13–M15 are unaffected: no web code changed in this round.

Restore proof (clone `git diff | wc -c` / `git diff --cached | wc -c`): 70737 / 0 before the F-series and 70737 / 0 after. Then the F11 removal was copied in and the runs above were made. Before commit, both changed files were `cmp`-identical to the main tree.
