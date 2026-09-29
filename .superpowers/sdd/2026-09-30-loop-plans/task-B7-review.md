# Task B7 review (base d49c7af, head 4117725)

### Spec Compliance
- ✅ Spec compliant. Both files match the brief; the two departures (P4 raise, `answer.txt` in targetPaths) are ruled/justified.
- Checks on the named risks:
  - Gating: `loopPlanE2E.test.ts:108` uses `beforeEach(ctx => { if (!realBinary) ctx.skip(); })`, no `describe.skipIf`. Matches ccloopDefaultE2E and the scopeTmpdir ERRATUM. Report shows skipped run leaves TMPDIR empty.
  - Rule 17: real user data is not touched; `relocateHome` is used, the report shows HOME/XDG and TMPDIR redirected and `~/.orca` stat identical before/after. No paid calls.
  - P4: `:126` raises `work.tokens + 500_000` inside the criterion. MB7-2 (full rebuild) was seen red on the byte-identity assertion only, with the run otherwise settling.
  - Fixture change: the new block is guarded by `task.loop !== undefined` and `continue`s; no existing caller sets `loop`, and `Task` gains only an optional field. Other E2E files cannot change behavior (typecheck rc=0 per report; full-suite run remains the controller's gate).
  - `answer.txt` ruling: applied, commented at `:100-103` with the reason.
- ⚠️ Not verifiable from the diff: the other ccloopWorld users (executionDriverE2E, handoffE2E, ccloopDefaultE2E) were not run with the fixture edit; the controller's gate should cover them.

### Strengths
- Mutations MB7-1/2/3 each name a red, with restore proven by `cmp`; MB7-3 covers the new fixture branch (P3).
- Assertions read post-run state (envelope goal, `show`, snapshot bytes) rather than the test's own input; the `before` snapshot is captured inside the beforeStart hook before the change, so the identity check can fail (MB7-2 showed it).
- Root-cause diagnosis of the allowlist miss was measured, not guessed.

### Issues
#### Critical
none
#### Important
none
#### Minor
- `loopPlanE2E.test.ts:103`: a and b now both carry `answer.txt` in their write sets. The report admits it did not check whether Orca's scheduler serializes on overlapping write sets; the test passes either way and measures neither order nor parallelism, so it is harmless here, but the file-level docblock does not mention it. Consider one line in the comment noting the overlap is deliberate and immaterial.
- `:120` `plan.inputs` spread plus `goal` override relies on `loopPlan.inputs` shape; acceptable as the change is asserted through the envelope goal.

### Assessment
**Task quality:** Approved

**Reasoning:** A small, additive fixture change and one criterion that is honestly gated, isolated from user data, and mutation-proven red on both the A2 self-check and the byte-identity assertion.
