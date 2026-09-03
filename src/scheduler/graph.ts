import type { DecisionEvent } from "../ledger/schema.js";
import type { PlanFile, PlanTask } from "./planFile.js";
import { intersect, type PathConflict } from "./pathTrie.js";
import { writeSetOf, type ClaimedPath } from "./writeSet.js";

export interface ImplicitEdge {
  from: string;
  to: string;
  conflicts: PathConflict[];
}

export interface TaskGraph {
  layers: string[][];
  explicit: Array<[string, string]>;
  implicit: ImplicitEdge[];
  writeSets: Map<string, ClaimedPath[]>;
}

/**
 * Shared cycle detector — ruling R2 (SDD ledger, controller ruling on Task 4):
 * this used to be a private, deliberately temporary DFS inside planFile.ts
 * (comment there called out the planned convergence). It moved here because
 * this is where the rest of the task graph lives, and planFile.ts now calls
 * this function instead of keeping its own copy. Two call sites sharing one
 * DFS is the point: a fix to one no longer risks leaving the other stale.
 *
 * Operates on dependsOn edges only — the explicit graph a plan file declares.
 * It says nothing about the implicit (write-set) edges buildGraph derives;
 * those are constructed to never contradict an explicit edge (see
 * buildGraph's dedup below), so they cannot introduce a cycle that this
 * function would have missed.
 */
export function detectCycle(tasks: PlanTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map<string, number>();

  function visit(id: string): boolean {
    const status = state.get(id) ?? WHITE;
    if (status === GRAY) return true;
    if (status === BLACK) return false;
    state.set(id, GRAY);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependsOn) {
        if (visit(dep)) return true;
      }
    }
    state.set(id, BLACK);
    return false;
  }

  for (const task of tasks) {
    if (visit(task.taskId)) return true;
  }
  return false;
}

/**
 * Undirected pair key, independent of argument order — used to dedupe
 * explicit edges and index implicit ones.
 *
 * Fix round 1, finding 1: this used to join a and b with a raw separator
 * character. taskId has no character restriction (planFile.ts's schema is
 * `z.string().min(1)`), so nothing stopped that separator from colliding
 * with a taskId's own content — and in a prior draft it was literally a NUL
 * byte, which made git treat this entire file as binary (`git diff`,
 * `git blame`, and PR review all degrade to "Binary files differ"). Every
 * key here must stay printable text: JSON.stringify of the sorted pair is
 * injective for arbitrary strings (the quoting makes the two names
 * unambiguous even if one contains the other, a space, or a quote) without
 * ever needing a delimiter character that could appear inside a taskId.
 */
function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

/**
 * spec 2.4: edges = explicit dependsOn ∪ implicit (write-set intersection).
 * An implicit edge has no natural direction (spec 2.4's own warning — bazel,
 * buck2, snakemake and pants all hit this and hand it to a human), so the
 * tie-break is taskId lexicographic order, deterministic and cheap.
 *
 * A pair that already has an explicit edge (either direction) is skipped
 * here on purpose: dependsOn already fixes that pair's order for a real
 * reason, and if the lexicographic tie-break happened to disagree with it
 * (nothing requires taskId order to match author intent), adding an implicit
 * edge on top would silently create a 2-node cycle that nothing upstream
 * checks for — detectCycle above only looks at dependsOn. Skipping is also
 * the honest scheduling story: there was no arbitrary choice to record,
 * because the order was never ambiguous.
 */
function buildImplicitEdges(tasks: PlanTask[], writeSets: Map<string, ClaimedPath[]>): ImplicitEdge[] {
  const explicitPairs = new Set<string>();
  for (const task of tasks) {
    for (const dep of task.dependsOn) explicitPairs.add(pairKey(dep, task.taskId));
  }

  const edges: ImplicitEdge[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i].taskId;
      const b = tasks[j].taskId;
      if (explicitPairs.has(pairKey(a, b))) continue;
      const conflicts = intersect(writeSets.get(a) ?? [], writeSets.get(b) ?? []);
      if (conflicts.length === 0) continue;
      const [from, to] = a < b ? [a, b] : [b, a];
      edges.push({ from, to, conflicts });
    }
  }
  return edges;
}

