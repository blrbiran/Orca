/**
 * Board spec 2026-10-03 D1: where each task of a group sits in the drawn dependency graph. Pure code (Rule 5): a task's
 * layer is the length of the longest dependency path to it, and inside a layer tasks are ordered by id -- then, from the
 * second layer on, by barycenter (#232): the mean row of the tasks each one depends on, ties by id, so edges between
 * layers cross less. Pure and deterministic: the same items give the same layout whatever their order. A dependency on
 * a task the view does not carry is not drawn but counted, and an edge that would close a cycle (the server refuses
 * one; the page must still not hang) is dropped and counted, so the graph never hides either silently.
 * #271: by default the drawing is the transitive reduction -- an edge A->C is not drawn when A reaches C through another
 * drawn path (A->B->C); such implied edges are counted (`implied`) so the page can say so. The data is unchanged, and a
 * caller whose edges are themselves the subject (the board's group graph, where each edge can be removed) passes
 * `reduce: false` to keep them all.
 */
export interface LayoutNode { taskId: string; layer: number; index: number }
export interface DependencyLayout {
  nodes: LayoutNode[];
  /** `from` must finish before `to` starts. */
  edges: Array<{ from: string; to: string }>;
  layers: number;
  missing: number;
  cycleEdges: number;
  /** #271: declared edges not drawn because another drawn path already implies them. */
  implied: number;
}

/** UTF-16 code unit order, as the server's `compareText` (src/control/webProtocol.ts): never `localeCompare`. */
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function layoutDependencies(items: ReadonlyArray<{ taskId: string; dependencyTaskIds: readonly string[] }>, options: { reduce?: boolean } = {}): DependencyLayout {
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
  // #271: an edge is implied when its source reaches its target through another of its successors. The kept edges are
  // acyclic (a closing edge was dropped above), so the walk ends.
  const successors = new Map<string, string[]>();
  for (const edge of edges) successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>(), stack = [from];
    while (stack.length > 0) {
      const at = stack.pop()!;
      if (at === target) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(successors.get(at) ?? []));
    }
    return false;
  };
  const drawn = options.reduce === false ? edges
    : edges.filter((edge) => !(successors.get(edge.from) ?? []).some((next) => next !== edge.to && reaches(next, edge.to)));
  const implied = edges.length - drawn.length;
  const byLayer = new Map<number, string[]>();
  for (const taskId of ids) {
    const at = layer.get(taskId)!;
    byLayer.set(at, [...(byLayer.get(at) ?? []), taskId]);
  }
  // #232: one downward barycenter pass. Layer 0 keeps id order; each later layer is ordered by the mean row of its drawn
  // dependencies (all in earlier layers, so already placed), ties by id.
  const row = new Map<string, number>();
  const dependenciesOf = new Map<string, string[]>();
  for (const edge of drawn) dependenciesOf.set(edge.to, [...(dependenciesOf.get(edge.to) ?? []), edge.from]);
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
  drawn.sort((left, right) => (key(left) < key(right) ? -1 : 1));
  return { nodes, edges: drawn, layers: byLayer.size, missing, cycleEdges, implied };
}

/**
 * Tester #296: the work-items table read in plan order, which the canonical plan stores sorted by task id -- an
 * alphabetical list that matched neither the split nor the graph. The table follows the graph instead: by layer (left to
 * right), then by the row inside the layer. The layout is of `all` (the whole group), so a label filter that hides some
 * rows does not reorder the rest.
 */
export function orderByLayout<T extends { taskId: string }>(shown: readonly T[], all: ReadonlyArray<{ taskId: string; dependencyTaskIds: readonly string[] }>): T[] {
  const at = new Map(layoutDependencies(all).nodes.map((node) => [node.taskId, node]));
  return [...shown].sort((left, right) => {
    const a = at.get(left.taskId), b = at.get(right.taskId);
    if (a === undefined || b === undefined) return a === b ? compareText(left.taskId, right.taskId) : a === undefined ? 1 : -1;
    return a.layer - b.layer || a.index - b.index;
  });
}
