import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/**
 * spec §7.3's second tier, the decision `disposition` (harvest.ts) judges but
 * never writes down — Task 9 deferred it here on purpose, because writing a
 * decision is ledger wiring, not a harvesting concern.
 *
 * The choice this records is narrow and already made by the time this
 * function is called: the money is spent, nobody else's declared write set
 * claims the out-of-bounds paths, so there is no "un-write" to roll back to
 * and discarding the work would be pure waste. Landing it anyway is §0.2's
 * trade made explicit — a narrow declaration is common and mostly harmless,
 * right up until it collides, and this one didn't.
 *
 * scope is "task", not "repo": unlike a landing-order or reconcile decision,
 * this is entirely about ONE task's own write set versus its own declaration.
 * Nothing else on the branch is implicated.
 */
export function boundaryDecision(
  roundId: string,
  seq: number,
  taskId: string,
  outOfBounds: string[],
  workBranch: string,
  beforeSha: string,
  at: string,
): DecisionEvent {
  return {
    ev: "decision",
    id: `${roundId}/${seq}`,
    at,
    run: roundId,
    question:
      `${taskId} wrote outside its declared write set on ${outOfBounds.join(", ")}, and no sibling task in ` +
      `its layer claims any of those paths`,
    chose: `land it on ${workBranch} anyway, with this decision recording the boundary violation`,
    alternatives: [
      {
        option: "discard the work and count the task as failed (spec §7.3 tier 1's other option)",
        why_not:
          "the ccloop run already spent real time and money producing this result, and there is no " +
          "sibling whose work it could have silently broken (that case is tier 0's escalation, not this " +
          "one) — discarding it would be pure waste for no safety gained",
      },
    ],
    because:
      "spec §7.3's second tier: an out-of-bounds write that intersects nobody else's declared claims " +
      "cannot have broken a same-layer sibling by construction, so refusing it would only be enforcing " +
      "the declaration for its own sake. §0.2 registers this as the accepted cost of write sets that are " +
      "usually written wide: narrow declarations are common, and only dangerous when they collide",
    undo: {
      how: `git reset --hard ${beforeSha}`,
      cost: `discard ${taskId}'s landing (and this decision) from ${workBranch} and decide by hand whether the out-of-bounds write is acceptable`,
      // beforeSha is W's tip right before taskId's OWN landing attempt, but
      // this decision is committed only after the whole layer has landed
      // (run.ts's own comment on why) — so resetting to it also discards
      // whatever OTHER same-layer task landed after taskId, not just this
      // one commit. Registered here rather than hidden: a narrower undo would
      // need this task's own merge sha, which run.ts does not currently
      // capture (landIntoW reports success, not the sha it produced).
      blast_radius: `everything ${workBranch} gained from ${taskId}'s own landing onward, including any other task in this layer that landed after it`,
    },
    scope: "task",
    kind: "boundary",
  };
}

/** One side's declared intent, read defensively for an escalation file — a
 * contract that failed to synthesize a reconciliation from is exactly the
 * shape most likely to be missing one of these fields, and the escalation
 * still has to be written when that happens. */
export interface EscalationSide {
  taskId: string;
  goal: string;
  successCondition: string;
}

/**
 * Best-effort read of a task's own intent for an escalation file. Contracts
 * arrive here as opaque JSON that nothing in this codebase has validated
 * (same posture as writeSetOf and reconcile.ts's intentOf) — a missing or
 * malformed field becomes a visible placeholder in the file rather than a
 * thrown error, because failing to WRITE the escalation over a cosmetic gap
 * in one side's contract would be strictly worse than the gap itself.
 */
export function intentOfContract(contracts: Map<string, unknown>, taskId: string): EscalationSide {
  const c = contracts.get(taskId) as
    | { objective?: { goal?: unknown; successCondition?: unknown } }
    | null
    | undefined;
  const goal = typeof c?.objective?.goal === "string" && c.objective.goal.trim() !== "" ? c.objective.goal : "(no goal declared)";
  const successCondition =
    typeof c?.objective?.successCondition === "string" && c.objective.successCondition.trim() !== ""
      ? c.objective.successCondition
      : "(no successCondition declared)";
  return { taskId, goal, successCondition };
}

