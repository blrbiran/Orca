import type { TaskGraph } from "./graph.js";
import { PLAN_LEVEL_CHECKS } from "./planFile.js";
import type { PlanFile, PlanRejection } from "./planFile.js";
import { requiredChecksUnion } from "./writeSet.js";

/**
 * Spec §9.1(4) / §4.2's own count: the up-front checks come in two kinds —
 * plan-level (spec §2.3, enforced by loadPlan by the time a caller has a
 * PlanFile at all) and runtime (spec §4.2, owned by preflight.ts).
 *
 * 🔴 The plan-level list is RE-EXPORTED from planFile.ts, never retyped here.
 * That was the whole defect the final review found: this file used to carry a
 * second, hand-typed copy that imported nothing from loadPlan, and
 * `checkLine` below renders a code it cannot find among the rejections as
 * `[pass] <code>` — so a rename on one side printed a green line for a check
 * that no longer exists, in the report a human approves a round from.
 *
 * (The count is now seven plan-level + three runtime, not spec §9.1(4)'s
 * "nine": the final review added `unusable-task-id` as a seventh plan-level
 * rejection because it is mechanically decidable from the plan file alone.
 * Recorded as an erratum against the spec's count, not a silent drift.)
 */
export { PLAN_LEVEL_CHECKS };

// Task 6's real preflight (src/scheduler/preflight.ts) imports this constant
// rather than retype the strings — it is the one source of truth for what
// these three codes are called. `dirty-worktree` matches task-6-brief.md's
// own S22 criterion verbatim (fix round 1, finding 1); the other two have no
// prior authority anywhere in the repo and were fixed by controller ruling
// in the same round.
//
// Before Task 6, `orca plan` never spawned anything to evaluate these — a
// bare `git rev-parse`/`git status --porcelain` still does not "touch" the
// target repo per §9.1(4) — so these three always printed "not evaluated"
// with nothing that could tell that state apart from "evaluated, and
// clean". `renderPlanReport`'s `opts.runtimeChecksEvaluated` (below) is the
// signal a caller sets once it has actually run the checks; omitting it
// keeps the pre-Task-6 default so a caller who never wires in a real
// preflight still gets an honest "not evaluated" rather than a fabricated
// "pass".
//
// ⚠️ Keyed, not positional, for the same reason `PLAN_LEVEL_CHECK` is: the
// order here is a print order, and a print order must not be able to reach
// which name means which code (final review's parked finding).
export const RUNTIME_CHECK = {
  WORK_BRANCH_ALREADY_EXISTS: "work-branch-already-exists",
  BASE_NOT_A_COMMIT: "base-not-a-commit",
  DIRTY_WORKTREE: "dirty-worktree",
} as const;

/** The same codes as a list, in the order `orca plan` prints them. */
export const RUNTIME_CHECKS = Object.values(RUNTIME_CHECK);

/**
 * Spec §5.3 / §9.1(6): a pair whose requiredChecks union is empty escalates
 * on its first conflict instead of being reconciled — worth flagging before
 * a run, not after. TaskGraph itself does not carry this (it only carries
 * write sets derived from contracts, not the contracts themselves), so it is
 * attached as an optional extra rather than by widening TaskGraph's own
 * exported type — every field here is optional, so a plain TaskGraph is
 * still assignable to `TaskGraph & PlanGraphExtras` wherever a caller has not
 * computed this yet.
 *
 * Fix round 1, finding 2: this used to be a seam nothing production filled in
 * — `orca plan` passed a bare TaskGraph and the field was always undefined,
 * so the warning below could never fire for a real run, indistinguishably
 * from "checked, found none". `emptyRequiredChecksPairs()` below is what the
 * CLI now calls to actually fill it in, using the same contracts map
 * buildGraph already received.
 */
export interface PlanGraphExtras {
  emptyRequiredChecksPairs?: Array<{ from: string; to: string }>;
}

/**
 * Computes, for every intersecting pair the graph found, whether the two
 * tasks' requiredChecks union is empty (spec §5.3 / §9.1(6)) — the data
 * `renderPlanReport` needs to print the escalation warning, kept as its own
 * pure function so the CLI can call it with the contracts map it already
 * loaded for buildGraph, without renderPlanReport itself doing any I/O.
 */
export function emptyRequiredChecksPairs(
  g: TaskGraph,
  contracts: Map<string, unknown>,
): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (const edge of g.implicit) {
    const union = requiredChecksUnion(contracts.get(edge.from), contracts.get(edge.to));
    if (union.length === 0) pairs.push({ from: edge.from, to: edge.to });
  }
  return pairs;
}

function pairMatches(pair: { from: string; to: string }, from: string, to: string): boolean {
  return (pair.from === from && pair.to === to) || (pair.from === to && pair.to === from);
}

function checkLine(code: string, rejections: PlanRejection[], evaluated: boolean): string {
  const hit = rejections.find((r) => r.code === code);
  if (hit) return `  [fail] ${code}: ${hit.message}`;
  return evaluated ? `  [pass] ${code}` : `  [not evaluated] ${code}`;
}

/**
 * `orca plan` is the front half of `orca run`, stopped before it executes
 * anything (spec §9.4) — this is the shared printer both call, so what a
 * human reads before approving a run and what actually runs cannot drift
 * apart into two implementations. Pure by construction: everything it needs
 * is already computed by loadPlan/buildGraph before this is called, so it
 * only ever formats — no filesystem, no git, no spawn.
 */
