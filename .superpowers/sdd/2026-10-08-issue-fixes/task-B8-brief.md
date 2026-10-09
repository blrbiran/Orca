### Task B8: `run-resumed` on a run-scope recovery-retry

**Files:**
- Modify `src/control/stopIntent.ts` `retryRun` (anchor `const resumedDriverRun = resumeBlockedDriverRun(store, runId);`,
  line 473); the B4 import becomes `import { noteRunWrite, recordActivity } from "./activity.js";`.
- Test: extend `tests/control/activityRuns.test.ts`.

**Interfaces:** Consumes `recordActivity`. Row `run-resumed`, body `{}`.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("run-resumed (issue-fixes spec §5.2)", () => {
  it("a run-scope recovery-retry of a blocked run writes run-resumed and its run-targeted command row; its replay writes none", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted", storeNow: () => clock }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      clock = 8_000;
      const command = t.h.runCommand("recovery-retry", runId, { scope: "run", runId });
      const retried = await t.service.recoveryRetry(command);
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId).state).toBe("accepted");
      const newest = () => readRunActivity(t.h.store, runId, 2).map((entry) => [entry.kind, entry.at, entry.runId, entry.body]);
      expect(newest()).toEqual([
        ["command", 8_000, runId, { verb: "recovery-retry", actor: "human" }],
        ["run-resumed", 8_000, runId, {}],
      ]);
      const count = readRunActivity(t.h.store, runId, 1_000).length;
      await t.service.recoveryRetry(command);
      expect(readRunActivity(t.h.store, runId, 1_000)).toHaveLength(count);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts > $SCRATCH/B8.txt 2>&1; echo rc=$?`.
  Expected: newest two rows are `["command", …]` and `["run-blocked", …]`.

- [ ] **Step 3: Implement** — in `retryRun`:

```ts
  const resumedDriverRun = resumeBlockedDriverRun(store, runId);
  // Issue-fixes spec §5.2: a blocked run resumed by recovery-retry (here, in the command's transaction).
  if (resumedDriverRun) recordActivity(store, { groupId, taskId: run.taskId, runId, kind: "run-resumed", body: {} });
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activityRuns.test.ts tests/control/blockedStaysPut.test.ts tests/control/driverRecovery.test.ts tests/control/driveRecord.test.ts > $SCRATCH/B8.txt 2>&1; echo rc=$?` (rc=0); `npm run typecheck`.

- [ ] **Step 5: Mutation** — delete the `if (resumedDriverRun) recordActivity(...)` line → red: "a run-scope
  recovery-retry of a blocked run writes run-resumed…". The `if (resumedDriverRun)` guard itself (no row when nothing
  was resumed) is not pinned by a criterion here; record it in the ledger as unpinned rather than claim it is covered.

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/stopIntent.ts tests/control/activityRuns.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record run-resumed when recovery-retry resumes a blocked run

Issue-fixes spec §5.2: written in retryRun, inside the recovery-retry command's transaction.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

