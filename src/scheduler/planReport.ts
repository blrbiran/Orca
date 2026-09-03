import type { TaskGraph } from "./graph.js";
import type { PlanFile, PlanRejection } from "./planFile.js";

/**
 * Spec §9.1(4) / §4.2's own count: nine up-front checks, not eleven and not
 * seven — six are plan-level (spec §2.3, already enforced by loadPlan by the
 * time a caller has a PlanFile at all) and three are runtime (spec §4.2,
 * owned by a later task's real preflight). Kept as two separate lists,
 * exported, so a caller building a preflight report and this renderer never
 * drift on what the nine names actually are.
 */
export const PLAN_LEVEL_CHECKS = [
  "relative-path",
  "duplicate-task-id",
  "cycle",
  "contract-inside-target-repo",
  "work-branch-is-default",
  "unsupported-policy",
] as const;

// Ruling R3: PreflightReport (Task 6) does not exist yet. `orca plan` never
// spawns anything to evaluate these — §9.2 forbids the plan path from
// touching the target repo at all — so as of this task they never appear in
// `preflight.rejections`, and this renderer must print "not evaluated"
// rather than fake a "pass" it never checked. Task 6's real preflight must
// use exactly these three code strings for its rejections, or this print
// will keep calling them "not evaluated" even once they run.
export const RUNTIME_CHECKS = ["work-branch-already-exists", "base-not-a-commit", "target-worktree-dirty"] as const;

/**
 * Spec §5.3 / §9.1(6): a pair whose requiredChecks union is empty escalates
 * on its first conflict instead of being reconciled — worth flagging before
 * a run, not after. Computing the union itself is `requiredChecksUnion`, a
 * later task's function (it needs each task's parsed contract, which
 * TaskGraph does not carry — only the write sets derived from it). Until
 * that task exists, nothing populates this field on a real TaskGraph
 * (buildGraph's return type has no such property), so the warning simply
 * never prints for a real `orca plan` run — honest omission, not a fabricated
 * "no gap found". This type only exists so a future caller has somewhere
 * structurally compatible to attach that data without widening TaskGraph
 * itself; a plain TaskGraph already satisfies it because every field here is
 * optional.
 */
export interface PlanGraphExtras {
  emptyRequiredChecksPairs?: Array<{ from: string; to: string }>;
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
  opts: { verbose: boolean },
): string {
  const lines: string[] = [];

  // §9.1(4): landing policy, W's name, and the nine up-front checks.
  lines.push(`Plan: ${plan.tasks.length} task(s), policy=${plan.policy}, workBranch=${plan.workBranch}`);
  lines.push("");
  lines.push("Preflight checks:");
  for (const code of PLAN_LEVEL_CHECKS) lines.push(checkLine(code, preflight.rejections, true));
  for (const code of RUNTIME_CHECKS) lines.push(checkLine(code, preflight.rejections, false));
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
