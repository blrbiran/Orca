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
import { acceptanceCommands, clearGroupFailure, logGroupFailureOnce, recordWorkBranchMissing, workBranchKnownMissing } from "./groupAcceptance.js";
import { acceptanceOf, acceptanceSatisfied } from "./groupAcceptanceRecord.js";
import { appendConfirmedTaskInTransaction } from "./groupTaskAppend.js";
import { readArchivedContract, readArchivedPlan } from "./queries.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, completeGroupSingleCallInTransaction, interruptGroupSingleCall, readGroupCallContract } from "./groupSingleCall.js";
import { saveRun } from "./budget.js";
import { closeSingleCall } from "./singleCallLedger.js";
import { isMultiGroup } from "./multiGroup.js";
import { cutUtf8 } from "./noChange.js";
import { planLayers, planOrderTasks } from "./planOrder.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readWork } from "./queries.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { readDraft, readRounds } from "./requirementRecords.js";
import { reviewOf, reviewRequired, type CriterionVerdict, type RequirementReview, type ReviewRound, type ReviewRoundResult, type ReviewWhy } from "./requirementReviewRecord.js";
import type { SingleCallHandler, SingleCallRunRow } from "./singleCallPurposes.js";
import { QUIET_GIT, workBranchTip } from "./workspace.js";
import { isDirFlowGroup } from "../flow/groups.js";
import { git, gitPrefix } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { FrozenSlot } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { BudgetAmount } from "./tokenPolicy.js";

/**
 * Tester follow-up G spec §3 (human: 「没有统一标准，一般会对照需求看具体实现的结果（这个结果可以是代码、文档、图片等等）」, the
 * playback 「同意」): after every task of a requirement group is done, an initial review waits for group acceptance to pass;
 * after a fix, review waits for acceptance to check the new tip even if a check fails (#312). Each review call compares
 * what the group changed with the requirement's acceptance criteria. Each criterion is
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
    // Optional: the reviewer names a person's constraint that a required check would contradict. The controller stops
    // automatic repair and leaves both the instruction and the failing check visible instead of inventing an exception.
    checkConflict: { type: "object", additionalProperties: false, required: ["criterionId", "requiredCheck", "because"],
      properties: { criterionId: { type: "string" }, requiredCheck: { type: "string" }, because: { type: "string" } } },
  },
});
const outputSchema = z.object({
  criteria: z.array(z.object({ id: z.string().min(1), verdict: z.enum(["met", "not-met", "cannot-judge"]),
    evidence: z.array(z.object({ path: z.string().min(1), line: z.number().int().nonnegative().nullable() }).strict()), missing: z.string().nullable() }).strict()),
  summary: z.string(),
  checkConflict: z.object({ criterionId: z.string().min(1), requiredCheck: z.string().min(1), because: z.string().min(1) }).strict().optional(),
}).strict();

/**
 * Code, not the model: invalid when the ids are not exactly the consensus criteria (missing, extra, repeated), a `met` or
 * `not-met` names no evidence, or a `not-met` says nothing is missing. Any cannot-judge makes the round cannot-judge (§3.5).
 */
export function classifyReviewOutput(raw: unknown, criterionIds: readonly string[]): { result: "passed" | "not-met" | "cannot-judge"; criteria: CriterionVerdict[]; summary: string;
  checkConflict?: { criterionId: string; requiredCheck: string; because: string } } | { result: "invalid"; reason: string } {
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
  if (parsed.data.checkConflict !== undefined && !criteria.some((c) => c.id === parsed.data.checkConflict!.criterionId && c.verdict === "not-met"))
    return { result: "invalid", reason: "check-conflict-criterion" };
  return { result, criteria, summary: parsed.data.summary,
    ...(parsed.data.checkConflict === undefined ? {} : { checkConflict: parsed.data.checkConflict }) };
}

