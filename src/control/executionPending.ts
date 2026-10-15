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
