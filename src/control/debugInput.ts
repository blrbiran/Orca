import { z } from "zod";
import { DECISION_NOT_FOUND } from "../corrections/originalDecision.js";
import { CorrectRejection } from "../corrections/rejection.js";
import type { Correction } from "../corrections/schema.js";
import { correctionTargetOf, type CorrectionTarget } from "../corrections/target.js";
import { decisionEventSchema, type DecisionEvent } from "../ledger/schema.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import type { AgentSelection } from "./agentSelection.js";
import { readRun } from "./budget.js";
import { driveRecordSchema } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { gitChild } from "./integrationGit.js";
import { findDecision, ledgerSources, readLedgerAtRef, type DecisionWhere, type LedgerSource } from "./ledgerAtRef.js";
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

/**
 * Flow engine spec §13.2 (W-COR): the window a repository-only correction's debug agent may look in -- the smaller of the
 * last `groups` landed groups and the last `days` days before the correction (writer's call, plan defaults). Code
 * bounds it; the model only locates within it (Rule 5, P7).
 */
export const REPO_CORRECTION_WINDOW = Object.freeze({ groups: 10, days: 14 });
const DAY_MS = 86_400_000;

/** A reported decision as the window and a bare run carry it: its id, question and choice (from the landed ledger). */
export interface ReportedDecisionBrief { id: string; question: string; chose: string }

export interface DebugWindowGroup {
  groupId: string;
  /** The group's goal (a requirement's split group carries the requirement as its goal). */
  title: string;
  /** The newest landing commit's committer time, ISO. */
  landedAt: string;
  ranges: Array<{ runId: string; base: string; landedCommit: string }>;
  decisions: ReportedDecisionBrief[];
}

export interface DebugWindow {
  /** The correction's `at`: the window is what had landed when the person spoke. */
  asOf: string;
  maxGroups: number;
  maxDays: number;
  /** Newest landing first. */
  groups: DebugWindowGroup[];
  /** The ranges' diffs (without .decisions/), cut at DEBUG_DIFF_INLINE_MAX_BYTES; the cut is recorded. */
  diff: { text: string; totalBytes: number; keptBytes: number };
}

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
  /**
   * Flow engine spec §13.3: a bare-run target's reported decisions. Present only for that target, so every existing
   * frozen input (and its canonical hash) is byte-identical.
   */
  runDecisions?: ReportedDecisionBrief[];
  /** Flow engine spec §13.2: a repository-only target's window. Present only for that target, as above. */
  window?: DebugWindow;
}

/**
 * The one place the attempt's diff is spelled: git arguments (for the reader below) and the display form (for goal
 * text that names the command). `.decisions/` is excluded: the ledger is not the code under debate.
 */
const DEBUG_DIFF_PATHSPEC = [".", ":(exclude).decisions"] as const;
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
export function debugRunIdOf(target: CorrectionTarget): string | null {
  if (target.kind === "pending" || target.kind === "run") return target.runId;
  // Flow engine spec §13.2: a repository-only correction is about no one run.
  if (target.kind === "repository") return null;
  return ledgerRunOf(target.decisionId);
}

const ledgerRunOf = (decisionId: string): string => decisionId.split("/")[0]!.replace(/^reconcile-/, "");

