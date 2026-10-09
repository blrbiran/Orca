### Task D10: ERRATUM to the execution driver spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-execution-driver-design.md` (append at the end of the file, after line 238;
  the original text is not touched — Rule 13)

- [ ] **Step 1: Write the failing check.** `grep -c "ERRATUM (issue fixes, 2026-10-08" $W/docs/superpowers/specs/2026-09-25-execution-driver-design.md > $S/d10.txt; echo rc=$?` → prints `0`, rc=1.
- [ ] **Step 2: Run it, expect FAIL.** As Step 1.
- [ ] **Step 3: Implement.** Append exactly (one blank line before it):

```markdown

## ERRATUM (issue fixes, 2026-10-08, Orca session e34dc963)

§2.3's last line ("no new human commands; abandoning a run goes through the existing stop/recover path") is amended by
human ruling H2 of `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` (§4). A run blocked at C whose ccloop run
ended with an outcome other than `succeeded` is no longer sent back to C by `recovery-retry`, which now refuses it with
`run-terminal-failed` (409); a transiently blocked run is resumed as before. The new group command `retry-task`
(payload `{ taskId }`) settles such a run in the new run state `settled-failed` (inactive; its booked usage kept, its
remainder released and the task's grant re-reserved), returns its task to `ready` with `currentRunId` still on that run,
and normal dispatch starts a new run from the group branch's current head. The driver archives a `settled-failed` run's
evidence and removes its workspace as it does a settled run's (§3.5), recording a failure in `cleanupError`. The drive
record also keeps ccloop's own `stopReason` (first 500 UTF-16 units). The text above this section is unchanged.
```

- [ ] **Step 4: Run, expect PASS.** The Step 1 command prints `1`, rc=0; `git -C $W diff --stat > $S/d10b.txt` shows only
  additions to this file.
- [ ] **Step 5: Mutation.** None (documentation; the check in Step 1 is its criterion).
- [ ] **Step 6: Commit.** `git -C $W add docs/superpowers/specs/2026-09-25-execution-driver-design.md`;
  message `docs(spec): erratum — retry-task and settled-failed amend the execution driver's no-new-command rule`.

---

### Part D exit check

`cd $W && npm run typecheck > $S/dx1.txt 2>&1; echo rc=$?` rc=0; web typecheck rc=0;
`./node_modules/.bin/vitest run tests/control tests/panel tests/entry > $S/dx2.txt 2>&1; echo rc=$?` rc=0 (read whole; only
registered load flakes allowed, each named); `cd $W/web && ../node_modules/.bin/vitest run > $S/dx3.txt 2>&1; echo rc=$?`
rc=0. The full gate is Part F's.
