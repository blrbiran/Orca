import { join } from "node:path";
import type { DecisionEvent } from "../ledger/schema.js";
import { appendEvent } from "../ledger/writer.js";
import { git } from "./gitExec.js";
import type { MaterialisedConflict } from "./reconcile.js";

/**
 * A' section 3.3 puts the bound line in the commit that implements the
 * decision, and `git blame` on that line is how "which commit implemented it"
 * is answered. A commit-tree commit's tree is fixed the instant it is built,
 * so writing the ledger line afterwards puts it on the following commit — the
 * blame answer is then wrong, and every test still passes. Hence: write the
 * line into the tree, then build.
 */
export async function writeBoundThenCommit(
  copy: string, decisionIds: string[], taskId: string, runId: string, build: () => Promise<string>,
): Promise<string> {
  for (const id of decisionIds) {
    await appendEvent(join(copy, ".decisions"), runId, { ev: "bound", id, taskId, runId });
  }
  await git(copy, ["add", "-A", ".decisions"]);
  // build() reads the index/tree that now contains the bound lines.
  return await build();
}

/**
 * spec §8.1's `reconcile` row, and §5.5's reason for the kind existing at all:
 * choosing to have an agent resolve two agents' colliding code is a choice
 * about code content, not about ordering, and the panel has to be able to tell
 * those apart because the second is an order of magnitude riskier.
 *
 * ⚠️ ONE decision per conflict, not one per block, and the difference is not
 * laziness. §5.5's per-block judgements are the MODEL's — classify this block
 * textual or semantic — and in v1 the reconciliation runs on ccloop's
 * `scripted` adapter, which classifies nothing. Emitting N identical
 * per-block decisions would be C claiming, in an append-only file that can
 * never be corrected, that a classification happened. The choice C actually
 * makes is the one recorded here: reconcile automatically rather than stop at
 * this merge point and escalate (§5.4). The blocks are named inside it so a
 * reader can see what the choice covered. A reconciling agent's own per-block
 * decisions belong in ITS copy's `.decisions/<its-run-id>.jsonl` (§8.0's first
 * row), which is a different file and a different author.
 *
 * ⚠️ This decision lands on W inside the rebuilt merge commit rather than in a
 * separate commit of its own (§8.0's second row), and that is forced rather
 * than chosen. The merge commit's tree comes from the copy; a decision
 * committed onto W between the W tip being captured and the rebuild would not
 * be in that tree, so fast-forwarding W onto the rebuilt commit would DELETE
 * the line again — an append-only violation that nothing would report. §8.0's
 * reason for wanting a separate commit is attribution ("blame should say C,
 * not whoever's task landed next"), and it survives: the rebuilt merge commit
 * is authored by orca and is C's own commit.
 */
export function reconcileDecision(
  roundId: string,
  seq: number,
  taskId: string,
  otherTaskId: string,
  conflict: MaterialisedConflict,
  workBranch: string,
  at: string,
): DecisionEvent {
  const where = conflict.blocks.map((b) => `${b.path}:${b.startLine}-${b.endLine}`).join(", ");
  return {
    ev: "decision",
    id: `${roundId}/${seq}`,
    at,
    run: roundId,
    question:
      `landing ${taskId} on ${workBranch} conflicted with ${otherTaskId} in ` +
      `${conflict.conflictedPaths.join(", ")} (${conflict.blocks.length} block(s): ${where}), even though ` +
      `the two tasks declared write sets that do not intersect`,
    chose:
      `reconcile it automatically: run one ccloop task against the conflict commit ` +
      `${conflict.conflictCommit} in ${conflict.copyPath}, verified by the union of both tasks' required ` +
      `checks, then rebuild the merge commit from the reconciled tree`,
    alternatives: [
      {
        option: `stop at this merge point and escalate to a human (spec §5.4, exit 3)`,
        why_not:
          "both sides contributed a goal, a success condition and required checks, so the reconciliation " +
          "can be given both intents and verified against both tasks' checks; a mis-classified block fails " +
          "that verification rather than passing silently (§5.1), so escalating here would stop the round " +
          "on something a human does not yet have to decide",
      },
    ],
    because:
      "spec §3.4 rule 1: the write-set criterion is an optimisation, so two tasks it judged disjoint can " +
      "still collide at merge time, and §5.0 makes reconciliation the trunk rather than an exception path. " +
      "§5.2 keeps the conflicting task from being the reconciler by construction — the synthesized " +
      "contract carries both sides' intent, which neither task's own contract does",
    undo: {
      how: `git branch -f ${workBranch} ${conflict.wTip}`,
      cost: `discard the reconciled merge commit and re-decide the conflict by hand in ${conflict.copyPath}`,
      blast_radius: `the single merge commit this reconciliation puts on ${workBranch}`,
    },
    scope: "repo",
    kind: "reconcile",
  };
}
