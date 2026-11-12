import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import { frozenWorkAgent } from "./agentFreeze.js";
import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { chainRounds } from "./clarifyChain.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { readConfirmedReconcileSlot } from "./executionSnapshot.js";
import { acceptanceCommands } from "./groupAcceptance.js";
import { acceptanceOf, acceptanceSatisfied } from "./groupAcceptanceRecord.js";
import { appendConfirmedTaskInTransaction } from "./groupTaskAppend.js";
import { readArchivedContract, readArchivedPlan } from "./queries.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, completeGroupSingleCallInTransaction, readGroupCallContract } from "./groupSingleCall.js";
import { isMultiGroup } from "./multiGroup.js";
import { cutUtf8 } from "./noChange.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readWork } from "./queries.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { readRounds } from "./requirementRecords.js";
import { reviewOf, reviewRequired, type CriterionVerdict, type RequirementReview, type ReviewRound, type ReviewRoundResult, type ReviewWhy } from "./requirementReviewRecord.js";
import type { SingleCallHandler, SingleCallRunRow } from "./singleCallPurposes.js";
import { QUIET_GIT, revParse, workBranchRef } from "./workspace.js";
import { isDirFlowGroup } from "../flow/groups.js";
import { git } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { FrozenSlot } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/**
 * Tester follow-up G spec §3 (human: 「没有统一标准，一般会对照需求看具体实现的结果（这个结果可以是代码、文档、图片等等）」, the
 * playback 「同意」): after every task of a requirement group is done and the group acceptance passed on its tip, one
 * independent single call compares what the group changed with the requirement's acceptance criteria. Each criterion is
 * `met` / `not-met` / `cannot-judge` with evidence; the answer is classified by code (Rule 5). The group is done only when
 * the review passed (or a person or orchestrating agent accepted it); a not-met round opens a fix task in the same group
 * (Task 9); cannot-judge, an invalid answer, a failed or unfunded call stop the group in Problems.
 */
export const REQUIREMENT_REVIEW_GRANT: Readonly<Amount> = Object.freeze({ tokens: 600_000, activeMs: 1_800_000, attempts: 1, sessions: 1 });
export const REVIEW_FLOOR_TOKENS = 50_000;
export const REVIEW_MAX_OUTPUT_TOKENS = 16_000;
/** The diff in the prompt is cut at this many bytes, with a stated truncation line (Review Focus 4). */
export const REVIEW_DIFF_MAX_BYTES = 200_000;
export const REQUIREMENT_REVIEW_USAGE_UNKNOWN = "requirement-review-usage-unknown";
export const MAX_AUTO_FIX_ROUNDS = 2;

export const requirementReviewResponseSchema: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object", additionalProperties: false, required: ["criteria", "summary"],
  properties: {
    criteria: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "verdict", "evidence", "missing"],
      properties: { id: { type: "string" }, verdict: { type: "string", enum: ["met", "not-met", "cannot-judge"] },
        evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "line"], properties: { path: { type: "string" }, line: { type: ["integer", "null"] } } } },
        missing: { type: ["string", "null"] } } } },
    summary: { type: "string" },
  },
});
const outputSchema = z.object({
  criteria: z.array(z.object({ id: z.string().min(1), verdict: z.enum(["met", "not-met", "cannot-judge"]),
    evidence: z.array(z.object({ path: z.string().min(1), line: z.number().int().nonnegative().nullable() }).strict()), missing: z.string().nullable() }).strict()),
  summary: z.string(),
}).strict();

/**
 * Code, not the model: invalid when the ids are not exactly the consensus criteria (missing, extra, repeated), a `met` or
 * `not-met` names no evidence, or a `not-met` says nothing is missing. Any cannot-judge makes the round cannot-judge (§3.5).
 */