export interface ChangedFile { path: string; status: string; bytes: number; sha256: string; binary: boolean }
/** #314: the accepted plan as data, so a criterion about the plan's shape is judgeable instead of always cannot-judge. */
export interface ReviewPlanTask { taskId: string; title: string; dependsOn: string[]; targetPaths: string[]; successCondition: string; checks: string[] }
export interface ReviewPlan { layers: string[][]; tasks: ReviewPlanTask[] }
export function buildReviewPrompt(input: { idea: string; statement: string; criteria: ReadonlyArray<{ id: string; text: string }>; openBranches: readonly string[];
  changedFiles: readonly ChangedFile[]; diff: string; truncated: boolean; note?: string; acceptanceFailed?: boolean;
  acceptanceBaseline?: { command: string; tail?: string; tipTail?: string }; plan?: ReviewPlan | null }): string {
  return [
    "You are Orca's requirement reviewer. A group of tasks implemented the requirement below; its tasks' checks passed on the result.",
    ...(input.acceptanceFailed === true ? ["Group acceptance failed on this tip (a project-wide check, possibly one that was already failing). Judge the criteria from the delivered work below anyway."] : []),
    ...(input.acceptanceBaseline === undefined ? [] : [`Project-wide check ${JSON.stringify(input.acceptanceBaseline.command)} failed at the group's base and on this tip. This alone does not prove the failures are the same. Base failure: ${input.acceptanceBaseline.tail ?? "(no output)"}. Tip failure: ${input.acceptanceBaseline.tipTail ?? "(no output)"}.`]),
    "Treat the person's explicit restrictions in the original requirement as binding, even if a check cannot pass without violating them. Never silently repair a forbidden pre-existing failure just to turn a check green.",
    "Compare what the group changed with each acceptance criterion and answer for every criterion, by its id.",
    "",
    `Requirement (as first said): ${input.idea}`,
    `Agreed statement: ${input.statement}`,
    ...(input.openBranches.length === 0 ? [] : [`Left open on purpose (not part of this requirement): ${input.openBranches.join("; ")}`]),
    "Acceptance criteria:",
    ...input.criteria.map((c) => `- ${c.id}: ${c.text}`),
    ...(input.note === undefined ? [] : ["", `A person or agent asked this review to look at: ${input.note}`]),
    ...(input.plan === undefined || input.plan === null ? [] : [
      "",
      "The accepted delivery plan (the plan itself; judge a criterion about the plan's structure from this section and one about the delivered code from the diff -- do not infer the plan from the code):",
      `Layers (tasks in one layer may run together; every earlier layer finishes first): ${input.plan.layers.map((layer, index) => `${index + 1}: ${layer.join(", ")}`).join("; ")}`,
      ...input.plan.tasks.map((task) => `- ${task.taskId} (${task.title}): depends on ${task.dependsOn.length === 0 ? "nothing" : task.dependsOn.join(", ")}; writes ${task.targetPaths.join(", ")}; checks ${task.checks.join(" | ")}; success: ${task.successCondition}`),
    ]),
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
    "If a not-met criterion asks for a change that contradicts an explicit human restriction and a required check, add checkConflict: {criterionId, requiredCheck, because}. Name the exact check and the person's instruction; do not assume that two red test runs have the same cause. Orca will stop automatic repair for review, not waive the check.",
    "Every criterion id above must appear exactly once.",
  ].join("\n");
}

/** §3.2: the requirement's words and its acceptance criteria -- the newest round of the clarification chain that has a result. */
export function reviewInputsOf(store: ControlStore, groupId: string, body: unknown): { idea: string; statement: string; criteria: Array<{ id: string; text: string }>; openBranches: string[]; plan: ReviewPlan | null } {
  const requirement = (body as { requirement?: { idea?: unknown; consensus?: { openBranches?: unknown } | null } }).requirement;
  const latest = chainRounds(readRounds(store, groupId)).filter((round) => round.result !== null).at(-1)?.result ?? null;
  if (latest === null || latest.acceptanceCriteria.length === 0) throw new ControlError("recovery-blocked", "requirement-review-criteria-missing");
  const openBranches = Array.isArray(requirement?.consensus?.openBranches) ? requirement!.consensus!.openBranches as string[] : latest.openBranches;
  return { idea: typeof requirement?.idea === "string" ? requirement.idea : latest.statement, statement: latest.statement,
    criteria: latest.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text })), openBranches, plan: reviewPlanOf(store, groupId, body) };
}

