# Task 6 review — inject at A2, carry `skillPluginDir`, clean up by runId

Reviewer: task-reviewer subagent of session 08b1007d, 2026-10-03. Reviewed `5f2639c..01b74bc` from the review package
`review-5f2639c..01b74bc.diff` (read once, in full; no hunk was cut off). Read-only: no test was run, nothing in the
repository was changed other than writing this file.

### Spec Compliance

- ❌ Issues found:
  - C5 (spec §10.8 line 286) says "A2 with **real** syncskill (temp `SYNCSKILL_DIR`)". Only the fake was used
    (`tests/control/driverSkills.test.ts:564-587`). The implementer says so in the report's Concerns. A real syncskill
    is installed on this machine (`which syncskill` → `~/.nvm/versions/node/v22.13.1/bin/syncskill`), and the
    `ORCA_SYNCSKILL_REAL_BIN` gate already exists (`tests/skills/syncskillReal.test.ts`), so this was doable. See Important 1
    for how big the gap actually is.
- ⚠️ Cannot verify from the diff:
  - Spec §7 line 151 still gives the reason as `skills-inject-failed:E_SKILL_NOT_FOUND`. The code and the brief produce
    `skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND` (`executionDriver.ts:170`, test `driverSkills.test.ts:624`).
    §10 never replaced §7. The brief and the controller constraint (`<SyncskillError.code>`) agree with the code, so the
    code is right and the spec table is stale. The controller should add a correction section to the spec (Rule 13: do
    not edit it in place).
  - ccloop side: re-validation of `skillPluginDir` on worker relaunch is Task 1's job. Here I only checked that nothing
    between A2 and `cleanupRunWorkspace` removes the directory. `removeSkillsSnapshot` is called in two places only:
    `executionDriver.ts:203` (A2, before inject) and `workspace.ts:424` (cleanup). Check holds.

Everything else in the brief and the constraints is in the diff:
- `skillsPathOf`: `workspace.ts:364`.
- No reuse branch: `executionDriver.ts:203` always removes the leftover.
- Three dirs created with 0700: `:205`.
- `plugin.json` written exactly, 0600: `:212`.
- Snapshot made read-only: `:213`.
- `skills` recorded in the same final write as `envelopeHash`: `:190`.
- `newDrive skills: null`: `:144`.
- Blocks with `syncskill-unconfigured` when the bin is unset: `:207` plus `syncskill.ts:94`.
- Cleanup by runId with owner-write restored first: `workspace.ts:409-425`.
- Orca schema field: `schema.ts:269`.
- Conditional spread, so the no-skills envelope hash is unchanged: `startEnvelope.ts:322`, golden test `startEnvelope.test.ts:947-951`.
- Deps assembly: `controlAssembly.ts:443`. `syncskillOptionsFromEnv` was already imported at line 17.
- C9 smoke: `skillsE2E.test.ts`, including the `--plugin-dir` argv check at :897.
- The fake syncskill is wired with a temp HOME and no `SYNCSKILL_DIR`, so it cannot reach `~/.syncskill` (Rule 17).

### Strengths

- A2 cleanly gets a one-time snapshot through one helper, `injectRunSkills` (`executionDriver.ts:202-215`). The final
  write is still the only place `skills` gets recorded, which is what makes "no reuse branch" safe.
- `removeSkillsSnapshot` is the single removal path. It restores write permission top-down before `rm`
  (`workspace.ts:396-402`), and makes things read-only bottom-up (`:388-393`). Both orders are right.
- Lock-order check. Checked outside the diff (named risk: syncskill's lock order vs Orca's frozen order):
  - syncskill sorts with `normalizeSkillList` = `[...new Set()].sort()` and `buildLock` compares with `<`
    (`/Users/biran/code/skills/syncskill/src/inject.ts:23-33`).
  - Orca stores names with the same code-unit `.sort()` (`loopPlans.ts:149`, `syncskill.ts:74`).
  - So the in-order comparison at `executionDriver.ts:209` cannot falsely block a valid set, mixed case included.
- Using `realpath` for the recorded and sent directory is the right call, because ccloop accepts only canonical paths.
  Removal still goes through `skillsPathOf`, so the two never diverge in a way that matters.
- The tests check behaviour, not mocks:
  - A write into the snapshot is actually refused with EACCES (`driverSkills.test.ts:581`).
  - The restartRun case uses a run blocked before `skills` was recorded (`:659-672`).
  - The continuation case counts exactly two injects (`:700`).
  - The E2E test uses a real ccloop build and checks every claude argv.