export function classifyReviewOutput(raw: unknown, criterionIds: readonly string[]): { result: "passed" | "not-met" | "cannot-judge"; criteria: CriterionVerdict[]; summary: string } | { result: "invalid"; reason: string } {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) return { result: "invalid", reason: `schema:${parsed.error.issues[0]?.path.join(".") ?? ""}` };
  const ids = parsed.data.criteria.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return { result: "invalid", reason: "criterion-repeated" };
  const missing = criterionIds.find((id) => !ids.includes(id));
  if (missing !== undefined) return { result: "invalid", reason: `criterion-missing:${missing}` };
  const extra = ids.find((id) => !criterionIds.includes(id));
  if (extra !== undefined) return { result: "invalid", reason: `criterion-unknown:${extra}` };
  for (const c of parsed.data.criteria) {
    if (c.verdict !== "cannot-judge" && c.evidence.length === 0) return { result: "invalid", reason: `evidence-missing:${c.id}` };
    if (c.verdict === "not-met" && (c.missing === null || c.missing.trim() === "")) return { result: "invalid", reason: `missing-unsaid:${c.id}` };
  }
  const criteria = criterionIds.map((id) => parsed.data.criteria.find((c) => c.id === id)!);
  const result = criteria.some((c) => c.verdict === "cannot-judge") ? "cannot-judge" : criteria.some((c) => c.verdict === "not-met") ? "not-met" : "passed";
  return { result, criteria, summary: parsed.data.summary };
}

export interface ChangedFile { path: string; status: string; bytes: number; sha256: string; binary: boolean }
export function buildReviewPrompt(input: { idea: string; statement: string; criteria: ReadonlyArray<{ id: string; text: string }>; openBranches: readonly string[];
  changedFiles: readonly ChangedFile[]; diff: string; truncated: boolean; note?: string }): string {
  return [
    "You are Orca's requirement reviewer. A group of tasks implemented the requirement below; its tasks' checks passed on the result.",
    "Compare what the group changed with each acceptance criterion and answer for every criterion, by its id.",
    "",
    `Requirement (as first said): ${input.idea}`,
    `Agreed statement: ${input.statement}`,
    ...(input.openBranches.length === 0 ? [] : [`Left open on purpose (not part of this requirement): ${input.openBranches.join("; ")}`]),
    "Acceptance criteria:",
    ...input.criteria.map((c) => `- ${c.id}: ${c.text}`),
    ...(input.note === undefined ? [] : ["", `A person or agent asked this review to look at: ${input.note}`]),
    "",
    "Files the group changed (status, path, bytes, sha256):",
    ...input.changedFiles.map((f) => `- ${f.status} ${f.path} ${f.bytes} ${f.sha256}${f.binary ? " (binary: named only, its bytes are not shown)" : ""}`),
    "",
    "The group's diff against its base:",
    input.diff,
    ...(input.truncated ? [`(The diff was cut at ${REVIEW_DIFF_MAX_BYTES} bytes; what follows was not shown to you.)`] : []),
    "",
    "Answer with a JSON object {\"criteria\": [{\"id\", \"verdict\", \"evidence\", \"missing\"}], \"summary\"}.",
    "- verdict met: name the evidence (file path and line, or the artefact path). missing is null.",
    "- verdict not-met: name the evidence you looked at and say in `missing` what is still needed.",
    "- verdict cannot-judge: when what is shown is not enough (for example a criterion that hinges on a binary file you cannot see).",
    "Every criterion id above must appear exactly once.",
  ].join("\n");
}

/** §3.2: the requirement's words and its acceptance criteria -- the newest round of the clarification chain that has a result. */
export function reviewInputsOf(store: ControlStore, groupId: string, body: unknown): { idea: string; statement: string; criteria: Array<{ id: string; text: string }>; openBranches: string[] } {
  const requirement = (body as { requirement?: { idea?: unknown; consensus?: { openBranches?: unknown } | null } }).requirement;
  const latest = chainRounds(readRounds(store, groupId)).filter((round) => round.result !== null).at(-1)?.result ?? null;
  if (latest === null || latest.acceptanceCriteria.length === 0) throw new ControlError("recovery-blocked", "requirement-review-criteria-missing");
  const openBranches = Array.isArray(requirement?.consensus?.openBranches) ? requirement!.consensus!.openBranches as string[] : latest.openBranches;
  return { idea: typeof requirement?.idea === "string" ? requirement.idea : latest.statement, statement: latest.statement, criteria: latest.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text })), openBranches };
}

/** The base the group's first work run started from (rowid order): what the review diffs against. */
export function groupBaseCommit(store: ControlStore, groupId: string): string {
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: string; drive?: { base?: unknown } };
    if (run.phase === "work" && typeof run.drive?.base === "string") return run.drive.base;
  }
  throw new ControlError("recovery-blocked", "requirement-review-base-missing");
}

