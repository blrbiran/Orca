# Task 4 review — freeze skills into the execution snapshot at confirm

Reviewer: task-reviewer subagent of session `08b1007d` (Claude Opus 5.5), 2026-10-03. Range `60a0eb0..114b20d`, diff file
`review-60a0eb0..114b20d.diff`. Read-only; no tests run (no doubt arose that the reported runs and mutation table do not answer).

### Spec Compliance

- ✅ Spec compliant (§10.5 / §10.8 C3, C4, C16 and the brief), with stated, acceptable deviations:
  - Lookup before the transaction, next to `resolveGroupSelections`: `src/control/webService.ts:299`; one `profile ls`
    per distinct profile, sorted, sequential: `webService.ts:258-271`; test `confirmSkills.test.ts:520-534`.
  - Failure thrown inside `apply` after the slot failure, `agent-selection-changed` and `handoff-grant-insufficient`
    checks: `webService.ts:323`; precedence test `confirmSkills.test.ts:577-583`.
  - Agent check `agent.agent !== "claude"`: `webService.ts:327` (fixture `FIXTURE_OTHER_AGENT_ID = "claude"`,
    `tests/control/fixtures/agents.ts:15`, checked).
  - Schema: optional, min(1), names min(1), sorted unique by taskId, ⊆ derivedContracts: `src/control/webProtocol.ts:155-164`.
  - Omitted when empty, so the golden hash holds: `src/control/executionSnapshot.ts:97`; golden pinned at `60a0eb0`
    (`tests/control/executionSnapshot.test.ts:707-715`).
  - `readConfirmedTaskExecution` existence / names / profile checks, returning `skills | null`:
    `executionSnapshot.ts:120-127`; `task` there is the effective recipe (`effectivePlanTask`, checked at `114b20d`
    `executionSnapshot.ts` ~L326).
  - C4 refusals, each with `expectUnconfirmed`: `confirmSkills.test.ts:547-575`. C16 tamper cases (names, profile on a
    names entry, profile renamed, entry deleted, entry added): `confirmSkills.test.ts:604-651`.
  - `ORCA_SYNCSKILL_BIN` plumbing into the web service: `src/skills/syncskill.ts:416-419`, `src/panel/controlAssembly.ts:386`,
    end-to-end test `confirmSkills.test.ts:653-670`.
  - Deviation: `deps.syncskill` is optional (`webService.ts:231`), whereas the brief made it required. It fails closed
    (`UNCONFIGURED_SYNCSKILL`, `webService.ts:255,299`) and production assembly always passes it. Acceptable.
  - Existing tests: only the import line of `executionSnapshot.test.ts:4` was changed. `web/src/locales/zh.ts` is not
    listed in the brief, but `refusalCoverage` requires it. Justified.
- ⚠️ Cannot verify from the diff:
  - The 21 mutations (M1–M17) and the RED/GREEN runs are in the scratchpad (`t4/mutations.tsv`, `t4/red.out`,
    `t4/green.out`), outside this diff. The controller should spot-check that `t4/mutations.tsv` lists exit 1 for each one.
  - Whether `profileMembers` (Task 2) does the normalisation and the name-rule validation is outside this diff. M2 and
    C3 (`["beta","alpha","beta"]` ⇒ `["alpha","beta"]`) cover the normalisation through confirm.
  - Spec §4.2 bullet 1 says "a task has skills and ORCA_SYNCSKILL_BIN not set → syncskill-unconfigured". §10.5 replaces
    §4.2, and the brief limits it to profile lookups, so a `names`-only task confirms with syncskill unset and is blocked
    later at A2 (`skills-inject-failed:syncskill-unconfigured`, §10.6). This is consistent with §10.5. The controller
    should confirm that this late failure is intended.

### Strengths

- Refusal placement mirrors the slot-failure pattern exactly (`{ failure }` carried into `apply`), and a precedence test
  plus mutation M13 pin it.
- The golden hash is captured at the base SHA in a clone, at the `prepareExecutionSnapshot` level where it is
  deterministic. The `skills: []` → omitted path is also tested (M12).
- The C16 tests rewrite the snapshot coherently (new canonical record, proposal and group repointed,
  `confirmSkills.test.ts:590-601`), so only the skills comparison can be what turns them red. Each one also asserts that
  the untouched tasks still read, which acts as the control.
- The schema test has a positive control before its negative cases (`executionSnapshot.test.ts:734-736`). That avoids
  the shape "a check that can never be red" (Rule 9).
- `syncskillRefusal` maps codes through a `satisfies readonly KnownControlErrorCode[]` list, so a code that is not
  registered cannot be cast to a ControlError (`webService.ts:256,272-277`).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. `webService.ts:323` — the skills refusals now come before the checks inside `prepareExecutionSnapshot`
   (identity conflicts, budget and others). The spec says "after every existing check". The brief mandates this
   position, the implementer disclosed it (decision 5), and the identity checks cannot be reached from confirm. Still,
   if two refusals apply at once, which one is named can change. Fixing it would mean validating everything else before
   building with skills. Accept or note in the spec.
2. `webService.ts:299` — the lookup runs before the transaction even when the proposal is already confirmed (then
   refused `no-op-command`) or stale. Each such click spawns a `syncskill` process for nothing. It is harmless but
   wasteful. A cheap pre-check (`readBudgetProposal(...).state === "confirmed"` ⇒ skip) would avoid it.
3. `webService.ts:265` — a bare `catch { return { members: new Map() } }` swallows every error while reading the recipes
   before the transaction. It relies on the transaction failing first with the real code. That holds today (it reads the
   same records), but if it ever stops holding, the result is a misleading `recovery-blocked: skills-lookup-missing`.
   The comment says so. Acceptable but fragile.
4. `errors.ts:42-47` — `syncskill-timeout` (and `syncskill-missing`) are durable 422 outcomes frozen per commandId. The
   implementer flagged it. A transient failure such as a timeout is arguably not durable. The fresh commandId per click
   limits the damage. This is a controller decision.
5. `tests/control/executionSnapshot.test.ts:723-728` — `toThrow()` with no code. "an entry with no names" would pass on
   any throw. Assert the zod issue path or message, as the next test does.
6. `webService.ts:327` — `skills-unsupported-agent` keys on the installation id `"claude"`, not on the agent kind. An
   installation with kind claude and a different id is refused. That is the safe direction, it is disclosed, and Task 7
   checks by kind. The two layers disagree on the predicate, so align them later.
7. `confirmSkills.test.ts:461` — `resolve("tests/skills/fixtures/fake-syncskill.mjs")` depends on the cwd. It works
   under the repo's vitest root, but `fileURLToPath(new URL(..., import.meta.url))` would be robust.

### Assessment

**Task quality:** Approved

**Reasoning:** Every brief and §10.5 requirement is implemented, placed as the slot-failure precedent dictates, and
backed by tests with controls and a reported mutation for each branch. What remains is precedence and robustness polish
that does not affect correctness on any path the API can reach.
