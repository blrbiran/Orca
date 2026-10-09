### Task D4: `retry-task`'s preconditions and refusals

**Files:**
- Modify: `src/control/errors.ts` (409 block, after `"task-loop-version-conflict": 409,`, line 85)
- Modify: `src/control/retryTask.ts` (the `apply` body, D3)
- Modify: `web/src/locales/en.ts` (`enErrors`, Part A), `web/src/locales/zh.ts` (`zhErrors`)
- Test: `tests/control/retryTask.test.ts`

**Interfaces:**
- Produces: durable code `task-not-retryable` (409) with details `no-run`, `run-state:<state>`, `blocked-at:<step|none>`,
  `outcome:<outcome|none>`, `handoff-request-open:<requestId>`, `usage-unknown`, `usage-pending`; existing codes
  `group-state-invalid` (detail `clarifying`), `stop-mode-conflict`, `group-reserve-insufficient` (detail
  `<dimension>:<shortfall>`) from `retry-task`.

- [ ] **Step 1: Write the failing test.** Add `import { writeHandoffRequest } from "../../src/control/stopIntent.js";`
  to the test's imports, and after `retry`:

```ts
/** A direct edit of one run body, for a state no fake produces on its own. */
const poke = (t: Harness, runId: string, change: (run: Record<string, any>) => void): void => t.h.store.transaction(() => {
  const run = t.body(runId);
  change(run);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
});
const refusal = (result: ReturnType<typeof retry>) => ("error" in result ? { code: result.error.code, message: result.error.message } : { code: "accepted", message: "" });
/** Nothing moved: the run is still blocked and active, and no task-retried row was written. */
const unchanged = (t: Harness, runId: string): void => {
  expect(t.body(runId).state).toBe("blocked");
  expect(active(t, runId)).toBe(1);
  expect(readRunActivity(t.h.store, runId, 50).some((entry) => entry.kind === "task-retried")).toBe(false);
};
```

  and a new describe:

```ts
describe("retry-task refusals (spec §4.2(2), §4.4)", () => {
  it("refuses a task with no run, and a task whose run is still healthy", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:no-run" });
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:run-state:accepted" });
      expect(active(t, runId)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("refuses a run blocked for any other reason: a succeeded run out of bounds, a transient failure, another step", async () => {
    const outOfBounds = await failingHarness([{ taskId: "a" }], () => ({ "elsewhere.txt": "x\n" })); try {
      outOfBounds.succeedNext();
      const { runId } = await failedRun(outOfBounds.t);
      expect(outOfBounds.t.body(runId).drive).toMatchObject({ blockedAt: "C", outcome: "succeeded" });
      expect(refusal(retry(outOfBounds.t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:succeeded" });
      unchanged(outOfBounds.t, runId);
    } finally { await outOfBounds.t.h.dispose(); }
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      // A collect that failed transiently blocks at C with no outcome (blockedStaysPut.test.ts).
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:none" });
      poke(t, runId, (run) => { run.drive.outcome = "failed"; run.drive.blockedAt = "E"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:blocked-at:E" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses while a handoff request is open, usage is unknown, or a usage event is pending (releaseRunReserve's conditions)", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "handoff-open", runId, state: "request-pending", deadlineAt: "2099-01-01T00:00:00.000Z", phaseAttemptOrdinal: 2, failureCode: null, evidenceIds: [] }, "g"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:handoff-request-open:handoff-open" });
      t.h.store.transaction(() => t.h.store.db.prepare("DELETE FROM handoff_requests WHERE id='handoff-open'").run());
      poke(t, runId, (run) => { run.unknown.work = true; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-unknown" });
      poke(t, runId, (run) => { run.unknown.work = false; });
      t.h.store.transaction(() => t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(runId, t.body(runId).highWater + 1, "0".repeat(64), "{}"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-pending" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses a stopped group with stop-mode-conflict and a clarifying group with group-state-invalid", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const paused = await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect("error" in paused ? paused.error : "paused").toBe("paused");
      expect(refusal(retry(t)).code).toBe("stop-mode-conflict");
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
    const clarifying = await failingHarness(); try {
      const { runId } = await failedRun(clarifying.t);
      clarifying.t.h.store.transaction(() => clarifying.t.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','clarifying') WHERE id='g'").run());
      expect(refusal(retry(clarifying.t))).toEqual({ code: "group-state-invalid", message: "group-state-invalid:clarifying" });
      unchanged(clarifying.t, runId);
    } finally { await clarifying.t.h.dispose(); }
  });

  it("refuses when the reserve cannot cover the new run, naming the dimension and the shortfall, and changes nothing", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const ledger = readWebGroup(t.h.store, "g").ledger;
      // No token left unallocated: the limit is what is used plus what is committed.
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...ledger.groupLimit, tokens: ledger.used.tokens + ledger.committedRemaining.tokens } }));
      expect("error" in lowered ? lowered.error : "lowered").toBe("lowered");
      const before = readWebGroup(t.h.store, "g").ledger;
      expect(before.explicitUnallocatedReserve.tokens).toBe(0);
      expect(netOf(t.body(runId)).tokens).toBe(10);
      expect(refusal(retry(t))).toEqual({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:10" });
      expect(readWebGroup(t.h.store, "g").ledger).toEqual(before);
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d4.txt 2>&1; echo rc=$?`
  → rc=1; every `it` of "retry-task refusals" fails (the command is accepted, or throws `run-not-found`/a TypeError for
  the task with no run).