export function saveReview(store: ControlStore, groupId: string, review: RequirementReview): void {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  body.requirementReview = review;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
  recordProjectionChange(store, [groupId]);
}

const workItemOf = (roundNo: number): string => `requirement-review-r${roundNo}`;
const tasksDone = (store: ControlStore, groupId: string): boolean => {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  return tasks.length > 0 && tasks.every((work) => work.status === "done") && store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1").get(groupId) === undefined;
};

/** The reviewer: the group's reconcile slot, else its first task's worker slot; the profile its first work run used. */
function reviewerOf(store: ControlStore, groupId: string): { slot: FrozenSlot; profile: { profileId: string; profileHash: string } } {
  let slot: FrozenSlot;
  try { slot = readConfirmedReconcileSlot(store, groupId); } catch {
    const first = store.db.prepare("SELECT id FROM work_items WHERE group_id=? ORDER BY rowid LIMIT 1").get(groupId);
    const agent = frozenWorkAgent(readWork(store, groupId, String(first!.id)));
    slot = { selection: agent.agent, configHash: agent.configHash, timeoutMs: agent.timeoutMs, killGraceMs: agent.killGraceMs, capabilities: agent.agentCapabilities, partial: {}, provenance: agent.agentProvenance } as never;
  }
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: string; executionProfile?: { profileId?: unknown; profileHash?: unknown } };
    if (run.phase === "work" && typeof run.executionProfile?.profileId === "string" && typeof run.executionProfile.profileHash === "string") {
      return { slot, profile: { profileId: run.executionProfile.profileId, profileHash: run.executionProfile.profileHash } };
    }
  }
  throw new ControlError("recovery-blocked", "requirement-review-profile");
}

/** Whether a new round is due: none yet; a re-run was asked; or the last round's fix task is done. */
function roundDue(store: ControlStore, groupId: string, review: RequirementReview | null): boolean {
  if (review === null || review.state === "pending") return true;
  if (review.state !== "fixing") return false;
  const fix = review.rounds.at(-1)?.fixTaskId;
  if (fix === undefined) return false;
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, fix);
  return row !== undefined && (JSON.parse(String(row.body)) as { status?: string }).status === "done";
}

export interface ReviewPassDeps { store: ControlStore; resolveRepository(repoId: string): string; admissionGate?: AdmissionGate; write<T>(action: () => T): T }