/**
 * Layering, spec 2.4 line 168: "边 ＝ 显式 dependsOn ∪ 隐式（写集相交）。
 * 分层用 Kahn 拓扑排序，层内并行" — layering by Kahn, parallel *within* a
 * layer. Every task with zero remaining in-degree at a given step is batched
 * into that step's layer together, not just the first one found.
 *
 * Fix round 1, finding 2: an earlier draft read spec §3.3/§9.1's warning
 * about a `**` claim ("intersects everyone ⇒ the whole graph serialises")
 * as license to serialise an entire connected component one task at a time
 * once it had any edge at all — so on a diamond (A→B, A→C, B→D, C→D, B/C
 * disjoint) it produced [[A],[B],[C],[D]] instead of [[A],[B,C],[D]]. That
 * over-reads a warning in the report-printing section as the algorithm
 * itself; §2.4 is the definitional statement, and it says "层内并行". The
 * `**` case in the criteria below still ends up fully alone in its own
 * layer — because it truly does conflict with every other task, so it has
 * an edge to each of them and can never reach zero in-degree alongside any
 * of them — without forcing tasks that are merely downstream of it, but not
 * of each other, to serialise too.
 */
export function buildGraph(plan: PlanFile, contracts: Map<string, unknown>): TaskGraph {
  const taskIds = plan.tasks.map((t) => t.taskId);
  const writeSets = new Map<string, ClaimedPath[]>();
  for (const task of plan.tasks) {
    writeSets.set(task.taskId, writeSetOf(contracts.get(task.taskId)));
  }

  const explicit: Array<[string, string]> = [];
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) explicit.push([dep, task.taskId]);
  }

  const implicit = buildImplicitEdges(plan.tasks, writeSets);

  const outEdges = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  const inDegree = new Map<string, number>(taskIds.map((id) => [id, 0]));
  const allEdges: Array<[string, string]> = [...explicit, ...implicit.map((e): [string, string] => [e.from, e.to])];
  for (const [a, b] of allEdges) {
    outEdges.get(a)?.push(b);
    inDegree.set(b, (inDegree.get(b) ?? 0) + 1);
  }

  // Standard batched Kahn: every ready (zero in-degree) task goes into the
  // same layer, sorted by taskId so the result — and anything printed from
  // it, e.g. `orca plan` — is deterministic rather than iteration-order
  // dependent.
  const remaining = new Set(taskIds);
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
    if (ready.length === 0) {
      // Cannot happen given the invariants above (explicit edges are acyclic
      // per loadPlan's detectCycle call, and implicit edges never contradict
      // an explicit one — see buildImplicitEdges) — but a loop that could
      // spin forever on bad input must fail loudly, not hang.
      throw new Error(`buildGraph: no schedulable task among ${[...remaining].join(", ")} — a cycle slipped through`);
    }
    layers.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      for (const succ of outEdges.get(id) ?? []) {
        if (remaining.has(succ)) inDegree.set(succ, (inDegree.get(succ) ?? 0) - 1);
      }
    }
  }

  return { layers, explicit, implicit, writeSets };
}

/**
 * One `scheduling` decision per implicit edge (spec 2.4's own instruction):
 * the direction is an arbitrary tie-break, so it must be overturnable rather
 * than silent. `alternatives` carries the direction not taken — deleting it
 * is exactly mutation M-DEC, and the real schema requires at least one
 * (decisionEventSchema: `alternatives: z.array(...).min(1)`), so an empty
 * array does not just look incomplete, it fails validateLine outright.
 *
 * `now` is injectable so criteria can pin a value; production gets a real
 * timestamp by default. Layer ① is pure, but `at` is a required ledger
 * field — this is the seam between the two, not an exception to purity.
 */
export function implicitEdgeDecisions(
  g: TaskGraph,
  runId: string,
  now: () => string = () => new Date().toISOString(),
): DecisionEvent[] {
  return g.implicit.map((edge, index) => {
    const at = now();
    const paths = edge.conflicts.map((c) => c.a.declared).join(", ");
    return {
      ev: "decision",
      id: `${runId}/${index + 1}`,
      at,
      run: runId,
      question: `the write sets of ${edge.from} and ${edge.to} intersect (${paths}), and nothing about the pair says which of them should run first`,
      chose: `${edge.from} runs before ${edge.to}`,
      alternatives: [
        {
          option: `${edge.to} runs before ${edge.from}`,
          why_not: `neither direction is more correct than the other; taskId lexicographic order puts the smaller one first as a deterministic default (${edge.from} < ${edge.to}), and the scheduler is not allowed to make that choice silently on a person's behalf`,
        },
      ],
      because: `an implicit edge has no natural direction (spec 2.4); this implementation's convention is taskId lexicographic order, and ${edge.from} < ${edge.to}, so ${edge.from} goes first`,
      undo: {
        how: `edit src/scheduler/graph.ts: swap the implicit edge direction between ${edge.from} and ${edge.to}`,
        cost: "change one direction choice and re-run the affected layering",
        blast_radius: `the execution order of ${edge.from} and ${edge.to} within this run`,
      },
      scope: "task",
      kind: "scheduling",
    };
  });
}