/** The accepted split's tasks as data (its draft when stored, else the archived contracts), in dependency order. */
function reviewPlanOf(store: ControlStore, groupId: string, body: unknown): ReviewPlan | null {
  const draftNo = (body as { requirement?: { acceptedDraftNo?: unknown } }).requirement?.acceptedDraftNo;
  let tasks: ReviewPlanTask[] | null = null;
  if (typeof draftNo === "number") {
    try {
      const authored = (readDraft(store, groupId, draftNo) as { output?: { tasks?: Array<Record<string, unknown>> } | null }).output?.tasks;
      if (Array.isArray(authored) && authored.length > 0) tasks = authored.map((task) => ({
        taskId: String(task.taskId), title: typeof task.title === "string" ? task.title : "",
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
        targetPaths: Array.isArray(task.targetPaths) ? task.targetPaths.map(String) : [],
        successCondition: typeof task.successCondition === "string" ? task.successCondition : "",
        checks: Array.isArray(task.checks) ? task.checks.map(String) : [],
      }));
    } catch (error) { if (!(error instanceof ControlError) || error.code !== "work-not-found") throw error; }
  }
  if (tasks === null) {
    const plan = readArchivedPlan(store, groupId);
    tasks = plan.plan.tasks.map((task) => {
      const contract = readArchivedContract(store, groupId, task.taskId).contract;
      const context = contract.context as { targetPaths?: string[] };
      return { taskId: task.taskId, title: contract.objective.goal, dependsOn: [...task.dependencyTaskIds],
        targetPaths: [...(context.targetPaths ?? [])], successCondition: contract.objective.successCondition,
        checks: [...contract.verification.requiredChecks] };
    });
  }
  if (tasks.length === 0) return null;
  const byTask = new Map(tasks.map((task) => [task.taskId, task]));
  const ordered = planOrderTasks(tasks.map((task) => ({ taskId: task.taskId, dependencyTaskIds: task.dependsOn })))
    .map((task) => byTask.get(task.taskId)!);
  return { layers: planLayers(ordered.map((task) => ({ taskId: task.taskId, dependencyTaskIds: task.dependsOn }))).map((layer) => layer.map((task) => task.taskId)), tasks: ordered };
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
    let threw = false;
    try {
      if (body.planHash === undefined || !reviewRequired(store, groupId, body) || isGroupArchived(store, groupId)) continue;
      if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) continue;
      const review = reviewOf(body);
      // #334: before the tasks-done gate, which the blocked review run itself (active) would hold shut.
      if (review?.state === "reviewing" && closeUnpreparedReview(deps, groupId, review)) { moved = true; continue; }
      if (!tasksDone(store, groupId)) continue;
      // #314 (same cause as #312): acceptance and review are two gates that both decide `done`; a failing tip must still
      // be reviewed. The gate waits for the acceptance pass to record this tip at all -- a recorded failure opens the
      // review too -- because both passes need the group's runs idle, so letting review run first would starve the
      // acceptance it is meant to complement. The round carries the failure to the prompt.
      const acceptance = acceptanceOf(body);
      if (!acceptanceSatisfied(store, groupId, body) && !(acceptance !== null && acceptance.result === "failed" && acceptance.why === undefined)) continue;
      if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) {
        if (review?.state === "not-run") continue;
        deps.write(() => saveReview(store, groupId, { state: "not-run", why: isMultiGroup(store, groupId) ? "multi-repo" : "dir", rounds: [], autoFixRounds: 0 }));
        moved = true;
        continue;
      }
      if (!roundDue(store, groupId, review)) continue;
      // Tester #278 rest (follow-up I): a work branch recorded missing is skipped without a git child until a new landing;
      // one found missing here is recorded as the acceptance pass records it (one record, one stderr line).
      if (workBranchKnownMissing(store, groupId, body)) continue;
      const tip = await workBranchTip(deps.resolveRepository(groupRepoId(store, groupId)), groupId);
      if (tip === null) { recordWorkBranchMissing(deps, groupId, "requirement review"); moved = true; continue; }
      // A fix task moved the tip: wait for the acceptance pass to check the new tip before reviewing it.
      const accepted = acceptanceOf(body);
      if (accepted !== null && accepted.tip !== null && accepted.tip !== tip) continue;
      if (review?.state === "fixing" && accepted?.tip !== tip) continue;
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
      // Tried again next round, logged once while the same failure repeats (#278); a round without it clears it.
      threw = true;
      logGroupFailureOnce(store, "requirement review", groupId, error);
    } finally { if (!threw) clearGroupFailure(store, "requirement review", groupId); }
  }
  return moved;
}