/** One round of the review pass (the driver, after the acceptance pass); answers whether anything was recorded. */
export async function reviewRequirements(deps: ReviewPassDeps): Promise<boolean> {
  const { store } = deps;
  let moved = false;
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    try {
      if (body.planHash === undefined || !reviewRequired(store, groupId, body) || isGroupArchived(store, groupId)) continue;
      if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined || !tasksDone(store, groupId)) continue;
      if (!acceptanceSatisfied(store, groupId, body)) continue;
      const review = reviewOf(body);
      if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) {
        if (review?.state === "not-run") continue;
        deps.write(() => saveReview(store, groupId, { state: "not-run", why: isMultiGroup(store, groupId) ? "multi-repo" : "dir", rounds: [], autoFixRounds: 0 }));
        moved = true;
        continue;
      }
      if (!roundDue(store, groupId, review)) continue;
      const tip = await revParse(deps.resolveRepository(groupRepoId(store, groupId)), workBranchRef(groupId));
      // A fix task moved the tip: wait for the acceptance pass to check the new tip before reviewing it.
      const accepted = acceptanceOf(body);
      if (accepted !== null && accepted.tip !== null && accepted.tip !== tip) continue;
      deps.write(() => {
        const current = reviewOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body))) ?? { state: "pending" as const, rounds: [], autoFixRounds: 0 };
        const roundNo = current.rounds.length + 1, at = store.now();
        const funded = boundedGroupGrant(store, groupId, { ...REQUIREMENT_REVIEW_GRANT }, REVIEW_FLOOR_TOKENS, at);
        if ("unfunded" in funded) {
          const round: ReviewRound = { roundNo, tip, runId: null, at, result: "unfunded", criteria: [], summary: `the group cannot fund the review (${funded.unfunded})` };
          saveReview(store, groupId, { ...current, state: "not-passed", why: "unfunded", rounds: [...current.rounds, round] });
          recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "unfunded", tip } });
          return;
        }
        const reviewer = reviewerOf(store, groupId);
        claimGroupSingleCallInTransaction(store, { groupId, workItemId: workItemOf(roundNo), purpose: "requirement-review",
          identity: { requirementReview: { roundNo, tip } }, slot: reviewer.slot, profile: reviewer.profile, grant: funded.grant,
          contract: { schema: "orca-requirement-review-contract-v1", roundNo, tip, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS, ...(current.rerun === undefined ? {} : { note: current.rerun.note }) } });
        const { why: _why, ...open } = current;
        saveReview(store, groupId, { ...open, state: "reviewing" });
      });
      moved = true;
    } catch (error) {
      process.stderr.write(`orca-driver: group ${groupId}: requirement review: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return moved;
}

const reviewIdentity = (run: SingleCallRunRow): { roundNo: number; tip: string } => {
  const r = run.requirementReview as { roundNo?: unknown; tip?: unknown } | undefined;
  if (typeof r?.roundNo !== "number" || typeof r.tip !== "string") throw new ControlError("recovery-blocked", "requirement-review-identity");
  return { roundNo: r.roundNo, tip: r.tip };
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** §3.2 bounded: the changed files (binary ones named by path, bytes and sha256) and the text diff cut at the bound. */
async function groupChanges(repo: string, base: string, tip: string): Promise<{ changedFiles: ChangedFile[]; diff: string; truncated: boolean }> {
  const numstat = (await git(repo, [...QUIET_GIT, "diff", "--numstat", "-z", "--no-renames", `${base}..${tip}`])).split("\0").filter((s) => s.length > 0);
  const status = new Map((await git(repo, [...QUIET_GIT, "diff", "--name-status", "--no-renames", `${base}..${tip}`])).split("\n").filter((l) => l.length > 0)
    .map((line) => { const [s, ...p] = line.split("\t"); return [p.join("\t"), s!] as const; }));
  const changedFiles: ChangedFile[] = [];
  for (const entry of numstat) {
    const [added, , ...rest] = entry.split("\t");
    const path = rest.join("\t"), st = status.get(path) ?? "M", binary = added === "-";
    if (st === "D") { changedFiles.push({ path, status: st, bytes: 0, sha256: "-", binary }); continue; }
    const content = execFileSync("git", [...QUIET_GIT, "cat-file", "blob", `${tip}:${path}`], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
    changedFiles.push({ path, status: st, bytes: content.length, sha256: sha256(content), binary });
  }
  const full = await git(repo, [...QUIET_GIT, "diff", "--no-color", "--no-renames", `${base}..${tip}`]);
  const truncated = Buffer.byteLength(full, "utf8") > REVIEW_DIFF_MAX_BYTES;
  return { changedFiles, diff: truncated ? cutUtf8(full, REVIEW_DIFF_MAX_BYTES) : full, truncated };
}

interface ReviewSettled { classified: ReturnType<typeof classifyReviewOutput> | null; failure: string | null }

export const REQUIREMENT_REVIEW_HANDLER: SingleCallHandler = {
  purpose: "requirement-review",
  async prepare(deps, run) {
    const { tip } = reviewIdentity(run);
    const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(run.groupId)!.body));
    const inputs = reviewInputsOf(deps.store, run.groupId, body);
    const contract = readGroupCallContract(deps.store, run.groupId, run.workItemId);
    const repo = deps.resolveRepository(groupRepoId(deps.store, run.groupId));
    const changes = await groupChanges(repo, groupBaseCommit(deps.store, run.groupId), tip);
    return {
      prompt: buildReviewPrompt({ ...inputs, ...changes, ...(typeof contract?.note === "string" ? { note: contract.note } : {}) }),
      responseSchema: { ...requirementReviewResponseSchema }, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    };
  },
  async evaluate(deps, run, rawOutput, failure = null) {
    if (failure !== null) return { classified: null, failure } satisfies ReviewSettled;
    const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(run.groupId)!.body));
    return { classified: classifyReviewOutput(rawOutput, reviewInputsOf(deps.store, run.groupId, body).criteria.map((c) => c.id)), failure: null } satisfies ReviewSettled;
  },
  classify: classifyReviewOutput,
  complete(deps, runRow, settled, commitTerminal, failure = null) {
    const release = deps.admissionGate?.enter();
    try { deps.store.transaction(() => REQUIREMENT_REVIEW_HANDLER.completeInTransaction!(deps.store, runRow, settled, commitTerminal, failure)); }
    finally { release?.(); }
  },
  completeInTransaction(store, runRow, settled, commitTerminal, failure = null) {
    const { roundNo, tip } = reviewIdentity(runRow);
    const contract = readGroupCallContract(store, runRow.groupId, runRow.workItemId);
    const grant = (contract?.grant as { work?: Amount } | undefined)?.work;
    if (grant === undefined) throw new ControlError("recovery-blocked", "requirement-review-contract");
    if (completeGroupSingleCallInTransaction(store, runRow, grant, commitTerminal, REQUIREMENT_REVIEW_USAGE_UNKNOWN) === null) return;
    const answer = (settled as ReviewSettled | null)?.classified ?? null;
    const failed = failure ?? (settled as ReviewSettled | null)?.failure ?? null;
    const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(runRow.groupId)!.body));
    const current = reviewOf(body) ?? { state: "reviewing" as const, rounds: [], autoFixRounds: 0 };
    const result: ReviewRoundResult = failed !== null || answer === null ? "failed" : answer.result;
    const round: ReviewRound = { roundNo, tip, runId: runRow.runId, at: store.now(), result,
      criteria: answer !== null && answer.result !== "invalid" ? answer.criteria : [],
      summary: failed !== null ? `review call failed: ${failed}` : answer === null ? "no answer" : answer.result === "invalid" ? `answer invalid: ${answer.reason}` : answer.summary,
      ...(current.rerun === undefined ? {} : { note: current.rerun.note }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    let next: RequirementReview = { ...rest, rounds: [...current.rounds, round], state: "passed" };
    if (result !== "passed") next = settleNotPassed(store, runRow.groupId, next, round);
    saveReview(store, runRow.groupId, next);
    recordActivity(store, { groupId: runRow.groupId, kind: "requirement-review", body: { roundNo, result, tip, state: next.state, ...(round.fixTaskId === undefined ? {} : { action: "fix-opened", taskId: round.fixTaskId }) } });
  },
  usageUnknownReason: REQUIREMENT_REVIEW_USAGE_UNKNOWN,
};

/**
 * §3.4-§3.5: a not-met round opens one fix task in the same group covering every unmet criterion (at most two automatic
 * rounds; a third not-met stops the group, `rounds-exhausted`); a fix the group cannot fund stops it `unfunded`. Any other
 * round that did not pass stops the group in Problems with why.
 */
function settleNotPassed(store: ControlStore, groupId: string, review: RequirementReview, round: ReviewRound): RequirementReview {
  if (round.result === "not-met") {
    if (review.autoFixRounds >= MAX_AUTO_FIX_ROUNDS) return { ...review, state: "not-passed", why: "rounds-exhausted" };
    const opened = openFixTask(store, groupId, round, "auto");
    if ("refused" in opened) return { ...review, state: "not-passed", why: opened.refused };
    round.fixTaskId = opened.taskId; round.fixBy = "auto";
    return { ...review, state: "fixing", autoFixRounds: review.autoFixRounds + 1 };
  }
  const why: ReviewWhy = round.result === "cannot-judge" ? "cannot-judge" : round.result === "invalid" ? "invalid" : round.result === "unfunded" ? "unfunded" : "failed";
  return { ...review, state: "not-passed", why };
}

/** The fix task's id: `review-fix-<round>`, or `-<n>` after it when a hand fix of the same round took that id. */
export function fixTaskIdOf(store: ControlStore, groupId: string, roundNo: number): string {
  let id = `review-fix-${roundNo}`;
  for (let n = 2; store.db.prepare("SELECT 1 FROM work_items WHERE group_id=? AND id=?").get(groupId, id) !== undefined; n += 1) id = `review-fix-${roundNo}-${n}`;
  return id;
}

/**
 * Task 9: the fix task's contract -- the round's unmet findings as its goal (or the person's `goal`), the files they name
 * as its write set (the tasks' write sets when they name none), the tasks' allow/deny lists, the group's union of setup and
 * required checks; policies and verifier from the group's first task in plan order.
 */
export function fixTaskContract(store: ControlStore, groupId: string, round: ReviewRound, criteria: ReadonlyArray<{ id: string; text: string }>, taskId: string, goal?: string, paths?: readonly string[]) {
  const plan = readArchivedPlan(store, groupId);
  const appended = new Set(plan.appendedTaskIds ?? []);
  const tasks = plan.plan.tasks.filter((task) => !appended.has(task.taskId)).map((task) => readArchivedContract(store, groupId, task.taskId).contract);
  const first = tasks[0];
  if (first === undefined) throw new ControlError("recovery-blocked", "requirement-review-no-task");
  const unmet = round.criteria.filter((c) => c.verdict === "not-met");
  const textOf = (id: string) => criteria.find((c) => c.id === id)?.text ?? id;
  const findings = unmet.map((c) => `- ${c.id} (${textOf(c.id)}): missing ${c.missing ?? "?"}${c.evidence.length === 0 ? "" : `; looked at ${c.evidence.map((e) => e.line === null ? e.path : `${e.path}:${e.line}`).join(", ")}`}`);
  const named = [...new Set(unmet.flatMap((c) => c.evidence.map((e) => e.path)))];
  const union = (lists: string[][]) => [...new Set(lists.flat())];
  const targetPaths = paths !== undefined && paths.length > 0 ? [...new Set(paths)] : named.length > 0 ? named : union(tasks.map((t) => t.context.targetPaths));
  const commands = acceptanceCommands(store, groupId);
  const { setupCommands: _setup, ...context } = first.context;
  return taskContractSchema.parse({
    ...first,
    objective: { taskId, goal: goal ?? ["The requirement review found these acceptance criteria not met; make them met:", ...findings].join("\n"),
      successCondition: `the requirement review finds criteria ${(unmet.length > 0 ? unmet.map((c) => c.id) : criteria.map((c) => c.id)).join(", ")} met`, nonGoals: [] },
    context: { ...context, targetPaths, ...(commands.setup.length === 0 ? {} : { setupCommands: commands.setup }) },
    safetyPolicy: { ...first.safetyPolicy, allowlistPaths: union(tasks.map((t) => t.safetyPolicy.allowlistPaths)), denylistPaths: union(tasks.map((t) => t.safetyPolicy.denylistPaths)),
      maxFilesTouched: Math.max(first.safetyPolicy.maxFilesTouched, targetPaths.length) },
    verification: { ...first.verification, requiredChecks: commands.checks.length > 0 ? commands.checks : first.verification.requiredChecks },
  });
}

/** Appends the fix task in the caller's transaction (a savepoint: a refusal leaves nothing); `refused` says why it could not. */
export function openFixTask(store: ControlStore, groupId: string, round: ReviewRound, _by: string, goal?: string, paths?: readonly string[]): { taskId: string } | { refused: ReviewWhy } {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  const criteria = reviewInputsOf(store, groupId, body).criteria;
  const plan = readArchivedPlan(store, groupId);
  const appended = new Set(plan.appendedTaskIds ?? []);
  const first = plan.plan.tasks.find((task) => !appended.has(task.taskId))!.taskId;
  const taskId = fixTaskIdOf(store, groupId, round.roundNo);
  const grant = (readWork(store, groupId, first) as unknown as { grant: { work: Amount; handoff: Amount } }).grant;
  store.db.exec("SAVEPOINT review_fix");
  try {
    appendConfirmedTaskInTransaction(store, groupId, { taskId, contract: fixTaskContract(store, groupId, round, criteria, taskId, goal, paths), agentFrom: first,
      work: { ...grant.work, tokens: grant.work.tokens ?? 0 } as Amount, handoff: grant.handoff, dependsOn: [] });
    store.db.exec("RELEASE review_fix");
    return { taskId };
  } catch (error) {
    store.db.exec("ROLLBACK TO review_fix"); store.db.exec("RELEASE review_fix");
    if (!(error instanceof ControlError)) throw error;
    return { refused: error.code === "group-budget-unavailable" ? "unfunded" : "failed" };
  }
}