export function renderPlanReport(
  g: TaskGraph & PlanGraphExtras,
  plan: PlanFile,
  preflight: { rejections: PlanRejection[] },
  // `runtimeChecksEvaluated` defaults to false (undefined) rather than being
  // required, so that Task 5's own frozen call sites — which pass a
  // hand-built `{ rejections }` never routed through the real preflight() —
  // keep printing exactly the "not evaluated" text they always have,
  // unmodified. Only Task 6's CLI wiring, which really ran the three checks,
  // sets it to true.
  // `base` is REQUIRED, unlike `runtimeChecksEvaluated` above: an optional
  // field would make "the caller forgot to pass it" and "there is no base"
  // print identically, which is the same seam-nothing-fills-in shape
  // emptyRequiredChecksPairs was burned by in fix round 1.
  opts: { verbose: boolean; runtimeChecksEvaluated?: boolean; base: { branch: string; sha: string | null } },
): string {
  const lines: string[] = [];

  // §9.1(4): landing policy, W's name, and the up-front checks.
  lines.push(`Plan: ${plan.tasks.length} task(s), policy=${plan.policy}, workBranch=${plan.workBranch}`);

  // Final review, Important 7: where W starts is the single most consequential
  // fact about a round, and it was the one thing a human approving a plan
  // could not see. Named honestly (Important 7's second half): the base is
  // whatever branch the target repository currently has checked out — orca
  // does NOT resolve the repository's true default branch, so running it while
  // sitting on `feature/x` cuts W from `feature/x`. Saying "default branch"
  // here would be a claim the code does not make good on.
  lines.push(
    `Base: ${plan.workBranch} will be cut from ${opts.base.branch === "" ? "<no branch checked out>" : opts.base.branch}` +
      ` — the branch currently checked out in ${plan.targetRepo} — at ${opts.base.sha ?? "<no commit yet>"}`,
  );
  lines.push("");
  lines.push("Preflight checks:");
  for (const code of PLAN_LEVEL_CHECKS) lines.push(checkLine(code, preflight.rejections, true));
  for (const code of RUNTIME_CHECKS) {
    lines.push(checkLine(code, preflight.rejections, opts.runtimeChecksEvaluated ?? false));
  }
  lines.push("");

  // §9.1(1): each task's write set, normalized alongside the string it
  // actually declared — without `declared`, "src/**" and a directory
  // literally named "src" render identically and a reader can no longer
  // tell which one a task's contract contains.
  lines.push("Write sets:");
  for (const task of plan.tasks) {
    lines.push(`  ${task.taskId}:`);
    const claims = g.writeSets.get(task.taskId) ?? [];
    if (claims.length === 0) {
      lines.push("    (none declared)");
      continue;
    }
    for (const claim of claims) {
      const normalized = claim.normalized === "" ? "(repo root)" : claim.normalized;
      lines.push(`    ${claim.declared} -> ${normalized}`);
    }
  }
  lines.push("");

  // §9.1(2) + §9.5's first discipline: pairs are O(n^2), so the default is a
  // summary and a count, never a partial list — a truncated "[+N more]" reads
  // as complete when it is not, which this repo has already been burned by
  // once (rtk's filtering layer). --verbose is the only way to see every
  // conflicting path in every pair; short of that, nothing per-pair prints.
  lines.push(`Intersecting pairs: ${g.implicit.length}`);
  if (opts.verbose) {
    for (const edge of g.implicit) {
      for (const conflict of edge.conflicts) {
        lines.push(`  ${edge.from} x ${edge.to}: ${conflict.kind} (${conflict.a.declared} vs ${conflict.b.declared})`);
      }
    }
  }
  // §9.1(6): this warning is not part of the N^2 listing above — it is a
  // proactive, always-on flag (spec's own "两种最贵形状" framing), so it must
  // survive even in non-verbose mode, naming the pair so it is actionable
  // without rerunning with --verbose.
  for (const edge of g.implicit) {
    if ((g.emptyRequiredChecksPairs ?? []).some((p) => pairMatches(p, edge.from, edge.to))) {
      lines.push(
        `  ${edge.from} x ${edge.to}: requiredChecks union is empty — this pair would escalate on its first conflict instead of being reconciled (spec §5.3)`,
      );
    }
  }
  lines.push("");

  // §9.1(3) + §9.1(5): layers and each one's parallelism, with the
  // degradation warning printed immediately next to the layer it explains —
  // ruling: a task whose write set normalizes to the repo root is alone in
  // its own layer (nothing runs concurrently WITH it), not proof the whole
  // plan is serial — tasks merely downstream of it can still share a layer
  // with each other (see graph.ts's own layering comment).
  lines.push("Layers (parallelism):");
  g.layers.forEach((layer, index) => {
    lines.push(`  layer ${index}: ${layer.join(", ")} (parallelism: ${layer.length})`);
    if (layer.length === 1) {
      const taskId = layer[0];
      const claimsRoot = (g.writeSets.get(taskId) ?? []).some((c) => c.normalized === "");
      if (claimsRoot) {
        lines.push(
          `    ${taskId} claims the whole repository: no parallelism happens with ${taskId} — every other task ` +
            `runs before or after it. Tasks that are merely downstream of ${taskId}, not of each other, may still ` +
            `run concurrently with one another.`,
        );
      }
    }
  });
  lines.push("");

  // §9.5's second discipline, written verbatim, not paraphrased into
  // something weaker: a disjoint write set is what the contract *declares*,
  // not what the task actually touches once it runs.
  lines.push(
    "These are declared write sets. The actual write set is only known once a task finishes. " +
      "Disjoint does not guarantee no conflict.",
  );

  return lines.join("\n");
}