/** The run row a review call left blocked before ccloop was given it (A2: its prompt was never built), or null. */
type UnpreparedRun = { runId: string; groupId: string; requirementReview?: { tip?: unknown }; state: string; failureCode?: string | null;
  unknown: { work: boolean; handoff: boolean }; remaining: { work: Amount; handoff: Amount }; executionId?: string | null;
  drive?: { blockedAt?: string | null; blockedReason?: string | null; prepared?: boolean } };
function unpreparedReviewRun(store: ControlStore, groupId: string, roundNo: number): UnpreparedRun | null {
  const row = store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, workItemOf(roundNo));
  if (row === undefined) return null;
  const run = JSON.parse(String(row.body)) as UnpreparedRun;
  return run.state === "blocked" && run.drive?.blockedAt === "A2" && run.drive.prepared !== true && (run.executionId ?? null) === null ? run : null;
}

/**
 * Tester #334: a review call that failed while its prompt was being built (A2) was never handed to ccloop, so it spent
 * nothing. Retrying it reruns the same preparation, and while it stays blocked and active it holds the review in
 * `reviewing` (no person's exit answers) and the group's runs busy (no later round, no integration). It is closed here
 * as never having reached a provider -- its whole grant back to the group, the run inactive -- and the round settles
 * `failed` with the preparation's error, so the review is `not-passed` and accept / rerun / fix answer.
 */
function closeUnpreparedReview(deps: ReviewPassDeps, groupId: string, review: RequirementReview): boolean {
  const { store } = deps;
  const roundNo = review.rounds.length + 1;
  if (unpreparedReviewRun(store, groupId, roundNo) === null) return false;
  return deps.write(() => {
    const current = reviewOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)));
    const run = current?.state === "reviewing" && current.rounds.length + 1 === roundNo ? unpreparedReviewRun(store, groupId, roundNo) : null;
    if (current === null || run === null) return false;
    const reason = run.drive?.blockedReason ?? "unknown";
    saveRun(store, { ...run, state: "failed-before-provider", failureCode: "requirement-review-prepare-failed", unknown: { work: false, handoff: false } } as never);
    interruptGroupSingleCall(store, run as never);
    closeSingleCall(store, run.runId, { id: `single-call-result:${groupId}:${run.runId}`, kind: "single-call-result", body: { groupId, runId: run.runId } });
    const tip = typeof run.requirementReview?.tip === "string" ? run.requirementReview.tip : "";
    const round: ReviewRound = { roundNo, tip, runId: run.runId, at: store.now(), result: "failed", criteria: [],
      summary: `review could not be prepared: ${cutUtf8(reason, 500)}`, ...(current.rerun === undefined ? {} : { note: current.rerun.note }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    saveReview(store, groupId, { ...rest, rounds: [...current.rounds, round], state: "not-passed", why: "failed" });
    recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "failed", tip, state: "not-passed" } });
    return true;
  });
}

