# Task 7 report: panel shows the declared skill set and the run's lock

Commit: bacb9d7 `feat(panel): show a task's skill set and the skills a run was given` (local, not pushed). Observed on main after commit.

## TDD
- RED (server): `npx vitest run tests/panel/skillsView.test.ts` exit 1 ("expected undefined to deeply equal ['alpha']"), before any src change.
- RED (web): `npx vitest run tests/skillsPanel.test.tsx` in web, exit 1, 7 failing (output /private/tmp/.../scratchpad/t7/ and /tmp/t7wred.txt).
- GREEN: both files exit 0 (2 and 8 tests). One test-side fix on the way: the fake syncskill needs FAKE_SYNCSKILL_LOG in env, else A2 blocks (skills null).

## Mutation table (clone `git clone --local`, scratchpad/t7/clone, node_modules symlinked, HOME + 4 XDG + TMPDIR redirected)
All 12 seen red (exit 1) with their own test file; each restored; after the table `git diff` = 12876 bytes (same as before the first mutation), `git diff --cached` = 0 bytes.

| id | mutation | result |
|---|---|---|
| M1 | card: no-skills branch returns "" | red |
| M2 | card: names branch removed | red |
| M3 | card: frozen-names branch removed (never frozen) | red |
| M4 | card: profile name dropped from text | red |
| M5 | run table: "local" label for null commit removed | red |
| M6 | run table: filter for runs without skills removed | red |
| M7 | run table: empty section no longer hidden | red |
| M8 | ControlGroupView no longer renders SkillsGiven | red |
| M9 | zh `local` set to English | red |
| M10 | server: frozenSkillNames omitted | red |
| M11 | server: run `skills` omitted | red |
| M12 | server: run view includes drive `dir` (leak) | red |

## Verification (in clone, before commit)
- root `npm run typecheck` 0; `npm run build --workspace web` 0; `npm run check --workspace web` (tsc + vitest) 0 after fixing budgetI18n (below); `tests/panel` 44 files / 338 tests 0 (includes scanPanelText); scanPanelText alone 0; tests/control webProtocol*, loopPlanSkills, confirmSkills 49 tests 0.
- Whole root suite in the clone: 23 files / 43 tests failed, all under tests/scheduler and tests/control/schedulerBridge (`resolveCcloopBin` in tests/scheduler/sandbox.ts: the clone has no real ccloop binary). Not touched by this change; not re-run at baseline (concern below).

## Files
- src/panel/controlViews.ts: loopPlan `frozenSkillNames` (from the execution snapshot's `skills` entry for the task, omitted when none); run view `skills: {profile, lock}` (omitted when the drive record has none).
- src/control/webProtocol.ts: strict wire schemas for both new optional fields.
- web/src/controlTypes.ts: `RunSkillLockV1`, `RunViewV1.skills?`, `LoopPlanViewV1.frozenSkillNames?`.
- web/src/LoopPlanCard.tsx: `skillSetText` replaces the "not supported yet" line; payload code untouched.
- web/src/SkillsGiven.tsx (new), web/src/ControlGroupView.tsx (renders it after GitScheme).
- web/src/locales/en.ts, zh.ts: `loopPlan.skills` removed; `skillsNone/skillsProfile/skillsProfileFrozen/skillsNames`; `control.skills.*`.
- Tests: tests/panel/skillsView.test.ts (new), web/tests/skillsPanel.test.tsx (new).

## Existing tests modified (unavoidable: they asserted the old string)
- web/tests/loopPlanCard.test.tsx: two assertions "Skill set: not supported yet" -> "Skill set: none".
- web/tests/budgetI18n.test.tsx: one zh assertion "skill 集：暂不支持" -> "skill 集：无".

## Decisions
- `dir` is not exposed: the run view carries no local paths elsewhere (git shows modes/commits only); M12 pins it.
- Both new fields are omitted rather than null when absent, so views without skills keep their bytes (matches Task 5's `skills` on the loop plan view; differs from `git`, which is null; web treats absent as none).
- Frozen names live on the loop plan view (`frozenSkillNames`), not a separate task field; the card shows them only for a profile (for `{names}` the frozen names equal the declared ones).
- Run lock is a separate section/table (task, run, skill, resolved commit or "local", content md5), shown only when some run has a non-empty lock; source (name/url) not shown, since the brief lists name, commit, md5.
- Run view includes `profile` (null when names were declared) alongside `lock`; the table does not currently render it.

## Concerns
- Full root suite not proven green: the scheduler failures are a clone-environment effect (no ccloop binary), not compared against a baseline run.
- `skills.profile` on the run view is on the wire but unused by the UI.