/** The decision rows of `runId`'s ledger files at `commit` (its own and its reconcile's), as briefs; unreadable is none. */
async function runDecisionsAt(repo: string, commit: string, runId: string): Promise<ReportedDecisionBrief[]> {
  const lines = (await readLedgerAtRef(repo, commit)) ?? [];
  return lines.flatMap(({ value }) => {
    const row = value as { ev?: unknown; id?: unknown; question?: unknown; chose?: unknown } | null;
    if (row === null || typeof row !== "object" || row.ev !== "decision" || typeof row.id !== "string") return [];
    if (typeof row.question !== "string" || typeof row.chose !== "string" || ledgerRunOf(row.id) !== runId) return [];
    return [{ id: row.id, question: row.question, chose: row.chose }];
  });
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8 and ends on a character boundary. */
function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // A continuation byte (10xxxxxx) at the cut means the character straddles it: cut before its lead byte.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

const stringOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * Flow engine spec §13.2: the landed groups of repository `repoId`, newest landing first, within the window before
 * `asOf`. A group is landed when one of its runs recorded a landed commit; its time is that commit's committer time
 * (the drive record keeps no clock). A commit no longer in the repository cannot be placed in time and is left out.
 */
async function collectWindow(store: ControlStore, repo: string, repoId: string, asOf: string, bounds: { groups: number; days: number }): Promise<DebugWindow> {
  const asOfMs = Date.parse(asOf);
  const groups: DebugWindowGroup[] = [];
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
    const body = JSON.parse(String(row.body)) as { plan?: { repoId?: unknown }; goal?: unknown };
    if (body.plan?.repoId !== repoId) continue;
    const ranges: DebugWindowGroup["ranges"] = [];
    let newest = -Infinity;
    for (const run of store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY id").all(String(row.id))) {
      const drive = (JSON.parse(String(run.body)) as { drive?: { base?: unknown; landedCommit?: unknown } }).drive;
      const base = stringOf(drive?.base), landedCommit = stringOf(drive?.landedCommit);
      if (base === null || landedCommit === null) continue;
      const shown = await gitChild(repo, ["show", "-s", "--format=%ct", `${landedCommit}^{commit}`]);
      if (shown.code !== 0) continue;
      const atMs = Number(shown.stdout.trim()) * 1000;
      if (!(atMs <= asOfMs && atMs >= asOfMs - bounds.days * DAY_MS)) continue;
      ranges.push({ runId: String(run.id), base, landedCommit });
      newest = Math.max(newest, atMs);
    }
    if (ranges.length === 0) continue;
    const decisions: ReportedDecisionBrief[] = [];
    for (const range of ranges) decisions.push(...await runDecisionsAt(repo, range.landedCommit, range.runId));
    groups.push({ groupId: String(row.id), title: typeof body.goal === "string" ? body.goal : String(row.id), landedAt: new Date(newest).toISOString(), ranges, decisions });
  }
  groups.sort((left, right) => (left.landedAt === right.landedAt ? (left.groupId < right.groupId ? -1 : 1) : left.landedAt < right.landedAt ? 1 : -1));
  const kept = groups.slice(0, bounds.groups);
  let whole = "";
  for (const group of kept) {
    for (const range of group.ranges) {
      const diff = await gitChild(repo, debugDiffArgs(range.base, range.landedCommit));
      if (diff.code !== 0) throw new Error(`git diff ${range.base}..${range.landedCommit} failed: ${diff.stderr.trim()}`);
      whole += `# group ${group.groupId}, run ${range.runId}: ${range.base}..${range.landedCommit}\n${diff.stdout}`;
    }
  }
  const text = utf8Prefix(whole, DEBUG_DIFF_INLINE_MAX_BYTES);
  return {
    asOf, maxGroups: bounds.groups, maxDays: bounds.days, groups: kept,
    diff: { text, totalBytes: Buffer.byteLength(whole, "utf8"), keptBytes: Buffer.byteLength(text, "utf8") },
  };
}

const WORKING_TREE_ONLY: LedgerSource[] = [{ where: "working-tree", ref: null }];

async function objectExists(repo: string, sha: string): Promise<boolean> {
  return (await gitChild(repo, ["cat-file", "-e", `${sha}^{commit}`])).code === 0;
}

export async function collectDebugInput(
  deps: { store: ControlStore; repoPath: string; repoId?: string; window?: { groups: number; days: number } },
  correction: Correction,
): Promise<DebugInputV1> {
  const { store, repoPath } = deps;
  const target = correctionTargetOf(correction);
  if (target.kind === "repository") {
    // Flow engine spec §13.2: no run, no decision; the sentence and the bounded window of the project's landed groups.
    if (deps.repoId === undefined) throw new Error("collectDebugInput: a repository-only correction needs the repository's repoId");
    const window = await collectWindow(store, repoPath, deps.repoId, correction.at, deps.window ?? REPO_CORRECTION_WINDOW);
    return { schema: DEBUG_INPUT_SCHEMA, correction, decision: null, decisionWhere: null, pending: null, originalRun: null, commits: null, contract: null, missing: [], window };
  }
  const runId = debugRunIdOf(target)!;
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
  } else if (target.kind === "pending") {
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
    } catch (error) {
      // Only an unreadable archived plan or contract means "no contract"; any other failure is a real error.
      const unreadable = error instanceof SyntaxError || error instanceof z.ZodError
        || (error instanceof ControlError && error.code === "recovery-blocked");
      if (!unreadable) throw error;
      missing.push("contract");
    }
  }

  const frozen: DebugInputV1 = { schema: DEBUG_INPUT_SCHEMA, correction, decision, decisionWhere, pending, originalRun, commits, contract, missing };
  if (target.kind === "run") {
    // Flow engine spec §13.3: the run's reported decisions, from its ledger at the attempt (where the run wrote them).
    frozen.runDecisions = commits === null ? [] : await runDecisionsAt(repoPath, commits.attemptSha, runId);
  }
  return frozen;
}
