/**
 * Board spec 2026-10-03 D1: where each task of a group sits in the drawn dependency graph. Pure code (Rule 5): a task's
 * layer is the length of the longest dependency path to it, and inside a layer tasks are ordered by id -- then, from the
 * second layer on, by barycenter (#232): the mean row of the tasks each one depends on, ties by id, so edges between
 * layers cross less. Pure and deterministic: the same items give the same layout whatever their order. A dependency on
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

/** UTF-16 code unit order, as the server's `compareText` (src/control/webProtocol.ts): never `localeCompare`. */
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

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
  const byLayer = new Map<number, string[]>();
  for (const taskId of ids) {
    const at = layer.get(taskId)!;
    byLayer.set(at, [...(byLayer.get(at) ?? []), taskId]);
  }
  // #232: one downward barycenter pass. Layer 0 keeps id order; each later layer is ordered by the mean row of its drawn
  // dependencies (all in earlier layers, so already placed), ties by id.
  const row = new Map<string, number>();
  const dependenciesOf = new Map<string, string[]>();
  for (const edge of edges) dependenciesOf.set(edge.to, [...(dependenciesOf.get(edge.to) ?? []), edge.from]);
  const nodes: LayoutNode[] = [];
  for (const at of [...byLayer.keys()].sort((left, right) => left - right)) {
    const barycenter = (taskId: string): number => {
      const rows = (dependenciesOf.get(taskId) ?? []).map((dependency) => row.get(dependency)!);
      return rows.length === 0 ? 0 : rows.reduce((sum, value) => sum + value, 0) / rows.length;
    };
    const ordered = at === 0 ? byLayer.get(at)! : [...byLayer.get(at)!].sort((left, right) => barycenter(left) - barycenter(right) || compareText(left, right));
    ordered.forEach((taskId, index) => row.set(taskId, index));
    for (const taskId of ordered) nodes.push({ taskId, layer: at, index: row.get(taskId)! });
  }
  nodes.sort((left, right) => compareText(left.taskId, right.taskId));
  const key = (edge: { from: string; to: string }): string => `${edge.from}\0${edge.to}`;
  edges.sort((left, right) => (key(left) < key(right) ? -1 : 1));
  return { nodes, edges, layers: byLayer.size, missing, cycleEdges };
}
