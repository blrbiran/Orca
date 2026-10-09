### Task D7: The driver cleans a settled-failed run; run 2 is claimed and lands (end-to-end, synthetic ccloop)

**Files:**
- Modify: `src/control/executionDriver.ts` (`stepE` end, ~line 727; `driverRunIds` lines 805–816; `advance` lines
  845–854; `pass`'s catch, lines 891–902)
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Consumes: `archiveRun`, `cleanupRunWorkspace`, `savedReport`, `workspaceOf`, `groupRepoId` (all in or imported by
  executionDriver.ts); `taskRunNumber` (D6).
- Produces: `export async function stepCleanupFailed(deps: ExecutionDriverDeps, runId: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test.** Add to the test's imports:

```ts
import { existsSync } from "node:fs";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { taskRunNumber } from "../../web/src/runFacts.js";
```

  and change `import { driverHarness } from "./fixtures/driverHarness.js";` to `import { driverHarness, git } from "./fixtures/driverHarness.js";`.
  After `unchanged` add:

```ts
/** The driver's next round arms a start wake for the ready task (replenishStartWakes); delivering it claims a run. */
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
const archived = (t: Harness, runId: string): number =>
  Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").get(runId)!.n);
```

  and append:

```ts
describe("after retry-task: cleanup, a new run, success (spec §4.2(2), §4.4)", () => {
  it("archives and removes the failed run's workspace, claims run 2 from the group branch through normal dispatch, and lands it", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId, driver } = await failedRun(t);
      const failedDrive = t.body(runId).drive;
      expect(existsSync(failedDrive.workspacePath)).toBe(true);
      expect("error" in retry(t)).toBe(false);
      const head = git(t.repo, "rev-parse", "refs/heads/orca/g");
      succeedNext();
      const second = await claimAgain(t, driver);
      // That same round visited the settled-failed run: archived, its workspace gone, its source directory kept.
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(failedDrive.workspacePath)).toBe(false);
      expect(existsSync(failedDrive.sourceDir)).toBe(true);
      expect(archived(t, runId)).toBeGreaterThan(0);
      expect(second).not.toBe(runId);
      expect(work(t, "a")).toMatchObject({ status: "running", currentRunId: second, lineageRunIds: [runId, second].sort() });
      expect(taskRunNumber(view(t), "a")).toBe(2);
      await t.until(driver, () => t.body(second).state === "settled" && t.body(second).drive?.cleanedUp === true);
      expect(t.body(second).drive.base).toBe(head);
      expect(t.body(second).drive.workspacePath).not.toBe(failedDrive.workspacePath);
      expect(work(t, "a")).toMatchObject({ status: "done", currentRunId: second });
      expect(git(t.repo, "show", "refs/heads/orca/g:a")).toBe("a");
      expect(new Map(view(t).runs.map((run) => [run.runId, run.state]))).toEqual(new Map([[runId, "settled-failed"], [second, "settled-recoverable"]]));
    } finally { await t.h.dispose(); }
  });

  it("records a cleanup failure on the failed run, keeps it settled-failed, and still runs the new one", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId, driver } = await failedRun(t);
      expect("error" in retry(t)).toBe(false);
      let repositoryGone = true;
      t.deps.resolveRepository = () => { if (repositoryGone) throw new Error("repository-unavailable"); return t.repo; };
      await driver.round();
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false, cleanupError: "repository-unavailable" } });
      repositoryGone = false;
      succeedNext();
      const second = await claimAgain(t, driver);
      await t.until(driver, () => t.body(second).state === "settled" && t.body(second).drive?.cleanedUp === true && t.body(runId).drive.cleanedUp === true);
      expect(t.body(runId).drive.cleanupError).toBeNull();
      expect(work(t, "a").status).toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("retries twice: a short reserve on the second retry is refused by dimension and shortfall, and run 3 lands (review focus 2)", async () => {
    const { t, succeedNext } = await failingHarness(); try {
      const { runId: first, driver } = await failedRun(t);
      expect("error" in retry(t)).toBe(false);
      const second = await claimAgain(t, driver);
      await t.until(driver, () => t.body(second).state === "blocked");
      expect(t.body(second).drive).toMatchObject({ blockedAt: "C", outcome: "failed", stopReason: FAILED_REASON });
      expect(taskRunNumber(view(t), "a")).toBe(2);
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const ledger = readWebGroup(t.h.store, "g").ledger;
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: ledger.used.tokens + ledger.committedRemaining.tokens } }));
      expect("error" in lowered ? lowered.error : "lowered").toBe("lowered");
      expect(netOf(t.body(second)).tokens).toBe(10);
      expect(refusal(retry(t))).toEqual({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:10" });
      const restored = t.service.setLimit(t.h.command("set-limit", { limit }));
      expect("error" in restored ? restored.error : "restored").toBe("restored");
      expect("error" in retry(t)).toBe(false);
      succeedNext();
      const third = await claimAgain(t, driver);
      expect(taskRunNumber(view(t), "a")).toBe(3);
      await t.until(driver, () => t.body(third).state === "settled" && [first, second, third].every((id) => t.body(id).drive?.cleanedUp === true));
      expect(new Map(view(t).runs.map((run) => [run.runId, run.state]))).toEqual(new Map([[first, "settled-failed"], [second, "settled-failed"], [third, "settled-recoverable"]]));
      expect(work(t, "a")).toMatchObject({ status: "done", currentRunId: third });
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d7.txt 2>&1; echo rc=$?`
  → rc=1: the first and third new `it`s fail at `cleanedUp: true` / the final `until` (the driver never visits a
  `settled-failed` run, so its workspace stays); the second fails at `cleanupError` (`null`).
- [ ] **Step 3: Implement.** `src/control/executionDriver.ts`, after the closing brace of `stepE`:

```ts
/**
 * Issue fixes spec §4.2(2): a run retry-task settled as failed keeps its evidence and loses its workspace. Its saved
 * terminal report is the stop proof (stepC wrote it before blocking). Like stepE's cleanup it never blocks: a failure is
 * recorded in `cleanupError` by the round and retried next round, and the task's new run has its own workspace.
 */
export async function stepCleanupFailed(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "settled-failed" || run.drive === undefined || run.drive.cleanedUp) return false;
  const drive = run.drive;
  const report = await savedReport(store, runId);
  await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: report.candidate?.stopProof ?? null }, archiveAdmission(deps));
  await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, run.groupId)), deps.roots, runId, workspaceOf(drive));
  write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "settled-failed" || current.drive === undefined) return;
    current.drive = { ...current.drive, cleanedUp: true, cleanupError: null };
    saveDriverRun(store, current);
  });
  return true;
}
```

  `driverRunIds`: replace
  `if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))) ids.push(runId);`
  with

```ts
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))
      // Issue fixes spec §4.2(2): a settled-failed run until its evidence is archived and its workspace removed.
      || (run.state === "settled-failed" && run.drive !== undefined && !run.drive.cleanedUp)) ids.push(runId);
