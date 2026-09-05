import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TERMINAL_OUTCOMES } from "./ccloopRunner.js";
import { ORCA_IDENTITY, git } from "./gitExec.js";
import type { ConflictState } from "./land.js";
import type { PlanTask } from "./planFile.js";
import { requiredChecksUnion } from "./writeSet.js";

/**
 * One `<<<<<<< / ======= / >>>>>>>` region of one file, as spec §5.1 needs it:
 * that table gives "enumerate the conflict blocks" to code precisely so the
 * model's row (classify each block, textual or semantic) and the human's row
 * (the semantic leftovers) both have something addressable to work on. A file
 * of marker-laden text is not addressable; a list of blocks is.
 *
 * `ours` is W's side (the merge's first parent) and `theirs` the incoming
 * attempt, in git's own sense — swapping them would attribute each task's
 * intent to the other task, which is the one error §5.2 exists to prevent.
 */
export interface ConflictBlock {
  path: string;
  /** 1-based line of the `<<<<<<<` marker, in the file as committed. */
  startLine: number;
  /** 1-based line of the `>>>>>>>` marker. */
  endLine: number;
  ours: string[];
  theirs: string[];
}

/**
 * spec §5.2's conflict, once step 2 has turned it into an object an agent can
 * be pointed at.
 *
 * The plan's interface list calls this `ConflictState`. That name is already
 * taken, by land.ts, for the four facts a failed `git merge` leaves behind —
 * and this value is exactly those four facts plus what materialisation adds,
 * so it extends that type instead of shadowing it. Two same-named interfaces
 * with different fields in one directory is the drift this project's rubric
 * treats as a defect; the rename is the cheaper half of the trade.
 */
export interface MaterialisedConflict extends ConflictState {
  conflictCommit: string;
  blocks: ConflictBlock[];
}

const CONFLICT_COMMIT_MESSAGE =
  "orca: the conflict itself, recorded so it can be read (spec §5.2 step 2) — never lands on the work branch";

/**
 * git's default conflict style, pinned per invocation instead of inherited.
 * A developer (or a CI image) with `merge.conflictStyle = diff3` or `zdiff3`
 * in their global config makes git emit a third `|||||||` section, which the
 * block parser below would read as part of `ours` — so the reconciliation
 * contract would carry the merge base's text as if one of the tasks had
 * written it. The copy inherits that global config like any other repository,
 * so the only way this is not ambient is to say it here.
 */
const PINNED_CONFLICT_STYLE = ["-c", "merge.conflictStyle=merge"];

const OURS_MARKER = "<<<<<<<";
const SPLIT_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>>";

function parseConflictBlocks(path: string, content: string): ConflictBlock[] {
  const lines = content.split("\n");
  const blocks: ConflictBlock[] = [];
  let start = -1;
  let split = -1;

  for (const [index, line] of lines.entries()) {
    if (line.startsWith(OURS_MARKER)) {
      start = index;
      split = -1;
    } else if (line.startsWith(SPLIT_MARKER) && start >= 0) {
      split = index;
    } else if (line.startsWith(THEIRS_MARKER) && start >= 0 && split >= 0) {
      blocks.push({
        path,
        startLine: start + 1,
        endLine: index + 1,
        ours: lines.slice(start + 1, split),
        theirs: lines.slice(split + 1, index),
      });
      start = -1;
      split = -1;
    }
  }
  return blocks;
}

/**
 * spec §5.2 steps 1 and 2, and the reason the whole section exists.
 *
 * ccloop's `git worktree add --detach` opens a CLEAN worktree for every
 * attempt, and conflict state lives in the index — in `.git/MERGE_HEAD` and
 * unmerged index entries — not in any commit. An agent spawned the ordinary
 * way against this copy would therefore see a tidy tree and nothing to
 * reconcile. Committing the conflicted tree is what turns the markers into
 * ordinary text in a commit the worktree can be opened at.
 *
 * The merge is re-run HERE, in the copy, rather than reusing the one land.ts
 * already did: that one happened in a real person's repository and §4.2.1
 * only lets orca touch it at all because it promises to leave it alone
 * afterwards, so land.ts aborts it. This is the same merge with the same two
 * parents in a directory the round is free to abandon.
 *
 * Both parents are fetched first because neither is guaranteed to be here:
 * the copy was cloned at the LAYER's base, and W's tip has moved since (every
 * earlier task in the layer landed on it), while `refs/orca/<run-id>` was
 * created inside the target repo by land.ts's fetch and has no counterpart in
 * the copy. `git clone --local` hard-links the object store as it was at
 * clone time; it is not a live window onto the origin.
 */
