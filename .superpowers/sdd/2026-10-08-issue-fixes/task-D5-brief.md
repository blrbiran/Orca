### Task D5: `recovery-retry` refuses a terminally failed run (`run-terminal-failed`)

**Files:**
- Modify: `src/control/driveRecord.ts` (after `RESUME_STATE`, line 82)
- Modify: `src/control/stopIntent.ts` (`retryRun`, lines 466–484; import of `./driveRecord.js`, line 13)
- Modify: `src/control/errors.ts` (409 block, after `"run-owner-conflict": 409,`)
- Modify: `web/src/locales/en.ts` (`enErrors`), `web/src/locales/zh.ts` (`zhErrors`)
- Modify: `skills/orca-control/SKILL.md` (the `Notes:` paragraph under the route table); `tests/entry/skill.test.ts`
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Produces: `export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord }): boolean` (driveRecord.ts);
  durable code `run-terminal-failed` (409).

- [ ] **Step 1: Write the failing test.** Append to `tests/control/retryTask.test.ts`:

```ts
describe("recovery-retry on a terminally failed run (spec §4.2(3))", () => {
  it("refuses it with run-terminal-failed and leaves it blocked at C; a transiently blocked run still resumes", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const refused = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in refused ? refused.error.code : "resumed").toBe("run-terminal-failed");
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "C", outcome: "failed", blockedReason: "terminal:failed" } });
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      const resumed = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in resumed ? resumed.error : resumed.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId)).toMatchObject({ state: "accepted", drive: { blockedAt: null, blockedReason: null } });
    } finally { await t.h.dispose(); }
  });
});
```

  `tests/entry/skill.test.ts`, in "teaches the rules, the exit codes and the error codes", add to the phrase list (after the
  Task 7 entries): `// Issue fixes spec §4.2(2)-(3): which retry a failed run takes.` then `"run-terminal-failed", "task-not-retryable",`.
- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts tests/entry/skill.test.ts > $S/d5.txt 2>&1; echo rc=$?`
  → rc=1: the new `it` fails (`resumed` ≠ `run-terminal-failed`: today the run goes back to `accepted`); the skill phrases are missing.
- [ ] **Step 3: Implement.** `src/control/driveRecord.ts`, after `RESUME_STATE`:

```ts
/**
 * Issue fixes spec §4.2(3): a run the driver blocked at C because its ccloop run ended with an outcome other than
 * `succeeded`. Sending it back to C would only collect the same terminal again, so recovery-retry refuses it; retry-task
 * (retryTask.ts, which names each failed condition in its refusal) is its way out.
 */
export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord }): boolean {
  return run.state === "blocked" && run.drive !== undefined && run.drive.blockedAt === "C" && run.drive.outcome !== null && run.drive.outcome !== "succeeded";
}
```

  `src/control/stopIntent.ts`: the import `import { resumeBlockedDriverRun } from "./driveRecord.js";` becomes
  `import { isTerminallyFailedRun, resumeBlockedDriverRun, type DriveRecord } from "./driveRecord.js";`. In `retryRun`, as
  its first statement (before `const blockers = clearedBlockers(store, groupId, runId);`):

```ts
  // Issue fixes spec §4.2(3): checked before anything is cleared, so the refusal leaves the run and its blockers as they were.
  const target = readRunBody(store, runId);
  if (target.groupId === groupId && isTerminallyFailedRun(target as { state: string; drive?: DriveRecord })) throw new ControlError("run-terminal-failed");
```

  `src/control/errors.ts`, after `"run-owner-conflict": 409,`:

```ts
  // Issue fixes spec §4.2(3): recovery-retry on a run ccloop ended failed; only retry-task moves it.
  "run-terminal-failed": 409,
```

  `enErrors`: `"run-terminal-failed": "This run ended in a ccloop failure; retrying the run would only read the same result again. Use Retry task to start a new run of the task.",`
  `zhErrors` (after `"run-not-found": …,`): `"run-terminal-failed": "这个运行已经以 ccloop 失败结束，重试运行只会再读到同样的结果。请用「重试任务」为这个任务开一次新的运行。",`

  `skills/orca-control/SKILL.md`: at the end of the `Notes:` paragraph under the route table append:
  `` `retry-task` starts again a task whose current run ccloop ended failed (in `get groups/<groupId>`, the run is `blocked` with `outcome` set and not `succeeded`): the run becomes `settled-failed` and a new run starts from the group branch's current head; any other task is refused with `task-not-retryable` (409). `recovery-retry` refuses such a run with `run-terminal-failed` (409) and still resumes a run blocked for any other reason. ``
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0; `npm run typecheck` rc=0;
  `./node_modules/.bin/vitest run tests/control/driverRecovery.test.ts tests/control/blockedStaysPut.test.ts tests/control/stopIntent.test.ts tests/panel/refusalCoverage.test.ts > $S/d5b.txt 2>&1; echo rc=$?` rc=0.
- [ ] **Step 5: Mutation.** (a) Delete the `if (… isTerminallyFailedRun …) throw` line → the new `it` red at
  `toBe("run-terminal-failed")`. (b) In `isTerminallyFailedRun` drop `&& run.drive.outcome !== null` → the same `it` red at
  the second half (the transient run is refused instead of resuming). (c) Delete the en or zh entry →
  `refusalCoverage.test.ts` red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/driveRecord.ts src/control/stopIntent.ts src/control/errors.ts web/src/locales/en.ts web/src/locales/zh.ts skills/orca-control/SKILL.md tests/entry/skill.test.ts tests/control/retryTask.test.ts`;
  message `fix(control): refuse recovery-retry on a run ccloop ended failed with run-terminal-failed`.

---

