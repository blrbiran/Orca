import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cloneDirOf } from "./ccloopRunner.js";
import type { TaskRun } from "./ccloopRunner.js";
import type { TaskGraph } from "./graph.js";
import { contains, intersect } from "./pathTrie.js";
import { normalizeClaim } from "./writeSet.js";
import type { ClaimedPath } from "./writeSet.js";

const execFileAsync = promisify(execFile);

/**
 * spec §7.1's two directions, measured in one pass because they are two
 * readings of the same comparison:
 *
 *  - `outOfBounds` is "actual ⊄ declared" — the task wrote somewhere it never
 *    claimed, so the layering decision that let it run in parallel may already
 *    be invalid. The safe direction.
 *  - `declaredNotProduced` is "declared ⊄ actual" — the task claimed a path and
 *    left it alone. A′ §5.1 only ever wrote down the first direction; this one
 *    is the more common failure in this repository's history.
 *  - `empty` is that second direction taken to its limit, and it is called out
 *    as its own field rather than left as `actualPaths.length === 0` at each
 *    call site because it is the only one of the three that is a FAILURE
 *    (§7.3), and a rule that important should not be re-derived per reader.
 */
export interface Reconciliation {
  actualPaths: string[];
  outOfBounds: string[];
  declaredNotProduced: string[];
  empty: boolean;
}

/**
 * spec §7.3's verdict, and deliberately only the verdict: whether the work
 * enters W, and what this task contributes to the round's exit code (§6.3,
 * where 3 > 2 > 1 > 0). It carries no reason string because the caller already
 * holds the Reconciliation the verdict was computed from — the ledger entry is
 * written from that, not from a message duplicated here.
 *
 * The two `land: true` codes are not interchangeable: 0 is "nothing to say",
 * 2 is "it landed AND a boundary decision was recorded".
 */
export type Disposition = { land: true; exitContribution: 0 | 2 } | { land: false; exitContribution: 2 | 3 };

/**
 * The sibling set §7.3's first tier is about: the OTHER tasks in this task's
 * own layer, and nothing else in the graph.
 *
 * This lives here rather than in each caller because "layer, not whole graph"
 * is the load-bearing half of the rule, and a decision no production code
 * expresses is a decision no mutation can delete. Spec §7.3's own reasoning:
 * only same-layer tasks start from the same W HEAD unable to see each other,
 * so only there can an out-of-bounds write silently break someone. A later
 * layer starts from a W that already contains this task's landed result, so it
 * inherits rather than races, and its overlap surfaces as an ordinary merge
 * conflict that §5 handles. Escalating on that would turn every ordinary
 * conflict into a human interrupt.
 *
 * The task itself is excluded. Nothing downstream depends on that — an
 * out-of-bounds path is by construction outside every claim this task made —
 * but leaving it in would say "a task can collide with itself", which is not a
 * sentence §7.3 means.
 */
export function sameLayerWriteSets(graph: TaskGraph, taskId: string): Map<string, ClaimedPath[]> {
  const layer = graph.layers.find((ids) => ids.includes(taskId)) ?? [];
  const siblings = new Map<string, ClaimedPath[]>();
  for (const id of layer) {
    if (id === taskId) continue;
    siblings.set(id, graph.writeSets.get(id) ?? []);
  }
  return siblings;
}

/**
 * spec §7.2: C measures the net change set ITSELF.
 *
 * ccloop collects one too, and collects it honestly — `git status
 * --porcelain=v1 -z --untracked-files=all`, not a model's self-report. But its
 * entry point is `observeChangedPathsBestEffort`, and a best-effort
 * measurement cannot carry a correctness argument: a swallowed failure there
 * is indistinguishable from a task that changed nothing, which is precisely
 * the verdict §7.3 turns into a failure. A diff between two commits has no
 * best-effort mode — it throws or it is right.
 *
 * ⚠️ The cost of that choice, written down rather than discovered later: C
 * measures the NET change between two commits, while ccloop measures every
 * file touched along the way. A file edited and then reverted is in ccloop's
 * list and not in this one. That is the correct trade for C's purpose —
 * parallel correctness, which is about what W ends up containing — and it
 * would be the wrong trade for a security audit, which is ccloop's
 * evaluatePathPolicy's job. Two purposes, two data sources; do not merge them.
 *
 * Flags, each load-bearing:
 *  - `--no-renames` because git's rename detection is ON by default
 *    (diff.renames since 2.9) and `--name-only` then prints only a rename's
 *    DESTINATION. The source path was written too — emptied and removed — and
 *    hiding it would drop a real out-of-bounds write from the reconciliation.
 *    Passing it explicitly also makes the result independent of whatever
 *    diff.renames the machine happens to be configured with.
 *  - `-z` because git otherwise quotes and escapes paths outside ASCII
 *    (core.quotePath), so a perfectly ordinary non-ASCII filename would arrive
 *    as a quoted string that no claim could ever contain.
 */
async function netChangeSet(clone: string, base: string, attemptSha: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", base, attemptSha],
    { cwd: clone, maxBuffer: 64 * 1024 * 1024 },
  );
  // Sorted rather than left in git's order so that every consumer — a
  // criterion, a ledger entry, a printed report — compares the same list. git
  // already emits tree order, but that is an implementation detail of git's,
  // not a promise to us.
  return stdout.split("\0").filter((p) => p.length > 0).sort();
}