```

  `advance`, work chain: after `case "landed": case "settled": return stepE(deps, runId);` add
  `case "settled-failed": return stepCleanupFailed(deps, runId);`.

  `pass`'s catch: replace

```ts
          if (run.state === "settled") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if (current.state === "settled" && current.drive !== undefined && !current.drive.cleanedUp) {
```

  with

```ts
          // Issue fixes spec §4.2(2): a settled-failed run's cleanup failure is recorded the same way.
          if (run.state === "settled" || run.state === "settled-failed") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if ((current.state === "settled" || current.state === "settled-failed") && current.drive !== undefined && !current.drive.cleanedUp) {
```

  and update the comment directly above that block's first line from "A settled run stays settled" to
  "A settled (or settled-failed) run stays where it is".
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. Then
  `./node_modules/.bin/vitest run tests/control/executionDriver.test.ts tests/control/driverSettle.test.ts tests/control/driverHandoff.test.ts tests/control/blockedStaysPut.test.ts > $S/d7b.txt 2>&1; echo rc=$?` rc=0;
  `npm run typecheck` rc=0.
- [ ] **Step 5: Mutation.** (a) Remove the `settled-failed` clause from `driverRunIds` → first `it` red at
  `cleanedUp: true`. (b) Remove the `case "settled-failed":` from `advance` → same. (c) Put the catch back to
  `run.state === "settled"` only → second `it` red (the run is blocked at E instead: `state` ≠ `settled-failed`).
  (d) Delete the `archiveRun(…)` call → first `it` red at `archived(t, runId)`. (e) Delete the final `write(…)` → first
  `it` red at `cleanedUp: true`.
- [ ] **Step 6: Commit.** `git -C $W add src/control/executionDriver.ts tests/control/retryTask.test.ts`;
  message `feat(control): archive and clean a settled-failed run's workspace in the driver loop`.

---

