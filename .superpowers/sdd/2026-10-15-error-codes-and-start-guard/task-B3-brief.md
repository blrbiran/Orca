### Task B3: Loop-plan edits while the group runs (spec B §3.3; criteria 7, 8; correction K6)

**Files:**
- Modify: `src/control/webService.ts:26` (import `readStopIntent`), `:956-959` (the group-state check in `setTaskLoop`)
- Modify: `web/src/LoopPlanCard.tsx:181-183`
- Modify (named rewrites): `tests/control/setTaskLoop.test.ts:24-31`; `web/tests/loopPlanEdit.test.tsx:148-157`; `web/tests/budgetI18n.test.tsx:150`
- Test (create): `tests/control/setTaskLoopRunning.test.ts`

**Interfaces:**
- Consumes: `readStopIntent(store, groupId): StopIntentV1 | null` (`src/control/stopIntent.ts:216`).
- Produces: `editable = ["draft", "ready", "running", "review"].includes(group.status) && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause")`, else `group-state-invalid`; web: `open = ["draft", "ready", "running", "review"].includes(view.summary.state) && (view.summary.stopMode === null || view.summary.stopMode === "pause")`. `task-already-started` (lines 964-966) unchanged.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/control/setTaskLoopRunning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart, readWorkClaimEnvelope } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, loop, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.3, criteria 7 and 8 (human ruling 2): a task's loop plan stays editable while its group
// runs; an edit reaches only tasks not yet started. The states are built by production code, never a flipped status --
// a flipped column passes checks that a real running group would not.
type T = Awaited<ReturnType<typeof driverHarness>>;
const THREE = [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c", loop: loop("c") }];
const pendingStart = (t: T) => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind IN ('start','no-start') AND delivered=0").get() !== undefined;
async function claimSecond(t: T, driver: ReturnType<T["driver"]>): Promise<string> {
  await t.until(driver, () => pendingStart(t));
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
  return claimed.runId;
}

describe("set-task-loop while the group runs (spec B §3.3)", () => {
  it("C7: in a review group, after a checkpoint and with another task running, an unstarted task's plan changes and nothing else does", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "stoppable" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "accepted");
      const before = { a: workBody(t.h, "a").derivedContractHash, b: workBody(t.h, "b").derivedContractHash, c: workBody(t.h, "c").derivedContractHash };
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c", loopVersion: 1 } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "c").contract.objective.goal).toBe("write c, changed");
      expect([workBody(t.h, "a").derivedContractHash, workBody(t.h, "b").derivedContractHash]).toEqual([before.a, before.b]);
      expect(workBody(t.h, "c").derivedContractHash).not.toBe(before.c);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("C7: a paused group takes a change to an unstarted task", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "a" } });
    } finally { await h.dispose(); }
  });

  it("C7: a handoff-stopped group does not", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await h.dispose(); }
  });

  it("C8: a task whose run finished keeps its contract -- its change is refused, another's is accepted, and its retry runs the contract frozen at its claim", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "failed" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "blocked");
      const frozen = workBody(t.h, "b").derivedContractHash;
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "b" }))).toMatchObject({ result: { kind: "task-retried", taskId: "b" } });
      expect(workBody(t.h, "b").status).toBe("ready");
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c" } });
      const retried = await claimSecond(t, driver);
      expect([t.body(retried).taskId, readWorkClaimEnvelope(t.h.store, "g", retried).derivedContractHash]).toEqual(["b", frozen]);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