- 12 named mutations, each seen red, and the restore was checked by byte count. Every brief-mandated mutation (Step 5)
  is there: M1–M6. Changes to existing tests are additive only, and the report lists all of them; they match the diff
  stat: `driverHarness.ts`, `ccloopWorld.ts`, `fake-syncskill.mjs`, `startEnvelope.test.ts`, `workspace.test.ts`.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **C5 was never run against a real syncskill.** `tests/control/driverSkills.test.ts:564-587`, compared with spec
   §10.8 C5.
   - What I checked: the real `injectSkills` in `/Users/biran/code/skills/syncskill/src/inject.ts:46-119`.
   - The real gap is narrower than "the lock shape":
     - **Lock shape.** The real lock file is `{schema:"syncskill-lock-v1", created_at, profile, skills}`; the fake writes
       `{profile:null, skills}`. The test compares only `.skills`, and the real result summary *is* `lock`. So the
       drive-record-equals-lock-file claim holds by construction, and Task 2's real test already shows the inject result
       equals the lock file.
     - **What is genuinely unproven:**
       - real inject into a `<dir>/skills` that already exists, is empty, and has mode 0700;
       - `makeReadOnly` on a real copied tree (modes come from the source, through `cp`);
       - the staging dir `.syncskill-inject-*` is gone before `chmod -R a-w`. It is: `rm(staging)` happens before
         `return`, but no test shows it;
       - real `content_md5` and `source` values passing `lockSkillSchema` on the driver path.
   - The behavioural risk is low. It is still a spec criterion that was not met, and it is cheap to fix.
   - Fix: add one A2 case gated on `ORCA_SYNCSKILL_REAL_BIN` (with `ctx.skip()`, the same way as `syncskillReal.test.ts`).
     Use a temp `SYNCSKILL_DIR` and HOME, and check the real `~/.syncskill` before and after (C12). Assert the layout,
     the modes, that the snapshot is read-only, and `drive.skills.lock` equal to the lock file's `skills[]`. If it stays
     skipped in the gate, say so in the progress ledger.

2. **Some new branches have no mutation seen red.** The controller constraint and Rule 9 require one for each new branch.
   - Branches with no test at all, where deleting the branch stays green:
     - the symbolic-link skip in `makeReadOnly` (`workspace.ts:390`), which keeps chmod from following a link out of
       the snapshot;
     - the same skip in `restoreOwnerWrite` (`workspace.ts:399`);
     - the non-`SyncskillError` arm of the block reason (`executionDriver.ts:170`, `describeError(error)`). M5 swallows
       the whole catch block, but no test drives a mkdir or chmod failure.
   - The `ENOENT` return in `restoreOwnerWrite` (`workspace.ts:398`) is covered by `workspace.test.ts:1023-1029` and by
     the no-skills driver path, but it is not among M1–M12.
   - Fix one of two ways:
     - add a test with a symlink planted in a leftover or in the fake's injected tree (assert its target's mode is
       unchanged), plus a test with a mkdir failure (for example a non-directory squatting `skills-<runId>`/skills
       after the remove, using a crash seam), and name the mutations;
     - or, if the symlink branches are judged unreachable because real inject copies with `dereference: true`, say that
       explicitly in the ledger instead of leaving untested code.

#### Minor (Nice to Have)

1. `executionDriver.ts:205` and `:212` rely on the `mode` argument to `mkdir` and `writeFile`, and the umask can still
   remove bits from it. Rule 17 says "not from umask". This matches the codebase's own `privateDirectory`
   (`paths.ts:14`), and a normal umask cannot widen 0700/0600, so it is consistent. An explicit `chmod` after creation
   would fully meet the rule's wording.
2. `driverSkills.test.ts:522-528` (`restoreWrite`) duplicates `restoreOwnerWrite` from `workspace.ts:396-402`. The test
   helper exists because the production one is not exported. Fine as is; exporting it would remove the copy.
3. The `workspace.test.ts:1002-1021` test cleans its "other" snapshot by hand (`:1020`). As the report notes, a failure
   before that line leaves read-only residue in TMPDIR that the `afterEach` `rm` cannot remove. Wrapping it in
   try/finally, or restoring write permission in `afterEach`, would close this.
4. `removeOwnPath` on the skills dir runs `git worktree list` (`registeredWorktree`) for a path that is never a
   worktree: two extra git spawns per run (A2 and cleanup). This is negligible, but the per-task process increment is
   something the parallelism goal (memory `orca-goal-massive-parallelism`) asks to be counted.
5. The spec §7 line 151 reason string is stale (see ⚠️ above). Fix it with a spec correction section, not a code change.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The implementation is correct and minimal, and it matches §10.6 point by point. The block, cleanup and
envelope-hash invariants are well tested against real behaviour, and I found no defect in the code paths. Two things
are open: C5's required real-syncskill run is missing (low risk, but a stated criterion), and a few new defensive
branches have no mutation seen red.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011R9aYJnHfJXDpdJ3YM1YW9
