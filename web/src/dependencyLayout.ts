/**
 * Board spec 2026-10-03 D1: where each task of a group sits in the drawn dependency graph. Pure code (Rule 5): a task's
 * layer is the length of the longest dependency path to it, and inside a layer tasks are ordered by id. A dependency on
 * a task the view does not carry is not drawn but counted, and an edge that would close a cycle (the server refuses
 * one; the page must still not hang) is dropped and counted, so the graph never hides either silently.
 */
export interface LayoutNode { taskId: string; layer: number; index: number }
export interface DependencyLayout {
  nodes: LayoutNode[];
  /** `from` must finish before `to` starts. */
  edges: Array<{ from: string; to: string }>;
  layers: number;
  missing: number;
  cycleEdges: number;
}

export function layoutDependencies(items: ReadonlyArray<{ taskId: string; dependencyTaskIds: readonly string[] }>): DependencyLayout {
  const known = new Map(items.map((item) => [item.taskId, item]));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const edges: DependencyLayout["edges"] = [];
  let missing = 0;
  let cycleEdges = 0;
  for (const item of items) {
    for (const dependency of item.dependencyTaskIds) {
      if (!known.has(dependency)) missing += 1;
    }
  }
  const visit = (taskId: string): number => {
    const done = layer.get(taskId);
    if (done !== undefined) return done;
    visiting.add(taskId);
    let depth = 0;
    for (const dependency of [...known.get(taskId)!.dependencyTaskIds].sort()) {
      if (!known.has(dependency)) continue;
      if (visiting.has(dependency)) { cycleEdges += 1; continue; }
      edges.push({ from: dependency, to: taskId });
      depth = Math.max(depth, visit(dependency) + 1);
    }
    visiting.delete(taskId);
    layer.set(taskId, depth);
    return depth;
  };
  const ids = [...known.keys()].sort();
  for (const taskId of ids) visit(taskId);
  const nodes: LayoutNode[] = [];
  const filled = new Map<number, number>();
  for (const taskId of ids) {
    const at = layer.get(taskId)!;
    const index = filled.get(at) ?? 0;
    filled.set(at, index + 1);
    nodes.push({ taskId, layer: at, index });
  }
  const key = (edge: { from: string; to: string }): string => `${edge.from}\0${edge.to}`;
  edges.sort((left, right) => (key(left) < key(right) ? -1 : 1));
  return { nodes, edges, layers: filled.size, missing, cycleEdges };
}