```
(`claimSecond` after the retry: the driver may already have armed a start wake for `c` before `b`'s retry; `nextClaimableTask` orders by id (`webDispatch.ts:351`), so `b` is claimed first either way.)

(b) Named rewrite, `tests/control/setTaskLoop.test.ts:24-31` — old: `it.each(["running", "review", "done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => { …writeGroup(h, (body) => { body.status = status; }); …group-state-invalid… expectUntouched(h, 1); … });` → new (body of the refusal unchanged):

```ts
  // Rewritten for the start guard spec (2026-10-15; its §5 names this criterion; human ruling 2): this now encodes that done
  // and blocked refuse as group-state-invalid while running and review take a change to an unstarted task (the real
  // running/review/paused states are built in setTaskLoopRunning.test.ts).
  it.each(["done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.status = status; });
      expect(errorOf(await new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it.each(["running", "review"])("accepts a change to an unstarted task of a confirmed group whose status is %s", async (status) => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      writeGroup(h, (body) => { body.status = status; });
      expect(await service.setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 } });
    } finally { await h.dispose(); }
  });
```
`:33` ("refuses a stopped group…", a stopped flag with no intent) is **not** rewritten (K6).

(c) Named rewrite, `web/tests/loopPlanEdit.test.tsx:148-157` — old title "offers no change while the group is past ready or stopped, where the server always refuses (group-state-invalid)" iterating `[at({ state: "running" }), at({ state: "review" }), at({ stopMode: "pause", stopState: "paused" })]` → new:

```tsx
  // Rewritten for the start guard spec (2026-10-15; its §5 names this criterion): this now encodes the server's predicate --
  // a running, reviewing or paused group offers the change for an unstarted task; done, blocked and a handoff or shutdown
  // stop show the plan frozen.
  it("offers a change while the group runs or is paused, and none where the server refuses (group-state-invalid)", () => {
    const at = (summary: Partial<GroupViewV1["summary"]>): GroupViewV1 => { const base = view([item()]); return { ...base, summary: { ...base.summary, ...summary } }; };
    for (const shown of [at({ state: "done" }), at({ state: "blocked" }), at({ stopMode: "handoff", stopState: "handoff-complete" }), at({ stopMode: "shutdown", stopState: "handoff-pending" })]) {
      render(<Stateful view={shown} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
      expect(screen.getByText("The group is not open for changes; the plan is frozen")).toBeTruthy();
      cleanup();
    }
    for (const shown of [at({ state: "draft" }), at({ state: "running" }), at({ state: "review" }), at({ stopMode: "pause", stopState: "paused" })]) {
      render(<Stateful view={shown} onCommand={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
      cleanup();
    }
  });
```
(re-read lines 148-157 first; if the old `at` helper differs, keep the old helper line verbatim.)

(d) Named rewrite, `web/tests/budgetI18n.test.tsx:150` — old `    expect(card({ view: { ...view, summary: { ...view.summary, state: "running" } } }).container.textContent).toContain("组当前不接受修改，做法已冻结");` → new:

```tsx
    // Rewritten for the start guard spec (2026-10-15; §5): a running group now takes the change, so the frozen text is shown for a done one.
    expect(card({ view: { ...view, summary: { ...view.summary, state: "done" } } }).container.textContent).toContain("组当前不接受修改，做法已冻结");
```

- [ ] **Step 2: Run red** — root `tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop.test.ts`, web `tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx` to `b3-red*.log`. Expected red: C7 review (`group-state-invalid`), "C7: a paused group…", "accepts a change … running/review", the web rewrite (no button for running). Green at RED: "C7: a handoff-stopped group does not", C8 (both pin unchanged refusals), "refuses … done/blocked", the budgetI18n rewrite.

- [ ] **Step 3: Implement**
  - `webService.ts` line 26: add `readStopIntent` to the `./stopIntent.js` import. Replace lines 956-959 (the two "Step 1" comment lines, `assertKnownConservation(...)` and the `if (... || group.stopped) throw …`) with:
    ```ts
              // Step 1. assertKnownConservation first (recovery-blocked before any state refusal, ruling P3). Start guard spec
              // (2026-10-15) §3.3: a running, reviewing or paused group takes a change to a task that has not started; a handoff
              // or shutdown stop, a stopped flag with no intent, done and blocked do not.
              assertKnownConservation(this.store, group, proposal);
              const stopIntent = readStopIntent(this.store, id);
              const editable = ["draft", "ready", "running", "review"].includes(group.status)
                && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause");
              if (!editable) throw new ControlError("group-state-invalid");
    ```
  - `LoopPlanCard.tsx` lines 181-183 (the two comment lines and `const open = …`):
    ```tsx
      // Start guard spec (2026-10-15) §3.3: the server's predicate -- a running, reviewing or paused group takes a change to an
      // unstarted task; done, blocked and a handoff or shutdown stop refuse it (group-state-invalid).
      const open = ["draft", "ready", "running", "review"].includes(view.summary.state) && (view.summary.stopMode === null || view.summary.stopMode === "pause");
    ```

- [ ] **Step 4: Run green** — root `tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop*.test.ts tests/control/retryTask.test.ts`; web `tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx tests/loopPlanCard.test.tsx tests/loopPlanDraft.test.tsx`; root `tests/panel/scanPanelText.test.ts`; typecheck and web tsc. All logs read whole.

- [ ] **Step 5: Commit** — `src/control/webService.ts web/src/LoopPlanCard.tsx tests/control/setTaskLoop.test.ts tests/control/setTaskLoopRunning.test.ts web/tests/loopPlanEdit.test.tsx web/tests/budgetI18n.test.tsx`; message `feat(control): let unstarted tasks' loop plans change while the group runs or is paused`.

- [ ] **Step 6 (reviewer, clone `b3`): mutations** (file `src/control/webService.ts`, test `tests/control/setTaskLoopRunning.test.ts` unless named)
  - `B3a` drop the pause clause: `{"from": " || stopIntent?.mode === \"pause\");", "to": ");"}` — red: "C7: a paused group takes…".
  - `B3b` ignore the stop intent: `{"from": "\n            && ((!group.stopped && stopIntent === null) || stopIntent?.mode === \"pause\");", "to": ";"}` — red: "C7: a handoff-stopped group does not"; second run `B3b2` on `tests/control/setTaskLoop.test.ts` — red: "refuses a stopped group…" (`:33`).
  - `B3c` status back to draft/ready: `{"from": "[\"draft\", \"ready\", \"running\", \"review\"].includes(group.status)", "to": "[\"draft\", \"ready\"].includes(group.status)"}` — red: C7 review; `B3c2` on `tests/control/setTaskLoop.test.ts` — red: the running/review rows.
  - `B3d` drop the per-task runs-row check (criterion 8): `{"from": "\n            || this.store.db.prepare(\"SELECT id FROM runs WHERE group_id=? AND work_item_id=?\").get(id, taskId)) throw new ControlError(\"task-already-started\");", "to": ") throw new ControlError(\"task-already-started\");"}` — red: C8 (the change of `b` accepted).
  - `B3e` web status: `web/src/LoopPlanCard.tsx` `{"from": "[\"draft\", \"ready\", \"running\", \"review\"].includes(view.summary.state)", "to": "[\"draft\", \"ready\"].includes(view.summary.state)"}`, dir `web`, test `tests/loopPlanEdit.test.tsx` — red: the rewritten test (running/review). `B3f` web pause: `{"from": "(view.summary.stopMode === null || view.summary.stopMode === \"pause\")", "to": "view.summary.stopMode === null"}` — red: the rewritten test (paused).

---

