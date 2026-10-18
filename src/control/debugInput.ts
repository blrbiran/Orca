import { DECISION_NOT_FOUND } from "../corrections/originalDecision.js";
import { CorrectRejection } from "../corrections/rejection.js";
import type { Correction } from "../corrections/schema.js";
import { correctionTargetOf, type CorrectionTarget } from "../corrections/target.js";
import { decisionEventSchema, type DecisionEvent } from "../ledger/schema.js";
import { z } from "zod";
import { taskContractSchema } from "../scheduler/planFile.js";
import type { AgentSelection } from "./agentSelection.js";
import { readRun } from "./budget.js";
import { driveRecordSchema } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { gitChild } from "./integrationGit.js";
import { findDecision, ledgerSources, type DecisionWhere, type LedgerSource } from "./ledgerAtRef.js";
import { readPendingDecision } from "./pendingDecisions.js";
import { readArchivedPlan } from "./queries.js";
import type { PendingEntry } from "./runLedger.js";
import type { ControlStore } from "./store.js";

/**
 * Debug-task design §12.3 / plan Task 3: the evidence for one correction, read once from git and the control DB and
 * frozen as a plain JSON record. Later tasks (the goal text, the landing) read this record back; they never re-derive it.
 */
export const DEBUG_INPUT_SCHEMA = "orca-debug-input-v1";
export const DEBUG_DIFF_INLINE_MAX_BYTES = 65_536;
/** A pending target whose control-DB row is gone: nothing to debug. (A decision target uses DECISION_NOT_FOUND.) */
export const PENDING_DECISION_NOT_FOUND = "original-pending-decision-not-found";

type TaskContract = z.infer<typeof taskContractSchema>;

export interface DebugInputV1 {
  schema: typeof DEBUG_INPUT_SCHEMA;
  correction: Correction;
  decision: DecisionEvent | null;
  decisionWhere: DecisionWhere | null;
  pending: PendingEntry | null;
  originalRun: { runId: string; groupId: string; taskId: string; agent: AgentSelection; configHash: string } | null;
  commits: { base: string; attemptSha: string; diff: string } | null;
  contract: TaskContract | null;
  missing: Array<"run" | "base" | "attemptSha" | "objects" | "contract">;
}

/**
 * The one place the attempt's diff is spelled: git arguments (for the reader below) and the display form (for goal
 * text that names the command). `.decisions/` is excluded: the ledger is not the code under debate.
 */
export const DEBUG_DIFF_PATHSPEC = [".", ":(exclude).decisions"] as const;
export function debugDiffArgs(base: string, attemptSha: string): string[] {
  return ["diff", "--no-color", base, attemptSha, "--", ...DEBUG_DIFF_PATHSPEC];
}
export function debugDiffCommand(base: string, attemptSha: string): string {
  return `git diff --no-color ${base} ${attemptSha} -- . ':(exclude).decisions'`;
}

/**
 * The control run a target is about. A decision: its ledger run (`decisionId.split("/")[0]`), with a leading
 * `reconcile-` stripped (a reconcile decision is about the run it reconciled). A pending item: the row's control run.
 */
export function debugRunIdOf(target: CorrectionTarget): string {
  if (target.kind === "pending") return target.runId;
  return target.decisionId.split("/")[0]!.replace(/^reconcile-/, "");
}

const WORKING_TREE_ONLY: LedgerSource[] = [{ where: "working-tree", ref: null }];

async function objectExists(repo: string, sha: string): Promise<boolean> {
  return (await gitChild(repo, ["cat-file", "-e", `${sha}^{commit}`])).code === 0;
}

export async function collectDebugInput(deps: { store: ControlStore; repoPath: string }, correction: Correction): Promise<DebugInputV1> {
  const { store, repoPath } = deps;
  const target = correctionTargetOf(correction);
  const runId = debugRunIdOf(target);
  const missing: DebugInputV1["missing"] = [];

  let run: ReturnType<typeof readRun> | null = null;
  try { run = readRun(store, runId); }
  catch (error) { if (!(error instanceof ControlError && error.code === "run-not-found")) throw error; }
  const originalRun = run === null || run.taskId === null ? null
    : { runId, groupId: run.groupId, taskId: run.taskId, agent: run.agent, configHash: run.configHash };
  if (originalRun === null) missing.push("run");

  let decision: DecisionEvent | null = null;
  let decisionWhere: DecisionWhere | null = null;
  let pending: PendingEntry | null = null;
  if (target.kind === "decision") {
    // A scheduler-era run id has no control run, so only the working tree can hold its ledger.
    const sources = originalRun === null ? WORKING_TREE_ONLY : await ledgerSources(store, repoPath, originalRun.groupId);
    const hit = await findDecision(repoPath, sources, target.decisionId);
    if (hit === null) throw new CorrectRejection(DECISION_NOT_FOUND, `no decision with id ${JSON.stringify(target.decisionId)} in any ledger source`);
    decision = decisionEventSchema.parse(hit.value);
    decisionWhere = hit.where;
  } else {
    const row = readPendingDecision(store, target.pendingId);
    if (row === null) throw new CorrectRejection(PENDING_DECISION_NOT_FOUND, `no pending decision with id ${JSON.stringify(target.pendingId)}`);
    pending = row.entry;
  }

  let commits: DebugInputV1["commits"] = null;
  let contract: TaskContract | null = null;
  if (originalRun !== null && run !== null) {
    // The drive record rides in the run body (driveRecord.ts); RunRecord does not type it.
    const drive = (run as { drive?: Partial<Record<"base" | "attemptSha", unknown>> }).drive;
    const base = driveRecordSchema.shape.base.safeParse(drive?.base);
    const attempt = driveRecordSchema.shape.attemptSha.safeParse(drive?.attemptSha);
    const baseSha = base.success ? base.data : null;
    const attemptSha = attempt.success ? attempt.data : null;
    if (baseSha === null) missing.push("base");
    if (attemptSha === null) missing.push("attemptSha");
    if (baseSha !== null && attemptSha !== null) {
      if (await objectExists(repoPath, baseSha) && await objectExists(repoPath, attemptSha)) {
        const diff = await gitChild(repoPath, debugDiffArgs(baseSha, attemptSha));
        if (diff.code !== 0) throw new Error(`git diff ${baseSha}..${attemptSha} failed: ${diff.stderr.trim()}`);
        commits = { base: baseSha, attemptSha, diff: diff.stdout };
      } else missing.push("objects");
    }
    try {
      const task = readArchivedPlan(store, originalRun.groupId).plan.tasks.find((candidate) => candidate.taskId === originalRun.taskId);
      if (task === undefined) missing.push("contract");
      else contract = taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson));
    } catch { missing.push("contract"); }
  }

  return { schema: DEBUG_INPUT_SCHEMA, correction, decision, decisionWhere, pending, originalRun, commits, contract, missing };
}
