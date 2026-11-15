/**
 * The plan's semantic order, derived from its dependencies rather than from the canonical serialization order.
 *
 * `ControlPlanV1.tasks` is sorted by taskId so `planHash` does not depend on the source order (web-recoverable-control
 * spec §4.2). That order is a storage detail; consumers that ask "which task comes first" or "what runs together" mean
 * the dependency order (#296). This module derives it without changing the stored plan or its hash: layers by longest
 * dependency path, each layer sorted by taskId with a code-unit comparison (the control plane's compareText rule).
 */
export interface OrderedPlanTask { taskId: string; dependencyTaskIds: readonly string[] }

const byId = (left: OrderedPlanTask, right: OrderedPlanTask): number => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);

/** Dependency layers: layer 0 has no dependencies; a task sits one past its deepest dependency. Cycles are appended last. */
export function planLayers<T extends OrderedPlanTask>(tasks: readonly T[]): T[][] {
  const byTask = new Map(tasks.map((task) => [task.taskId, task]));
  const depth = new Map<string, number>();
  const resolving = new Set<string>();
  const depthOf = (task: T): number => {
    const known = depth.get(task.taskId);
    if (known !== undefined) return known;
    if (resolving.has(task.taskId)) return 0; // a cycle is a draft problem; order what can be ordered
    resolving.add(task.taskId);
    let value = 0;
    for (const dependency of task.dependencyTaskIds) {
      const target = byTask.get(dependency);
      if (target !== undefined) value = Math.max(value, depthOf(target) + 1);
    }
    resolving.delete(task.taskId);
    depth.set(task.taskId, value);
    return value;
  };
  const layers: T[][] = [];
  for (const task of tasks) {
    const at = depthOf(task);
    (layers[at] ??= []).push(task);
  }
  return layers.map((layer) => [...layer].sort(byId)).filter((layer) => layer.length > 0);
}

/** Every task in dependency order: each layer sorted by taskId. Never places a task before a dependency it declares. */
export function planOrderTasks<T extends OrderedPlanTask>(tasks: readonly T[]): T[] {
  return planLayers(tasks).flat();
}
