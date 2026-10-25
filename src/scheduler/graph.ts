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
 * those all point forward along one topological order of these same
 * dependsOn edges (see buildImplicitEdges), so they cannot introduce a cycle
 * that this function would have missed.
 */
export function detectCycle(tasks: ReadonlyArray<Pick<PlanTask, "taskId" | "dependsOn">>): boolean {
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
 * Issue 88 (human ruling: fix it): the position of every task in ONE total order that extends the dependsOn graph —
 * Kahn's topological order, taking the smallest taskId whenever several tasks are free at once. Implicit edges are
 * oriented along it. The earlier rule oriented each pair on its own by taskId lexicographic order, which says nothing
 * about dependsOn: with "t10" < "t2", the implicit edge t11 -> t2 closed a cycle with the explicit chain t2 -> ... -> t11
 * and buildGraph threw on a valid plan. Orienting each pair by dependsOn reachability where there is one is not enough
 * either: with c -> a explicit and b unrelated to both, the pairs a/b and b/c fall back to taskId order (a -> b, b -> c)
 * and close a cycle through c -> a. Edges that all point forward along a single order cannot form a cycle.
 * A plan without dependsOn is therefore ordered exactly as before (lexicographically); with dependsOn, a task can come
 * before one with a smaller taskId even when no dependsOn chain joins the two (b before a in the example above).
 *
 * A task left without a position (only possible if dependsOn itself has a cycle, which loadPlan rejects first) is placed
 * after the rest in taskId order, so buildGraph still reaches its own loud failure rather than this one.
 */
function explicitTopologicalOrder(tasks: PlanTask[]): Map<string, number> {
  const ids = new Set(tasks.map((task) => task.taskId));
  const successors = new Map<string, string[]>(tasks.map((task) => [task.taskId, []]));
  const waitingOn = new Map<string, number>(tasks.map((task) => [task.taskId, 0]));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) continue;
      successors.get(dep)!.push(task.taskId);
      waitingOn.set(task.taskId, waitingOn.get(task.taskId)! + 1);
    }
  }
  const position = new Map<string, number>();
  const free = tasks.map((task) => task.taskId).filter((id) => waitingOn.get(id) === 0);
  while (free.length > 0) {
    free.sort();
    const next = free.shift()!;
    position.set(next, position.size);
    for (const succ of successors.get(next)!) {
      waitingOn.set(succ, waitingOn.get(succ)! - 1);
      if (waitingOn.get(succ) === 0) free.push(succ);
    }
  }
  for (const id of [...ids].filter((id) => !position.has(id)).sort()) position.set(id, position.size);
  return position;
}

/**
 * spec 2.4: edges = explicit dependsOn ∪ implicit (write-set intersection).
 * An implicit edge has no natural direction (spec 2.4's own warning — bazel,
 * buck2, snakemake and pants all hit this and hand it to a human), so the
 * tie-break is deterministic and cheap: the earlier task in
 * explicitTopologicalOrder above goes first. Without dependsOn that is taskId
 * lexicographic order; with it, one order for every pair is what keeps the
 * union acyclic (issue 88).
 *
 * A pair that already has an explicit edge (either direction) is skipped
 * here on purpose: dependsOn already fixes that pair's order for a real
 * reason, so there was no arbitrary choice to record, because the order was
 * never ambiguous. (This skip used to be what kept the lexicographic
 * tie-break from contradicting a direct dependsOn edge; it did nothing for a
 * longer dependsOn chain, which is issue 88. The topological order now keeps
 * every implicit edge consistent with dependsOn on its own.)
 */
function buildImplicitEdges(tasks: PlanTask[], writeSets: Map<string, ClaimedPath[]>): ImplicitEdge[] {
  const explicitPairs = new Set<string>();
  for (const task of tasks) {
    for (const dep of task.dependsOn) explicitPairs.add(pairKey(dep, task.taskId));
  }

  const position = explicitTopologicalOrder(tasks);
  const edges: ImplicitEdge[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i].taskId;
      const b = tasks[j].taskId;
      if (explicitPairs.has(pairKey(a, b))) continue;
      const conflicts = intersect(writeSets.get(a) ?? [], writeSets.get(b) ?? []);
      if (conflicts.length === 0) continue;
      const [from, to] = position.get(a)! < position.get(b)! ? [a, b] : [b, a];
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
export function buildGraph(plan: PlanFile, contracts: Map<string, unknown>, claims?: Map<string, ClaimedPath[]>): TaskGraph {
  const taskIds = plan.tasks.map((t) => t.taskId);
  const writeSets = new Map<string, ClaimedPath[]>();
  for (const task of plan.tasks) {
    // Multi-directory projects spec §6.2: a multi group's claims are qualified by directory and come from the task's
    // `writes`, never from a contract's `repoKey` (the model names directories; code decides what they mean).
    if (claims === undefined) { writeSets.set(task.taskId, writeSetOf(contracts.get(task.taskId))); continue; }
    const claimed = claims.get(task.taskId);
    if (claimed === undefined) throw new Error(`buildGraph: no claims for ${task.taskId}`);
    writeSets.set(task.taskId, claimed);
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
  // it, e.g. `orca plan preview` — is deterministic rather than iteration-order
  // dependent.
  const remaining = new Set(taskIds);
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
    if (ready.length === 0) {
      // Cannot happen given the invariants above (explicit edges are acyclic
      // per loadPlan's detectCycle call, and every implicit edge points
      // forward along one topological order of them — see
      // buildImplicitEdges) — but a loop that could spin forever on bad input
      // must fail loudly, not hang.
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
      question: `the write sets of ${edge.from} and ${edge.to} intersect (${paths}), and no dependsOn edge between the two says which of them should run first`,
      chose: `${edge.from} runs before ${edge.to}`,
      alternatives: [
        {
          option: `${edge.to} runs before ${edge.from}`,
          why_not: `the scheduler orients every implicit edge along one order of all the tasks, a topological order of the dependsOn edges that takes the smallest taskId first whenever several tasks are free, so that no implicit edge can close a cycle with dependsOn or with another implicit edge; ${edge.from} comes before ${edge.to} in that order. In a plan without dependsOn that order is taskId lexicographic order; either way it is a deterministic default, not a judgement that this direction is more correct, and the scheduler is not allowed to make that choice silently on a person's behalf`,
        },
      ],
      because: `an implicit edge has no natural direction (spec 2.4); this implementation follows a topological order of the dependsOn edges, smallest taskId first among tasks free at the same time, and ${edge.from} comes before ${edge.to} in it, so ${edge.from} goes first`,
      undo: {
        how: `declare the other order in the plan: make ${edge.from} depend on ${edge.to}; a dependsOn edge between the two replaces this implicit one`,
        cost: "change one direction choice and re-run the affected layering",
        blast_radius: `the execution order of ${edge.from} and ${edge.to} within this run`,
      },
      scope: "task",
      kind: "scheduling",
    };
  });
}