export async function harvest(run: TaskRun, base: string, declared: ClaimedPath[]): Promise<Reconciliation> {
  // Measured in Task 8: `blocked_waiting_human` is the one terminal status that
  // leaves NO attempt ref — runLoop persists it and returns without entering
  // any cleanup path, and publishAttemptCommit only ever runs from inside
  // cleanup. So this is a real, expected state, not a corrupt one.
  //
  // It still has to be refused rather than absorbed. There is exactly one
  // plausible way to absorb it — report an empty change set — and that is the
  // worst available answer: disposition would then call a run that is waiting
  // on a human `succeeded_but_empty` and contribute 2, and §6.3 says in as many
  // words that downgrading a 3 to a 2 makes the thing a human must do vanish
  // into a pile of failures. §7.5 makes the same point structurally: all of §7
  // rests on C holding two real commits, and without the result commit
  // direction two cannot tell "collection failed" from "the agent did nothing".
  //
  // The caller routes on the outcome (§6.1) first and only harvests a run that
  // produced something. Reaching here with a null sha is a scheduler bug, and
  // Rule 12 says it should say so.
  if (run.attemptSha === null) {
    throw new Error(
      `orca: run ${run.runId} (outcome ${run.outcome}) published no attempt commit, so there is nothing ` +
        `to reconcile against ${base}; route it by its terminal status instead of harvesting it`,
    );
  }

  const actualPaths = await netChangeSet(cloneDirOf(run.workdir), base, run.attemptSha);

  // Direction one. `contains` rather than a string prefix, and the shared one
  // from pathTrie rather than a second copy: "src/a" must not swallow
  // "src/ab.ts", and that single case is the reason §3.2 is a segment trie at
  // all. A claim normalized to the empty prefix (a bare `**`) contains
  // everything, so a task that claimed the whole repository has no
  // out-of-bounds paths, which is exactly right.
  const outOfBounds = actualPaths.filter((path) => !declared.some((claim) => contains(claim.normalized, path)));

  // Direction two. Reported by the RAW declared string, not the normalized
  // prefix: spec §3.3's rule, for the reason it gives — a task that declared
  // "src/**" being told it failed to produce "src/" reads as a tool bug.
  // De-duplicated by that same raw string, because targetPaths and
  // allowlistPaths are unioned into the write set and a contract may legally
  // name one path in both.
  const declaredNotProduced: string[] = [];
  for (const claim of declared) {
    if (actualPaths.some((path) => contains(claim.normalized, path))) continue;
    if (declaredNotProduced.includes(claim.declared)) continue;
    declaredNotProduced.push(claim.declared);
  }

  return { actualPaths, outOfBounds, declaredNotProduced, empty: actualPaths.length === 0 };
}

export function disposition(r: Reconciliation, siblingWriteSets: Map<string, ClaimedPath[]>): Disposition {
  // §7.3 direction two, first: `succeeded_but_empty`. ccloop said the task
  // succeeded and the tree is byte-identical to the base, so whatever the exit
  // code claimed, nothing was produced. A failure (exit 2), not a quiet
  // success — publishAttemptCommit commits with `--allow-empty` on purpose, so
  // an empty run still leaves a real commit behind a real ref and no layer
  // below this one can tell the difference.
  //
  // ⚠️ Known cost, registered in §6.5 rather than hidden: a task that
  // legitimately changes nothing ("confirm X is already correct") is judged a
  // failure here. The contract field that would declare that does not exist
  // today, and of the two possible mistakes this repository has already paid
  // for the other one.
  if (r.empty) {
    return { land: false, exitContribution: 2 };
  }

  if (r.outOfBounds.length > 0) {
    // §7.3 direction one, first tier. The out-of-bounds paths are compared
    // against siblings as CLAIMS, through the same trie the layering decision
    // itself was made with (§3.2): a stray write to "src/x.ts" collides with a
    // sibling that claimed "src/**" just as surely as with one that named the
    // file. Using anything weaker here would let a collision through, which is
    // the one direction §7.3 refuses to be wrong in.
    const oob = r.outOfBounds.map(normalizeClaim);
    const collides = [...siblingWriteSets.values()].some((sibling) => intersect(oob, sibling).length > 0);
    if (collides) {
      // The parallelism verdict for this layer was computed from declarations
      // this run has just proved wrong, so no landing order can be argued to be
      // safe and the two tasks may already have broken each other. Refuse, and
      // escalate: a human has to look (exit 3).
      return { land: false, exitContribution: 3 };
    }
    // Second tier. Nobody else in this layer claims these paths, so nobody
    // else can have been broken by them. The money is already spent and there
    // is no "un-write" to roll back to, so discarding the work would be pure
    // waste — it lands, with a tier-1 `boundary` decision in the ledger and a
    // visible exit 2. This is §0.2's trade made explicit: declaring too
    // narrowly is common and mostly harmless, right up until it collides.
    return { land: true, exitContribution: 2 };
  }

  // Everything declared-but-not-produced ends here, on purpose: a warning and
  // a ledger entry, never a failure. snakemake raises MissingOutputException in
  // this situation and is right to — its outputs are rule-declared and
  // machine-precise. `targetPaths` is a human-written intent range, usually
  // written wide. Applying a precise contract's strictness to a coarse one
  // trains people to write targetPaths as narrow as they can get away with,
  // and §3.1 is explicit that a narrow declaration is the UNSAFE direction:
  // it is what makes the layering miss a real overlap.
  return { land: true, exitContribution: 0 };
}