/** Everything an escalation file (spec §5.4) needs to be written from. */
export interface EscalationFacts {
  /** Names the file: `<runsDir>/escalations/<runId>.md`. */
  runId: string;
  /** Why a human has to look, in the caller's own words — already computed
   * from the refusal/failure this escalation is about. */
  reason: string;
  /** Both sides' intent when both are known; one, or none, when they are not
   * (spec §5.4 asks for "both sides'", but an escalation over an unhandled
   * exception or an unidentifiable other side has no second side to give). */
  sides: EscalationSide[];
  /** The conflicted paths or blocks this escalation is about, when there are
   * any — empty for an escalation that is not about a merge conflict at all
   * (the exception path). */
  conflictBlocks: string[];
  undoHow: string;
  undoCost: string;
  undoBlastRadius: string;
}

/**
 * spec §5.4's path, and nowhere else: NOT on W, because W is a code branch
 * and this is a process file for a human to read, not a decision to bind a
 * commit to.
 */
export function escalationFilePath(runsDir: string, runId: string): string {
  return join(runsDir, "escalations", `${runId}.md`);
}

/**
 * spec §5.4, the whole of it: when the round stops at a merge point and a
 * human has to come back, this is the file they are pointed at (`orca run`
 * prints its path, spec §5.4 / §6.3) — both sides' intent, the conflict
 * blocks, and an executable `undo.how`, none of which the ledger itself can
 * carry: this is a plain markdown file, not a `decision` event, because
 * nothing about "a human needs to look at this" is itself a decision, and
 * because it belongs outside the target repository (runsDir), which a
 * `.decisions/*.jsonl` line committed onto W cannot be.
 *
 * `undo.how` is checked against the SAME predicate the ledger validator uses
 * (`undoHowIsExecutable`) even though this file is never validated by it —
 * the predicate is the one place "executable" is defined in this codebase,
 * and a second, looser definition here would be exactly the kind of drift
 * spec §0.1 forbids. The three call sites in run.ts each build a form the
 * predicate is measured to accept (`rm -rf <absolute path>` — a command
 * shape, `rm` plus an argument containing "/").
 */
export async function writeEscalationFile(runsDir: string, facts: EscalationFacts): Promise<string> {
  const path = escalationFilePath(runsDir, facts.runId);
  await mkdir(dirname(path), { recursive: true });
  const lines = [
    `# orca escalation: ${facts.runId}`,
    "",
    "A human has to look at this before the round can be trusted again.",
    "",
    "## Why",
    "",
    facts.reason,
    "",
    "## What each side intended",
    "",
    ...(facts.sides.length > 0
      ? facts.sides.map((side) => `- **${side.taskId}**: ${side.goal} (counts as done when: ${side.successCondition})`)
      : ["(no side's declared intent is known for this escalation)"]),
    "",
    "## Conflict blocks",
    "",
    ...(facts.conflictBlocks.length > 0
      ? facts.conflictBlocks.map((block) => `- ${block}`)
      : ["(none — this escalation is not about a merge conflict)"]),
    "",
    "## undo",
    "",
    `- how: \`${facts.undoHow}\``,
    `- cost: ${facts.undoCost}`,
    `- blast_radius: ${facts.undoBlastRadius}`,
    "",
  ];
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

/**
 * Walks up from ccloop's bin path to find the repository it was built from —
 * the directory holding both its `package.json` and its `.git`. Not hard-coded
 * as "two directories up from dist/cli.js": that is true of ccloop's layout
 * today (package.json's own `bin` field, "dist/cli.js") but is not this
 * module's fact to assume, and ORCA_CCLOOP_BIN (sandbox.ts's escape hatch) is
 * free to point anywhere on disk.
 */
async function findCcloopRoot(ccloopBin: string): Promise<string> {
  let dir = dirname(ccloopBin);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`orca: cannot find ccloop's repository root walking up from ${ccloopBin}`);
}

/**
 * spec §9.1's evidence requirement, and the answer to a locked-version
 * dependency ccloop cannot satisfy today: its `package.json` is `private:
 * true` and its `bin` points at a gitignored, unbuilt `dist/`, so it can never
 * be an npm dependency with a lockfile entry. Recording which ccloop this
 * round actually ran on — its HEAD sha and declared version — is what locking
 * a version was FOR: reproducing a round means checking out this exact
 * commit of ccloop, not "whatever was on disk that day".
 *
 * Returned as a single-element array (DecisionEvent's `evidence` field is
 * `string[]`) rather than two, so a reader sees version and sha together
 * rather than having to remember which array index means which.
 */
export async function ccloopEvidence(ccloopBin: string): Promise<string[]> {
  const root = await findCcloopRoot(ccloopBin);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: unknown };
  const version = typeof pkg.version === "string" ? pkg.version : "unknown";
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  return [`ccloop ${version} @ ${head}`];
}