export async function materialiseConflict(
  copy: string,
  wTip: string,
  incomingRef: string,
): Promise<MaterialisedConflict> {
  await git(copy, ["fetch", "--no-tags", "origin", `+${incomingRef}:${incomingRef}`, wTip]);

  // Checked rather than assumed: `git fetch <sha>` is refused by servers that
  // do not allow arbitrary objects to be requested by name, and it fails by
  // leaving FETCH_HEAD alone rather than by exiting non-zero everywhere. A
  // missing wTip would otherwise surface as "checkout: unknown revision" with
  // nothing saying which of the two parents went missing or why.
  try {
    await git(copy, ["cat-file", "-e", `${wTip}^{commit}`]);
  } catch {
    throw new Error(
      `orca: the work branch tip ${wTip} is not in ${copy} after fetching it from origin, ` +
        `so the conflict cannot be re-created there (spec §5.2 step 1)`,
    );
  }

  await git(copy, ["checkout", "--detach", wTip]);

  let mergedCleanly = false;
  try {
    await git(copy, [
      ...ORCA_IDENTITY,
      ...PINNED_CONFLICT_STYLE,
      "merge",
      "--no-ff",
      "-m",
      CONFLICT_COMMIT_MESSAGE,
      incomingRef,
    ]);
    mergedCleanly = true;
  } catch {
    // The expected path. Which files conflicted is read off the index below
    // rather than parsed out of git's message text.
  }

  if (mergedCleanly) {
    // Not a happy accident to be absorbed. The caller got here because the
    // same two commits conflicted in the target repo; if they merge cleanly
    // here, the two repositories disagree about their own object store and
    // anything built on top of that answer is guesswork.
    throw new Error(
      `orca: merging ${incomingRef} into ${wTip} conflicted in the target repository but merged cleanly ` +
        `in ${copy} — refusing to reconcile a conflict that cannot be reproduced`,
    );
  }

  const unmerged = await git(copy, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  const conflictedPaths = unmerged.split("\0").filter((p) => p.length > 0).sort();
  if (conflictedPaths.length === 0) {
    // `git merge` also fails for reasons that are not content conflicts — a
    // refusal to overwrite an untracked file, a broken index. Those leave no
    // unmerged entries, and committing here would produce a "conflict state"
    // commit with no conflict in it and send an agent to reconcile nothing.
    throw new Error(
      `orca: merging ${incomingRef} into ${wTip} failed in ${copy} but left no unmerged paths, ` +
        `so the failure is not a content conflict`,
    );
  }

  await git(copy, ["add", "-A"]);
  await git(copy, [...ORCA_IDENTITY, "commit", "-m", CONFLICT_COMMIT_MESSAGE]);
  const conflictCommit = (await git(copy, ["rev-parse", "HEAD"])).trim();

  // Read back out of the commit, not off disk. What the reconciling agent
  // will see is the commit's tree — its worktree is checked out from that —
  // so the blocks handed to §5.1's classification have to be the ones in it.
  const blocks: ConflictBlock[] = [];
  for (const path of conflictedPaths) {
    blocks.push(...parseConflictBlocks(path, await git(copy, ["show", `${conflictCommit}:${path}`])));
  }

  return { copyPath: copy, wTip, incomingRef, conflictedPaths, conflictCommit, blocks };
}

export type ReconciliationPlan =
  | { escalate: true; why: string }
  | { escalate: false; requiredChecks: string[] };

/**
 * spec §5.3, the whole of it.
 *
 * §5.1's third row makes verification the thing that stops a mis-classified
 * conflict from passing silently: an agent that calls a semantic conflict
 * textual and resolves it wrongly is caught because the union of both sides'
 * `verification.requiredChecks` fails. When that union is EMPTY the safety net
 * is a net with no rope — every reconciliation "passes", and this one was
 * generated automatically, so nobody chose the green either.
 *
 * ⚠️ ccloop's own contract schema is `requiredChecks: z.array(z.string())
 * .min(1)` (ccloop/src/contract/schema.ts:65), so a contract ccloop would
 * accept can never contribute an empty array. This branch stays reachable
 * because subsystem C reads contract files as opaque JSON and never validates
 * them against that schema (see writeSetOf's comment) — which is exactly why
 * the check earns its place: it catches at plan time what would otherwise cost
 * a spawn to discover. See scenario S4 and mutation `M-EMPTYCHK`.
 */
export function planReconciliation(a: unknown, b: unknown): ReconciliationPlan {
  const requiredChecks = requiredChecksUnion(a, b);
  if (requiredChecks.length === 0) {
    return {
      escalate: true,
      why:
        "neither side declares any verification.requiredChecks, so their union is empty and any " +
        "reconciliation would pass by having nothing to check (spec §5.3)",
    };
  }
  return { escalate: false, requiredChecks };
}

/**
 * Everything one side of a conflict has to contribute before a reconciliation
 * contract can be built from it: what it was trying to do, when it would call
 * itself done, and how much the work was sized at.
 */
interface SideIntent {
  goal: string;
  successCondition: string;
  perAttemptTimeoutMs: number;
  totalRuntimeBudgetMs: number;
  tokenBudget: number;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Read defensively, exactly like writeSetOf: a contract arrives here as opaque
 * JSON that nothing in this codebase has validated. `null` means "this side
 * contributed nothing the reconciliation can be built from", which the caller
 * turns into an escalation rather than into a default.
 */
function intentOf(contract: unknown): SideIntent | null {
  const c = contract as
    | { objective?: { goal?: unknown; successCondition?: unknown }; executionPolicy?: Record<string, unknown> }
    | null
    | undefined;

  const goal = typeof c?.objective?.goal === "string" ? c.objective.goal.trim() : "";
  const successCondition =
    typeof c?.objective?.successCondition === "string" ? c.objective.successCondition.trim() : "";
  if (goal === "" || successCondition === "") return null;

  const perAttemptTimeoutMs = positiveInt(c?.executionPolicy?.perAttemptTimeoutMs);
  const totalRuntimeBudgetMs = positiveInt(c?.executionPolicy?.totalRuntimeBudgetMs);
  const tokenBudget = positiveInt(c?.executionPolicy?.tokenBudget);
  if (perAttemptTimeoutMs === null || totalRuntimeBudgetMs === null || tokenBudget === null) return null;

  // maxAttempts is deliberately NOT read: it is pinned to 1 below, so
  // requiring each side to supply a value nothing consumes would be a gate on
  // a field that cannot affect the result.
  return { goal, successCondition, perAttemptTimeoutMs, totalRuntimeBudgetMs, tokenBudget };
}

/**
 * A taskId is a free string out of a plan file, and it is about to become part
 * of a filename. "../../x" would put the synthesized contract wherever the
 * plan's author aimed it — including back inside targetRepo, which is the one
 * place §2.3 exists to keep contracts out of.
 */
function slug(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}

/**
 * spec §5.2's synthesized contract, and its one hard check.
 *
 * The contract is not written by a person: C builds it by splicing both sides'
 * `goal` and `successCondition` together and drops it in `runsDir` — outside
 * the target repo, which is why it satisfies §2.3's "contracts live outside
 * targetRepo" rejection for free rather than needing an exception carved for
 * it.
 *
 * 🔴 The check. "The reconciler must not be the conflicting party" cannot be
 * enforced by a process boundary: it is the same model and possibly the same
 * context, and nothing here can tell those apart. What CAN be enforced is the
 * context it is handed — a contract carrying only one side's goal is, by
 * construction, the conflicting party's own view of the conflict, and that
 * difference is mechanical. So both sides must contribute their goal, their
 * successCondition and the budget the work is sized at; a side that
 * contributes none of that is refused and the round escalates (exit 3) rather
 * than dispatching an agent that can only re-decide in its own favour.
 * See scenario S20 and mutation `M-RECON`.
 *
 * The budget is the max of the two sides rather than a constant, for the same
 * reason: §0.1 forbids quietly substituting a number nobody chose, and
 * reconciling two tasks' conflict is at least as large as either of them.
 * maxAttempts is the exception and is pinned to 1 — §5.1's last note routes a
 * failed verification back to a human, so retrying a reconciliation that did
 * not verify would spend a second attempt on a decision already owed to
 * someone else.
 */
export async function synthesizeReconcileContract(
  a: PlanTask,
  b: PlanTask,
  contracts: Map<string, unknown>,
  runsDir: string,
  conflict: MaterialisedConflict,
): Promise<{ path: string } | { escalate: string }> {
  const intents = [a, b].map((task) => ({ task, intent: intentOf(contracts.get(task.taskId)) }));
  const oneSided = intents.filter((s) => s.intent === null).map((s) => s.task.taskId);
  if (oneSided.length > 0) {
    return {
      escalate:
        `cannot synthesize a reconciliation contract for ${a.taskId} x ${b.taskId}: ` +
        `${oneSided.join(", ")} contributed no goal, successCondition or execution budget, so the contract ` +
        `would carry only the other side's intent and the reconciler would be the conflicting party ` +
        `(spec §5.2)`,
    };
  }
  const [sideA, sideB] = intents.map((s) => s.intent!);

  const plan = planReconciliation(contracts.get(a.taskId), contracts.get(b.taskId));
  if (plan.escalate) return { escalate: plan.why };

  const goal =
    `Reconcile the merge conflict between task ${a.taskId} and task ${b.taskId}. ` +
    `HEAD is a commit that records the conflict itself, so the conflict markers are ordinary text in ` +
    `the working tree. Remove every conflict marker in: ${conflict.conflictedPaths.join(", ")}.\n\n` +
    `${a.taskId} was trying to: ${sideA.goal}\n` +
    `${a.taskId} counts as done when: ${sideA.successCondition}\n\n` +
    `${b.taskId} was trying to: ${sideB.goal}\n` +
    `${b.taskId} counts as done when: ${sideB.successCondition}\n\n` +
    `Both intents must survive. Where a block cannot satisfy both, it is a semantic conflict and belongs ` +
    `to a human: leave that block alone and stop, rather than choosing one side.`;

  const contract = {
    objective: {
      taskId: `reconcile-${slug(a.taskId)}-${slug(b.taskId)}`,
      goal,
      successCondition:
        `No file in ${conflict.conflictedPaths.join(", ")} contains a conflict marker, and both tasks' ` +
        `required checks pass.`,
      nonGoals: [
        "changing anything outside the conflicting blocks",
        "deciding a block that cannot satisfy both intents at once",
      ],
    },
    context: {
      // The copy, never the target repository: §4.2.1 lets orca move a real
      // person's HEAD exactly once, to check out W, and the reconciliation is
      // not that once.
      repoPath: conflict.copyPath,
      targetPaths: conflict.conflictedPaths,
      relevantDocs: [],
      buildTestCommands: plan.requiredChecks,
      constraints: [
        `The conflict is recorded in commit ${conflict.conflictCommit}, whose parents are ${conflict.wTip} ` +
          `(the work branch) and ${conflict.incomingRef} (the incoming task).`,
      ],
    },
    executionPolicy: {
      autonomyLevel: "L2",
      maxAttempts: 1,
      perAttemptTimeoutMs: Math.max(sideA.perAttemptTimeoutMs, sideB.perAttemptTimeoutMs),
      totalRuntimeBudgetMs: Math.max(sideA.totalRuntimeBudgetMs, sideB.totalRuntimeBudgetMs),
      tokenBudget: Math.max(sideA.tokenBudget, sideB.tokenBudget),
      worktreeRequired: true,
      partialOutcomeRecoveryWindowMs: 0,
    },
    safetyPolicy: {
      allowlistPaths: [],
      denylistPaths: [],
      maxFilesTouched: conflict.conflictedPaths.length,
      humanGateConditions: [],
    },
    verification: {
      verifierType: "command",
      // §5.1's third row: the union, not either side's own list. Half of it
      // would let a reconciliation that broke the other task's checks pass.
      requiredChecks: plan.requiredChecks,
      rejectOn: ["nonzero exit"],
      evidenceRequired: [],
    },
    escalationAndExit: {
      escalationTargets: [],
      pauseOn: [],
      stopOn: [],
      // The five names live in ccloopRunner.ts, which is the module that
      // has to recognise them coming back out of loop-state.json. A second
      // literal list here would be a copy that nothing keeps in step.
      terminalStates: [...TERMINAL_OUTCOMES],
    },
  };

  const path = join(runsDir, `contract-reconcile-${slug(a.taskId)}-${slug(b.taskId)}.json`);
  await writeFile(path, JSON.stringify(contract, null, 2));
  return { path };
}

/**
 * spec §5.2 step 5: the conflicted commit gets a ref of its own inside the
 * copy, and only inside the copy.
 *
 * Two reasons, both load-bearing. It is the temporary ref §5.4 tells the
 * escalation message to print, so a human sent to the copy has a name to check
 * out rather than a detached HEAD they must find in the reflog. And the
 * reconciliation runs in a CLONE of the copy: `git clone --local` copies the
 * whole object store, so the commit would survive anyway, but an unreferenced
 * commit is one `git gc` away from not surviving and nothing would say why.
 */
export function conflictRefOf(runId: string): string {
  return `refs/orca/conflict/${runId}`;
}

export async function pinConflictCommit(copy: string, runId: string, conflictCommit: string): Promise<string> {
  const ref = conflictRefOf(runId);
  await git(copy, ["update-ref", ref, conflictCommit]);
  return ref;
}

/**
 * The conflicted commit exists only so an agent can see the markers as text.
 * What lands on W has to be an ordinary merge commit with correct parents, so
 * it is rebuilt from the reconciled tree rather than reused. Attribution on W
 * stays clean, and the conflicted commit stays behind in the copy.
 */
export async function rebuildMergeCommit(
  copy: string, wTip: string, incomingRef: string, reconciledTree: string, message: string,
): Promise<string> {
  const incoming = (await git(copy, ["rev-parse", incomingRef])).trim();
  const sha = await git(copy, [
    ...ORCA_IDENTITY,
    "commit-tree", reconciledTree, "-p", wTip, "-p", incoming, "-m", message,
  ]);
  return sha.trim();
}

/**
 * spec §5.1's third row is verification by the union of both sides' required
 * checks, and ccloop runs those. This is the check ccloop CANNOT run: neither
 * task's `requiredChecks` was written to notice a conflict marker, so an agent
 * that "resolved" the conflict by committing the markers verbatim passes every
 * one of them. The synthesized contract's successCondition says in words that
 * no marker may remain; Rule 5 says a condition code can decide belongs to
 * code, not to the model that was asked to satisfy it.
 *
 * Read out of the reconciled COMMIT, not off disk: what lands on W is that
 * commit's tree, and a worktree can differ from it.
 *
 * A path missing from the tree is not a failure — deleting a conflicted file
 * is a legitimate resolution, and it certainly contains no markers.
 */
export async function markersRemaining(copy: string, commit: string, paths: string[]): Promise<string[]> {
  const remaining: string[] = [];
  for (const path of paths) {
    let content: string;
    try {
      content = await git(copy, ["show", `${commit}:${path}`]);
    } catch {
      continue;
    }
    if (content.split("\n").some((line) => line.startsWith(OURS_MARKER) || line.startsWith(THEIRS_MARKER))) {
      remaining.push(path);
    }
  }
  return remaining;
}

/**
 * The tree the copy's index currently describes.
 *
 * Separate from rebuildMergeCommit on purpose: §8.3's ordering is only
 * enforceable if the tree is written AFTER the ledger line has been staged,
 * and a rebuild that computed its own tree internally would have no seam for
 * `writeBoundThenCommit` to sit in.
 */
export async function writeTree(copy: string): Promise<string> {
  return (await git(copy, ["write-tree"])).trim();
}