- [ ] **Step 3: Implement.** `src/control/errors.ts`, in the 409 block, after `"task-loop-version-conflict": 409,` add

```ts
  // Issue fixes spec §4.2(2): retry-task on a task whose current run is not one ccloop ended failed (the detail names why).
  "task-not-retryable": 409,
```

  `src/control/retryTask.ts`: add to the imports `import { dimensions } from "./commands.js";`,
  `import { ControlError } from "./errors.js";`, `readBudgetProposal` to the `./queries.js` import, and `ADOPTABLE_STATES`,
  `latestRequestForRun`, `readGroupBody`, `readStopIntent` to the `./stopIntent.js` import. In `apply`, replace the four lines
  from `const work = readWork(store, groupId, taskId) as unknown as RetriedWork;` through `const drive = run.drive as DriveRecord;` with:

```ts
        // Spec §4.2(2), in the spec's order. Archived groups are refused by Part E (group-archived).
        const group = readGroupBody(store, groupId);
        if (group.status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
        const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
        if (typeof work.currentRunId !== "string") throw new ControlError("task-not-retryable", "no-run");
        const runId = work.currentRunId;
        const run = readRunBody(store, runId);
        const live = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        if (!live || run.state !== "blocked") throw new ControlError("task-not-retryable", `run-state:${run.state}`);
        const drive = run.drive as DriveRecord | undefined;
        if (drive === undefined || drive.blockedAt !== "C") throw new ControlError("task-not-retryable", `blocked-at:${drive?.blockedAt ?? "none"}`);
        // A codex-skills-* failure sets an outcome too (review C3), so it is retryable like any other ccloop failure.
        if (drive.outcome === null || drive.outcome === "succeeded") throw new ControlError("task-not-retryable", `outcome:${drive.outcome ?? "none"}`);
        // releaseRunReserve's conditions (budget.ts): no request still owns the run, and its usage is known and complete.
        const request = latestRequestForRun(store, groupId, runId);
        if (request !== null && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("task-not-retryable", `handoff-request-open:${request.requestId}`);
        if (run.unknown.work || run.unknown.handoff) throw new ControlError("task-not-retryable", "usage-unknown");
        if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, Number(run.highWater))) throw new ControlError("task-not-retryable", "usage-pending");
```

  and replace the line `const grant = both(work.grant), remaining = both(run.remaining);` with:

```ts
        // The new run is claimed at the task's current grant (after a continuation, the continuation's), so the net new
        // reservation is grant - remainder in each dimension; it must fit the group's unallocated reserve.
        const grant = both(work.grant), remaining = both(run.remaining);
        const reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve;
        for (const d of dimensions) {
          const shortfall = grant[d] - remaining[d] - reserve[d];
          if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
        }
```

  `web/src/locales/en.ts`, `enErrors` (keep its key order):

```ts
  "task-not-retryable": "This task cannot be retried now ({{detail}}). Retry task is for a task whose run ended in a ccloop failure; a run blocked for another reason has Retry run.",
```

  `web/src/locales/zh.ts`, `zhErrors` (after `"task-already-started": …,`):

```ts
  "task-not-retryable": "这个任务现在不能重试（{{detail}}）。「重试任务」只用于运行以 ccloop 失败结束的任务；因别的原因阻塞的运行请用「重试运行」。",
```

  The existing `group-reserve-insufficient` entries (both locales) already point at the budget editor through Part A's
  text; if Part A's en entry does not name the budget editor, change it to
  `"The group's unallocated reserve is short by {{detail}} (dimension:amount). Raise the group limit in the budget editor, then try again."`
  and the zh one to `"组的未分配余量不够（{{detail}}，维度:差额）。请在预算编辑里调高组上限后再试。"` (spec §4.2(2) "the explanation points at the budget editor").
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. `npm run typecheck` rc=0.
  `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/d4b.txt 2>&1; echo rc=$?` rc=0 (the new catalog
  code has text in both locales).
- [ ] **Step 5: Mutation.** One guard at a time; the named `it` must go red at the named expectation:
  `no-run` guard → "refuses a task with no run…" (first `toEqual`); `run-state` guard → same `it`, second `toEqual`;
  `outcome` guard → "refuses a run blocked for any other reason…" (`outcome:succeeded`); `blocked-at` guard → same `it`
  (`blocked-at:E`); handoff guard → "refuses while a handoff request is open…" (first `toEqual`); `usage-unknown` guard →
  same `it`, second; `usage-pending` guard → same `it`, third; stop guard → "refuses a stopped group…"
  (`stop-mode-conflict`); clarifying guard → same `it` (`group-state-invalid:clarifying`); the reserve loop → "refuses when
  the reserve cannot cover…". Delete the en or zh `task-not-retryable` entry → `refusalCoverage.test.ts` red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/errors.ts src/control/retryTask.ts web/src/locales/en.ts web/src/locales/zh.ts tests/control/retryTask.test.ts`;
  message `feat(control): refuse retry-task unless the task's current run ended in a ccloop failure the reserve can retry`.

---

