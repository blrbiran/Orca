# Task 5 review — set-task-loop carries `skills`; the panel keeps them

- Who: Task 5 reviewer subagent, session https://claude.ai/code/session_011R9aYJnHfJXDpdJ3YM1YW9
- When: 2026-10-03
- Range: 7ab2fa2..edf59e3 (review package `review-7ab2fa2..edf59e3.diff`, read in one pass; no tests re-run)

### Spec Compliance

- ❌ Issues found:
  - H3 ("a profile is resolved ... at confirm time and frozen; later profile edits do not reach a confirmed task") is
    not held for the common case of a budget-only edit on a confirmed profile task. `src/control/webService.ts:672`
    looks up the payload's profile on every call, and `:774-776` replaces the frozen names with syncskill's current
    answer even when the payload's profile equals the one already frozen. The panel (`web/src/LoopPlanCard.tsx:120,167`,
    `web/src/BudgetEditor.tsx:168`) now always echoes `{ profile }`, so any budget edit, including a one-click estimate
    suggestion, re-reads the profile into the frozen snapshot. The implementer flags this themselves (report D4/C1).
    See Important I1.
- Everything else verified against the diff:
  - `kept` compares `planId` + `inputs` only (`webService.ts:706-707`); `keptExpansion` strips the old `skills` and adds the
    payload's, omitting the key when absent (`:794-797`). C13 test shows a v1 recipe stays at `planVersion: 1` with
    identical contract bytes.
  - No-op test includes skills, compared as canonical bytes of normalised sets (`:721-722`); C13 repeat ⇒ `no-op-command`.
  - setTaskLoop is async, holds the admission gate across the await, replays before spawning, as `confirm` does
    (`:667-672`, cf. `:509-516`); the only production caller is awaited (`src/panel/controlApi.ts:355`; checked with
    `git grep "setTaskLoop(" edf59e3 -- src web/src`).
  - `replaceTaskInSnapshot` adds/replaces/removes the entry, keeps it sorted, drops the key when empty
    (`src/control/executionSnapshot.ts:297-301`); C15 test proves removal restores the golden snapshot hash.
  - Controller rulings: no `skills-unsupported-agent` anywhere (report D1, brief's codex test correctly omitted);
    ORCA_SYNCSKILL_BIN unset + declared skills ⇒ `syncskill-unconfigured` (`webService.ts:131`); absent `skills` removes
    them (test "a payload without skills removes them").
  - Lookup failure decided after every existing check (`:736`, after `numeric-overflow`); precedence test present.
  - C14: card and suggestion payloads carry `plan.skills` unchanged, key omitted when none; view exposes `skills`
    (`src/panel/controlViews.ts`, `webProtocol.ts` `loopPlanViewSchema`).
  - Existing tests touched are listed with reasons in the report (await at 49 sites; two `replaceTaskInSnapshot(..., null)`
    call sites in `setTaskLoopConfirmed.test.ts`); the diff matches that list.
- ⚠️ Cannot verify from diff:
  - Spec §10.5 still says set-task-loop "refuses `skills-unsupported-agent`" on a confirmed task; the controller ruling
    overrides it. Per Rule 13 the published spec should carry a correction section recording this; controller should
    check that one exists (it is not in this diff).
  - Mutation evidence (M1–M15) lives in `scratchpad/mut-M*.txt` in the implementer's clone; I did not re-run it.

### Strengths

- The `kept`/no-op split is exactly the spec's: skills excluded from `kept`, included in the no-op test, and the C13 test
  pins both halves with a hand-built v1 recipe (`tests/control/setTaskLoopSkills.test.ts`, `makeV1`).
- The golden-hash assertion after removing the last entry is a strong, byte-level check of "drop the key".
- Async conversion mirrors `confirm` faithfully (gate, replay preflight before spawn, failure thrown inside the
  transaction so it is ledgered and precedence is unchanged).
- D3 (BudgetEditor's suggestion path) is a genuine find: without it the "absent removes" ruling would silently drop a
  task's skills on a one-click estimate apply; covered by its own test and mutation.
- Mutation table covers every new branch, including precedence (M7) and sort order (M10).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- I1 — `src/control/webService.ts:672,774-776`: a set-task-loop on a confirmed task whose payload carries the
  **same** profile as the frozen entry re-resolves it and overwrites the frozen names. Because the panel echoes skills on
  every budget edit (C14), a later `syncskill profile` edit reaches a confirmed task through an unrelated budget change,
  contrary to H3; and if the profile was since deleted/emptied or syncskill is failing, the budget edit itself is
  refused (`syncskill-failed` / `skills-profile-empty`). Fix: on the confirmed branch, when the recipe's skills are
  `{ profile: P }` and the frozen snapshot entry for this task already has `profile: P`, keep the frozen `names`
  (from `frozen.skills`) and do not let a lookup failure refuse that case (the `syncskill-unconfigured` ruling can
  stay); re-resolve only when the profile changes or the task had no profile entry. Add a test (fake answering
  differently on the second call, budget-only edit ⇒ frozen names unchanged) and its mutation. If the controller
  prefers D4's semantics, it needs a human ruling since it contradicts H3's text.

#### Minor (Nice to Have)

- M1 — `src/control/webService.ts:673-789`: the `applyWebCommand` body was left at its old indentation inside the new
  `try` (report D6), so the block's nesting is visually wrong; `confirm` re-indented its body. Cosmetic.
- M2 — `src/control/webService.ts:129-134`: on a draft task a profile is spawned for and the result discarded; a
  transient syncskill failure refuses a draft budget edit whose profile will be resolved again at confirm anyway.
  Consistent with the controller ruling, but worth a sentence in the spec's correction section.
- M3 — a skills-only change never sets `planChanged` (test asserts `planChanged` undefined), so the card's "changed"
  marker does not reflect a skill-set change. Spec is silent; deliberate per test, flag for product judgment only.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The mechanics (kept/no-op split, async gate, snapshot rewrite, panel echo) are correct and well tested
with mutations, but a budget-only edit on a confirmed profile task re-freezes the profile's current members, which
breaks H3 and is made routine by the panel's C14 echo.