const reviewIdentity = (run: SingleCallRunRow): { roundNo: number; tip: string } => {
  const r = run.requirementReview as { roundNo?: unknown; tip?: unknown } | undefined;
  if (typeof r?.roundNo !== "number" || typeof r.tip !== "string") throw new ControlError("recovery-blocked", "requirement-review-identity");
  return { roundNo: r.roundNo, tip: r.tip };
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** §3.2 bounded: the changed files (binary ones named by path, bytes and sha256) and the text diff cut at the bound. */
async function groupChanges(repo: string, base: string, tip: string): Promise<{ changedFiles: ChangedFile[]; diff: string; truncated: boolean }> {
  // #334: the file lists grow with the number of files (a 12-task merge group changed 2,449), not with their size; they
  // get the same room as the blobs below instead of Node's default 1 MiB.
  const listed = { maxBuffer: REVIEW_GIT_LIST_MAX_BYTES };
  const numstat = (await git(repo, [...QUIET_GIT, "diff", "--numstat", "-z", "--no-renames", `${base}..${tip}`], listed)).split("\0").filter((s) => s.length > 0);
  const status = new Map((await git(repo, [...QUIET_GIT, "diff", "--name-status", "--no-renames", `${base}..${tip}`], listed)).split("\n").filter((l) => l.length > 0)
    .map((line) => { const [s, ...p] = line.split("\t"); return [p.join("\t"), s!] as const; }));
  const changedFiles: ChangedFile[] = [];
  for (const entry of numstat) {
    const [added, , ...rest] = entry.split("\t");
    const path = rest.join("\t"), st = status.get(path) ?? "M", binary = added === "-";
    if (st === "D") { changedFiles.push({ path, status: st, bytes: 0, sha256: "-", binary }); continue; }
    const content = execFileSync("git", [...QUIET_GIT, "cat-file", "blob", `${tip}:${path}`], { cwd: repo, maxBuffer: REVIEW_GIT_LIST_MAX_BYTES });
    changedFiles.push({ path, status: st, bytes: content.length, sha256: sha256(content), binary });
  }
  // #334: the prompt shows REVIEW_DIFF_MAX_BYTES of the diff, so only that much (and a character's worth more, to tell
  // a cut from an exact fit) is read; the whole diff was read before and a 2.4 MiB one failed every review call.
  const read = await gitPrefix(repo, [...QUIET_GIT, "diff", "--no-color", "--no-renames", `${base}..${tip}`], REVIEW_DIFF_MAX_BYTES + 4);
  const text = read.stdout.toString("utf8");
  const truncated = read.truncated || Buffer.byteLength(text, "utf8") > REVIEW_DIFF_MAX_BYTES;
  return { changedFiles, diff: truncated ? cutUtf8(text, REVIEW_DIFF_MAX_BYTES) : text, truncated };
}

/** #334: room for the changed-file lists and one blob read (the cat-file bound this file always gave). */
const REVIEW_GIT_LIST_MAX_BYTES = 256 * 1024 * 1024;

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
    const acceptance = acceptanceOf(body);
    const baseline = acceptance?.result === "passed-relative" ? acceptance.fullSuite?.baseline : undefined;
    return {
      prompt: buildReviewPrompt({ ...inputs, ...changes, ...(typeof contract?.note === "string" ? { note: contract.note } : {}),
        acceptanceFailed: acceptance?.result === "failed",
        ...(baseline === undefined || acceptance?.fullSuite?.command === null || acceptance?.fullSuite?.command === undefined ? {} :
          { acceptanceBaseline: { command: acceptance.fullSuite.command, ...(baseline.tail === undefined ? {} : { tail: cutUtf8(baseline.tail, 2_000) }),
            ...(acceptance.tail === undefined ? {} : { tipTail: cutUtf8(acceptance.tail, 2_000) }) } }) }),
      responseSchema: { ...requirementReviewResponseSchema }, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    };
  },
  async evaluate(deps, run, rawOutput, failure = null) {
    if (failure !== null) return { classified: null, failure } satisfies ReviewSettled;
    const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(run.groupId)!.body));
    const classified = classifyReviewOutput(rawOutput, reviewInputsOf(deps.store, run.groupId, body).criteria.map((c) => c.id));
    if (classified.result !== "invalid" && classified.checkConflict !== undefined) {
      const named = classified.checkConflict.requiredCheck;
      const accepted = acceptanceOf(body);
      const suite = accepted?.tip === reviewIdentity(run).tip ? accepted.fullSuite?.command : null;
      if (!acceptanceCommands(deps.store, run.groupId).checks.includes(named) && suite !== named)
        return { classified: { result: "invalid", reason: "check-conflict-unknown-check" }, failure: null } satisfies ReviewSettled;
    }
    return { classified, failure: null } satisfies ReviewSettled;
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
    const conflict = answer !== null && answer.result !== "invalid" && result === "not-met" ? answer.checkConflict : undefined;
    const round: ReviewRound = { roundNo, tip, runId: runRow.runId, at: store.now(), result,
      criteria: answer !== null && answer.result !== "invalid" ? answer.criteria : [],
      summary: failed !== null ? `review call failed: ${failed}` : answer === null ? "no answer" : answer.result === "invalid" ? `answer invalid: ${answer.reason}`
        : conflict === undefined ? answer.summary : `check conflict reported for ${conflict.criterionId}: ${cutUtf8(conflict.requiredCheck, 200)}; ${cutUtf8(conflict.because, 500)}. No automatic fix; review the person's restriction and the check.`,
      ...(current.rerun === undefined ? {} : { note: current.rerun.note }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    let next: RequirementReview = { ...rest, rounds: [...current.rounds, round], state: "passed" };
    if (result !== "passed") next = conflict === undefined ? settleNotPassed(store, runRow.groupId, next, round)
      : { ...next, state: "not-passed", why: "cannot-judge" };
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

/** Choose the task the accepted draft assigned to the unmet criteria, rather than the plan's alphabetical first task (#296). */
function fixSourceTaskId(store: ControlStore, groupId: string, round: ReviewRound): string {
  const plan = readArchivedPlan(store, groupId);
  const appended = new Set(plan.appendedTaskIds ?? []);
  const tasks = plan.plan.tasks.filter((task) => !appended.has(task.taskId));
  if (tasks.length === 0) throw new ControlError("recovery-blocked", "requirement-review-no-task");
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as { requirement?: { acceptedDraftNo?: number | null } };
  const draftNo = body.requirement?.acceptedDraftNo;
  let draftTasks: Array<{ taskId: string; traces: string[] }> | null = null;
  if (draftNo != null) {
    try { draftTasks = readDraft(store, groupId, draftNo).output?.tasks ?? null; }
    catch (error) { if (!(error instanceof ControlError) || error.code !== "work-not-found") throw error; }
  }
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const ordered = draftTasks === null || draftTasks === undefined
    ? planOrderTasks(tasks.map((task) => ({ taskId: task.taskId, dependencyTaskIds: task.dependencyTaskIds }))).map((task) => task.taskId)
    : draftTasks.map((task) => task.taskId).filter((id) => byId.has(id));
  const unmet = round.criteria.filter((criterion) => criterion.verdict === "not-met").map((criterion) => criterion.id);
  const relevant = unmet.length > 0 ? unmet : round.criteria.filter((criterion) => criterion.verdict === "cannot-judge").map((criterion) => criterion.id);
  let selected: string | undefined;
  let best = 0;
  for (const id of ordered) {
    const traced = draftTasks?.find((task) => task.taskId === id)?.traces ?? [];
    const score = relevant.filter((criterion) => traced.includes(criterion)).length;
    if (score > best) { selected = id; best = score; }
  }
  if (selected !== undefined) return selected;
  return ordered.find((id) => byId.get(id)!.dependencyTaskIds.every((dependency) => !byId.has(dependency))) ?? ordered[0] ?? tasks[0]!.taskId;
}

/**
 * Task 9: the fix task's contract -- the round's unmet findings as its goal (or the person's `goal`), the files they name
 * as its write set (the tasks' write sets when they name none), the tasks' allow/deny lists, the group's union of setup and
 * required checks; policies and verifier from the task the requirement traced to the findings.
 */
export function fixTaskContract(store: ControlStore, groupId: string, round: ReviewRound, criteria: ReadonlyArray<{ id: string; text: string }>, taskId: string, sourceId: string, goal?: string, paths?: readonly string[]) {
  const plan = readArchivedPlan(store, groupId);
  const appended = new Set(plan.appendedTaskIds ?? []);
  const tasks = plan.plan.tasks.filter((task) => !appended.has(task.taskId)).map((task) => readArchivedContract(store, groupId, task.taskId).contract);
  const source = tasks.find((task) => task.objective.taskId === sourceId);
  if (source === undefined) throw new ControlError("recovery-blocked", "requirement-review-no-task");
  const unmet = round.criteria.filter((c) => c.verdict === "not-met");
  const textOf = (id: string) => criteria.find((c) => c.id === id)?.text ?? id;
  const findings = unmet.map((c) => `- ${c.id} (${textOf(c.id)}): missing ${c.missing ?? "?"}${c.evidence.length === 0 ? "" : `; looked at ${c.evidence.map((e) => e.line === null ? e.path : `${e.path}:${e.line}`).join(", ")}`}`);
  const named = [...new Set(unmet.flatMap((c) => c.evidence.map((e) => e.path)))];
  const union = (lists: string[][]) => [...new Set(lists.flat())];
  const targetPaths = paths !== undefined && paths.length > 0 ? [...new Set(paths)] : named.length > 0 ? named : union(tasks.map((t) => t.context.targetPaths));
  const commands = acceptanceCommands(store, groupId);
  const { setupCommands: _setup, ...context } = source.context;
  return taskContractSchema.parse({
    ...source,
    objective: { taskId, goal: goal ?? ["The requirement review found these acceptance criteria not met; make them met:", ...findings].join("\n"),
      successCondition: `the requirement review finds criteria ${(unmet.length > 0 ? unmet.map((c) => c.id) : criteria.map((c) => c.id)).join(", ")} met`, nonGoals: [] },
    context: { ...context, targetPaths, ...(commands.setup.length === 0 ? {} : { setupCommands: commands.setup }) },
    safetyPolicy: { ...source.safetyPolicy, allowlistPaths: fixTaskAllowlist(tasks.map((t) => t.safetyPolicy.allowlistPaths), targetPaths), denylistPaths: union(tasks.map((t) => t.safetyPolicy.denylistPaths)),
      maxFilesTouched: Math.max(source.safetyPolicy.maxFilesTouched, targetPaths.length) },
    verification: { ...source.verification, requiredChecks: commands.checks.length > 0 ? commands.checks : source.verification.requiredChecks },
  });
}

/**
 * Follow-up L (dogfood g-28d9b560): the fix task's allowlist. An empty union allows every path (ccloop pathPolicy) and
 * stays empty; a non-empty one must also admit the fix task's own write set -- a file the review named or a person gave
 * with --path ("a file the fix task may write") was otherwise an allowlist miss (debugPlan.ts makes the same rule).
 */
export function fixTaskAllowlist(taskAllowlists: readonly string[][], targetPaths: readonly string[]): string[] {
  const union = [...new Set(taskAllowlists.flat())];
  return union.length === 0 ? [] : [...new Set([...union, ...targetPaths])];
}

/** Appends the fix task in the caller's transaction (a savepoint: a refusal leaves nothing); `refused` says why it could not. */
export function openFixTask(store: ControlStore, groupId: string, round: ReviewRound, _by: string, goal?: string, paths?: readonly string[]): { taskId: string } | { refused: ReviewWhy; detail: string } {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  const criteria = reviewInputsOf(store, groupId, body).criteria;
  const sourceId = fixSourceTaskId(store, groupId, round);
  const taskId = fixTaskIdOf(store, groupId, round.roundNo);
  const grant = (readWork(store, groupId, sourceId) as unknown as { grant: { work: BudgetAmount; handoff: Amount } }).grant;
  store.db.exec("SAVEPOINT review_fix");
  try {
    appendConfirmedTaskInTransaction(store, groupId, { taskId, contract: fixTaskContract(store, groupId, round, criteria, taskId, sourceId, goal, paths), agentFrom: sourceId,
      // Follow-up L: the sibling task's work grant as it is -- in an expectation-model group it has no token number (null);
      // `?? 0` made it 0, which deriveContract refuses, so no fix task could open there.
      work: grant.work, handoff: grant.handoff, dependsOn: [] });
    store.db.exec("RELEASE review_fix");
    return { taskId };
  } catch (error) {
    store.db.exec("ROLLBACK TO review_fix"); store.db.exec("RELEASE review_fix");
    if (!(error instanceof ControlError)) throw error;
    return { refused: error.code === "group-budget-unavailable" ? "unfunded" : "failed", detail: error.detail === undefined ? error.code : `${error.code}:${error.detail}` };
  }
}
