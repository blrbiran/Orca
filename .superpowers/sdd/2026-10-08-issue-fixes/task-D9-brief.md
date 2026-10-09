### Task D9: End-to-end against real ccloop and fake codex

**Files:**
- Modify: `tests/control/executionDriverE2E.test.ts` (imports lines 1–7; a new `it` after "T1", before the `R1` `it.each`, ~line 143)

**Interfaces:**
- Consumes: `ccloopWorlds`'s `world`/`startGroup`/`raw`/`until`/`workRuns` (fixtures/ccloopWorld.ts); fake codex's
  `script` mode, which reads the script file on every call and exits 3 at `execute` for a task with no entry (ccloop
  `tests/fixtures/fake-codex.mjs`); `taskRunNumber` (D6). Gated like the rest of the file on `ORCA_CCLOOP_BIN`.

- [ ] **Step 1: Write the failing test.** Imports: add `import { writeFile } from "node:fs/promises";` after the `node:fs`
  import and `import { taskRunNumber } from "../../web/src/runFacts.js";` after the `controlViews.js` import. After the
  "T1" `it`:

```ts
  // Issue fixes spec §4.4 (issue 16): a run ccloop ended failed keeps ccloop's reason; retry-task settles it, the group
  // view reads at once, and the pump and driver run the task again from the group branch. The script has no entry for
  // task a at first, so fake codex exits 3 at execute and ccloop ends the run with its own reason; the script is then
  // given the entry (fake codex reads it on every call).
  it("R-F: retry-task after a ccloop failure settles the run as settled-failed, and run 2 lands", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"] }], {});
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId, 1_000_000);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the first run to fail");
      const first = workRuns(runtime)[0]!;
      expect(first.body.drive.blockedAt).toBe("C");
      expect(first.body.drive.outcome).not.toBe("succeeded");
      expect(typeof first.body.drive.stopReason).toBe("string");
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs[0]).toMatchObject({ state: "blocked", stopReason: first.body.drive.stopReason, outcome: first.body.drive.outcome });
      await writeFile(join(w.root, "codex-script.json"), JSON.stringify({ a: { files: { "a.txt": "A\n" } } }));
      const retried = runtime.service.retryTask(raw(runtime, "retry", "retry-task", { taskId: "a" }));
      expect("error" in retried ? retried.error : retried.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: first.runId });
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-failed"]);
      await until(() => workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 240_000, "run 2 to land and both runs to be cleaned");
      const second = workRuns(runtime).find((run) => run.runId !== first.runId)!;
      expect(new Map(workRuns(runtime).map((run) => [run.runId, run.body.state]))).toEqual(new Map([[first.runId, "settled-failed"], [second.runId, "settled"]]));
      expect(taskRunNumber(readControlGroup(runtime.store, runtime.epoch, "g"), "a")).toBe(2);
      expect(w.show("a.txt")).toBe("A");
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
```

- [ ] **Step 2: Run it, expect FAIL.** This criterion needs D1–D8 to compile and run at all, so its red is shown by the
  Step 5 mutations rather than before the implementation. The run command (the real binary is what the gate uses; `$BIN`
  = the absolute path of the gate's clone build of the pinned ccloop `bin`):
  `cd $W && ORCA_CCLOOP_BIN=$BIN ./node_modules/.bin/vitest run tests/control/executionDriverE2E.test.ts -t "R-F" > $S/d9.txt 2>&1; echo rc=$?`.
- [ ] **Step 3: Implement.** No production change: D1–D8 implement it. The world's HOME/XDG relocation (`relocateHome`)
  already covers this `it` (Rule 17).
- [ ] **Step 4: Run, expect PASS.** The Step 2 command on `$W` → rc=0 (with `ORCA_CCLOOP_BIN` unset the describe is
  skipped and rc=0 proves nothing — the gate (Part F) runs it with the binary set; record which).
- [ ] **Step 5: Mutation.** In a clone: remove the D2 `...stopReason` patch in `stepC` → red at
  `typeof first.body.drive.stopReason`; remove the D7 `driverRunIds` clause → red at the second `until` (timeout).
- [ ] **Step 6: Commit.** `git -C $W add tests/control/executionDriverE2E.test.ts`;
  message `test(control): retry a task after a real ccloop failure and land its second run`.

---

