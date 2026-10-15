### Task B1: One predicate, shared by the view and the guard (spec B §3.1)

**Files:**
- Create: `src/control/executionPending.ts`
- Modify: `src/panel/controlViews.ts:362-379` (`BUSY_WORK` and `executionPending`), `:455`; import
- Test (create): `tests/control/executionPending.test.ts`

**Interfaces:**
- Produces (`src/control/executionPending.ts`):
  - `export const BUSY_WORK: ReadonlySet<string>`; `export const EXECUTION_WAKE_KINDS: ReadonlySet<string>`
  - `export interface ExecutionFacts { readonly undeliveredWakeKinds: readonly string[]; readonly activeRunPhases: readonly unknown[]; readonly taskStatuses: readonly unknown[] }`
  - `export function executionPendingFrom(facts: ExecutionFacts): boolean`
  - `export interface ExecutionSnapshot { readonly runsByRowid: ReadonlyArray<{ readonly id: string; readonly active: number }>; decodeRun(id: string): StoredJson | undefined; decodeWork(id: string): StoredJson | undefined }` (`StoredJson = { ok: true; value: unknown } | { ok: false; error: SyntaxError }`, structurally the panel's `GroupReadSnapshot`)
  - `export function groupExecutionPending(store: ControlStore, groupId: string, taskIds: readonly string[], snapshot: ExecutionSnapshot): boolean`
  - `export function groupExecutionPendingInStore(store: ControlStore, groupId: string): boolean`
- `controlViews.ts` re-exports `BUSY_WORK` (so `controlOverview.ts:8` is unchanged; the Overview gate is not changed — see Interpretations).

- [ ] **Step 1: Write the failing test** — create `tests/control/executionPending.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { executionPendingFrom, groupExecutionPendingInStore } from "../../src/control/executionPending.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.1: one predicate decides "this group's execution is pending or running" for the group
// view (which hides Start) and for start's guard (which refuses it) -- two copies drifted once already. An estimate,
// clarify or split single call shares the runs table and is not execution: it has its own guards.
async function confirmed() {
  const h = await webFixture(profileSnapshot());
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

describe("the execution-pending predicate (spec B §3.1)", () => {
  it("counts only dispatch wakes, work runs and busy work statuses", () => {
    expect(executionPendingFrom({ undeliveredWakeKinds: ["continuation", "budget-estimate", "requirement-call", "requirement-export"],
      activeRunPhases: ["single-call", "handoff", undefined], taskStatuses: ["draft", "ready", "done", "blocked", "completed", undefined] })).toBe(false);
    const one = (facts: Partial<Parameters<typeof executionPendingFrom>[0]>) => executionPendingFrom({ undeliveredWakeKinds: [], activeRunPhases: [], taskStatuses: [], ...facts });
    expect([one({ undeliveredWakeKinds: ["start"] }), one({ undeliveredWakeKinds: ["no-start"] }), one({ undeliveredWakeKinds: ["resume"] }), one({ activeRunPhases: ["work"] }),
      ...["running", "active", "starting", "start-unknown", "held", "continuing"].map((status) => one({ taskStatuses: [status] }))])
      .toEqual([true, true, true, true, true, true, true, true, true, true]);
  });

  it("an active estimate run alone is not pending, in the view and in the store", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n).toBe(1);
      expect([readControlGroup(h.store, "epoch-test", "g").summary.executionPending, groupExecutionPendingInStore(h.store, "g")]).toEqual([false, false]);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run red** — to `b1-red.log`. Expected: load error (module missing) at RED; after Step 3 the mutations below red on assertions.

- [ ] **Step 3: Implement** — create `src/control/executionPending.ts`:

```ts
import type { ControlStore } from "./store.js";

/**
 * Start guard spec (2026-10-15) §3.1 (feedback #53): a Web start only queues a wake and its claim only marks the work item,
 * so the stored group status stays `ready` through the first run. One predicate says the group's execution is pending or
 * running; the group view reads it over its snapshot (Start is hidden), `start` reads it from the store (it is refused).
 * Defined only for a group with an archived plan; callers check requirement-not-split first.
 */
/** Work statuses that mean a task's execution is under way (the overview's start gate reads the same set). */
export const BUSY_WORK: ReadonlySet<string> = new Set(["running", "active", "starting", "start-unknown", "held", "continuing"]);
/** The wakes that dispatch a group's work. `continuation` is not one: nothing writes it (continuations arm `resume`). */
export const EXECUTION_WAKE_KINDS: ReadonlySet<string> = new Set(["start", "no-start", "resume"]);

export interface ExecutionFacts {
  readonly undeliveredWakeKinds: readonly string[];
  /** The `phase` of each active run: estimate, clarify and split single calls share the table and do not count. */
  readonly activeRunPhases: readonly unknown[];
  readonly taskStatuses: readonly unknown[];
}
export function executionPendingFrom(facts: ExecutionFacts): boolean {
  return facts.undeliveredWakeKinds.some((kind) => EXECUTION_WAKE_KINDS.has(kind))
    || facts.activeRunPhases.some((phase) => phase === "work")
    || facts.taskStatuses.some((status) => BUSY_WORK.has(String(status)));
}

type StoredJson = { ok: true; value: unknown } | { ok: false; error: SyntaxError };
export interface ExecutionSnapshot {
  readonly runsByRowid: ReadonlyArray<{ readonly id: string; readonly active: number }>;
  decodeRun(id: string): StoredJson | undefined;
  decodeWork(id: string): StoredJson | undefined;
}
const field = (result: StoredJson | undefined, name: string): unknown =>
  result?.ok === true && typeof result.value === "object" && result.value !== null ? (result.value as Record<string, unknown>)[name] : undefined;
const decode = (body: unknown): StoredJson => { try { return { ok: true, value: JSON.parse(String(body)) }; } catch (error) { return { ok: false, error: error as SyntaxError }; } };
function undeliveredWakeKinds(store: ControlStore, groupId: string): string[] {
  return store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id=? AND delivered=0").all(groupId).map((row) => String(row.kind));
}

/** The group view's entry: the facts its read snapshot holds; a row whose body does not decode is skipped. */
export function groupExecutionPending(store: ControlStore, groupId: string, taskIds: readonly string[], snapshot: ExecutionSnapshot): boolean {
  return executionPendingFrom({
    undeliveredWakeKinds: undeliveredWakeKinds(store, groupId),
    activeRunPhases: snapshot.runsByRowid.filter((row) => row.active === 1).map((row) => field(snapshot.decodeRun(row.id), "phase")),
    taskStatuses: taskIds.map((taskId) => field(snapshot.decodeWork(taskId), "status")),
  });
}
/** `start`'s entry: the same facts read from the store, inside the caller's transaction (the group's task work items). */
export function groupExecutionPendingInStore(store: ControlStore, groupId: string): boolean {
  return executionPendingFrom({
    undeliveredWakeKinds: undeliveredWakeKinds(store, groupId),
    activeRunPhases: store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId).map((row) => field(decode(row.body), "phase")),
    taskStatuses: store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId).map((row) => decode(row.body))
      .filter((result) => field(result, "kind") === "task").map((result) => field(result, "status")),
  });
}
```
`controlViews.ts`: replace lines 362-379 (the `BUSY_WORK` doc and const, the #53 doc comment and the `executionPending` function) with `export { BUSY_WORK } from "../control/executionPending.js";`; add `import { groupExecutionPending } from "../control/executionPending.js";`; line 455 becomes `    ...(archived === null ? {} : { executionPending: groupExecutionPending(store, groupId, archived.plan.tasks.map((task) => task.taskId), readSnapshot!) }),`.

- [ ] **Step 4: Run green** — `tests/control/executionPending.test.ts tests/control/webDispatch.test.ts tests/panel/controlOverview.test.ts tests/panel/controlOverviewApi.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/controlPollPerformance.test.ts` to `b1-green.log` (`webDispatch.test.ts:277-327`'s five criteria keep their assertions; `:316`'s fixture claims a real **work** run — confirm in the log it is green); typecheck.

- [ ] **Step 5: Commit** — `src/control/executionPending.ts src/panel/controlViews.ts tests/control/executionPending.test.ts`; message `refactor(control): share the execution-pending predicate between the group view and start`.

- [ ] **Step 6 (reviewer, clone `b1`, web build first): mutations** — file `src/control/executionPending.ts`:
  - `B1a` count every active run: `{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}`, test `tests/control/executionPending.test.ts` — red: both tests.
  - `B1b` count `continuation` again: `{"from": "new Set([\"start\", \"no-start\", \"resume\"])", "to": "new Set([\"start\", \"no-start\", \"resume\", \"continuation\"])"}` — red: "counts only…" (first assertion).
  - `B1c` view ignores runs: `{"from": "    activeRunPhases: snapshot.runsByRowid.filter((row) => row.active === 1).map((row) => field(snapshot.decodeRun(row.id), \"phase\")),\n", "to": "    activeRunPhases: [],\n"}`, test `tests/control/webDispatch.test.ts -t "active run alone"` — red: "says execution is pending on an active run alone…".

---

