import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import { frozenWorkAgent } from "./agentFreeze.js";
import { binaryFacts } from "./binaryFacts.js";
import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { chainRounds } from "./clarifyChain.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { readConfirmedReconcileSlot } from "./executionSnapshot.js";
import { acceptanceCommands, clearGroupFailure, logGroupFailureOnce, recordWorkBranchMissing, workBranchKnownMissing } from "./groupAcceptance.js";
import { acceptanceOf, acceptanceSatisfied, deliveredAcceptanceOf, deliveredAcceptanceTarget } from "./groupAcceptanceRecord.js";
import { gitOk, isAncestor, refTip } from "./integrationGit.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { appendConfirmedTaskInTransaction } from "./groupTaskAppend.js";
import { readArchivedContract, readArchivedPlan } from "./queries.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, completeGroupSingleCallInTransaction, interruptGroupSingleCall, readGroupCallContract } from "./groupSingleCall.js";
import { saveRun } from "./budget.js";
import { closeSingleCall } from "./singleCallLedger.js";
import { isMultiGroup } from "./multiGroup.js";
import { targetShapeOk } from "./requirementOverview.js";
import { cutUtf8 } from "./noChange.js";
import { planLayers, planOrderTasks } from "./planOrder.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readWork } from "./queries.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { readDraft, readRounds } from "./requirementRecords.js";
import { reviewOf, reviewRequired, type CriterionVerdict, type RequirementReview, type ReviewRound, type ReviewRoundResult, type ReviewWhy } from "./requirementReviewRecord.js";
import type { SingleCallHandler, SingleCallRunRow } from "./singleCallPurposes.js";
import { taskWorkTokens } from "./usagePause.js";
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
    criteria: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "verdict", "evidence", "missing", "fixableBy"],
      properties: { id: { type: "string" }, verdict: { type: "string", enum: ["met", "not-met", "cannot-judge"] },
        evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "line"], properties: { path: { type: "string" }, line: { type: ["integer", "null"] } } } },
        missing: { type: ["string", "null"] },
        // Tester #343: who can meet the criterion; only `work` criteria get an automatic fix task.
        fixableBy: { type: "string", enum: ["work", "plan", "person"] } } } },
    summary: { type: "string" },
    // Optional: the reviewer names a person's constraint that a required check would contradict. The controller stops
    // automatic repair and leaves both the instruction and the failing check visible instead of inventing an exception.
    checkConflict: { type: "object", additionalProperties: false, required: ["criterionId", "requiredCheck", "because"],
      properties: { criterionId: { type: "string" }, requiredCheck: { type: "string" }, because: { type: "string" } } },
  },
});
const outputSchema = z.object({
  criteria: z.array(z.object({ id: z.string().min(1), verdict: z.enum(["met", "not-met", "cannot-judge"]),
    evidence: z.array(z.object({ path: z.string().min(1), line: z.number().int().nonnegative().nullable() }).strict()), missing: z.string().nullable(),
    fixableBy: z.enum(["work", "plan", "person"]) }).strict()),
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

/** `kind`: what Orca read from the file's header (#337: type, image size), shown for a binary file; absent when not recognised. */
export interface ChangedFile { path: string; status: string; bytes: number; sha256: string; binary: boolean; kind?: string }
/** #314: the accepted plan as data, so a criterion about the plan's shape is judgeable instead of always cannot-judge. */
export interface ReviewPlanTask { taskId: string; title: string; dependsOn: string[]; targetPaths: string[]; successCondition: string; checks: string[] }
export interface ReviewPlan { layers: string[][]; tasks: ReviewPlanTask[] }
export function buildReviewPrompt(input: { idea: string; statement: string; criteria: ReadonlyArray<{ id: string; text: string }>; openBranches: readonly string[];
  changedFiles: readonly ChangedFile[]; diff: string; truncated: boolean; note?: string; acceptanceFailed?: boolean;
  acceptanceBaseline?: { command: string; tail?: string; tipTail?: string }; plan?: ReviewPlan | null; facts?: readonly string[] }): string {
  return [
    "You are Orca's requirement reviewer. A group of tasks implemented the requirement below; its tasks' checks passed on the result.",
    // Delivery tail D4 (#336, #337 prompt half): evidence is not only the diff.
    "Evidence may be a file's content, a file's metadata (path, size, hash), a command's recorded result, or a delivery Orca recorded -- each section below says which.",
    // Review of #337: metadata is evidence only of itself -- a PDF's hash does not show what the PDF says.
    "A file's listed metadata (size, hash, type, stored pixel size) shows only those facts, never what its unshown content says.",
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
    ...(input.facts === undefined || input.facts.length === 0 ? [] : ["", "What Orca recorded beyond the diff:", ...input.facts]),
    "",
    // #337: a binary file's type and stored pixel size, read by Orca from its header, are facts the reviewer may cite by path.
    "Files the group changed (status, path, bytes, sha256; for a binary file, its type and stored pixel size (EXIF rotation is not read) when Orca could read them from its header):",
    ...input.changedFiles.map((f) => `- ${f.status} ${f.path} ${f.bytes} ${f.sha256}${!f.binary ? "" : f.kind === undefined ? " (binary: named only, its bytes are not shown)" : ` (binary: ${f.kind}; its other bytes are not shown)`}`),
    "",
    "The group's diff against its base:",
    input.diff,
    ...(input.truncated ? [`(The diff was cut at ${REVIEW_DIFF_MAX_BYTES} bytes; what follows was not shown to you.)`] : []),
    "",
    // Tester #343 (spec 2026-11-17 S5): the review prompt carries no version marker (the contract's schema id
    // `orca-requirement-review-contract-v1` names the call's contract, not this text); this is the change that added fixableBy.
    "Answer with a JSON object {\"criteria\": [{\"id\", \"verdict\", \"evidence\", \"missing\", \"fixableBy\"}], \"summary\"}.",
    "- verdict met: name the evidence (file path and line; or the file's path with line null when the evidence is what is listed for it -- its size, hash, type or stored pixel size, never what its unshown content says; for a record above, {\"path\": \"orca:acceptance\" | \"orca:delivery\" | \"orca:delivered-acceptance\", \"line\": null} -- a command and its exit as recorded there). missing is null.",
    "- verdict not-met: name the evidence you looked at, in the same forms, and say in `missing` what is still needed.",
    "- verdict cannot-judge: only when neither the diff, the files listed nor Orca's records above can show it; say in `missing` which record or content would. Do not guess what a file's unshown content says.",
    "- fixableBy, for every criterion, says who could meet it: \"work\" when changing files in the repository can meet it; \"plan\" when it is about the accepted plan itself (its tasks, their targetPaths, dependsOn or order), which no change to files alters; \"person\" when only the person can decide (their instructions contradict each other, or it depends on a fact outside the repository). Orca opens an automatic fix task only for not-met criteria that are \"work\".",
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
      // Delivery tail spec D2 (human ruling 1): a satisfied tip waits for its delivery to settle, so a criterion about the
      // delivery is judged when it can be true. A failed acceptance (#314) opens the review at once: it is never delivered.
      if (acceptanceSatisfied(store, groupId, body) && !(await deliverySettled(deps.resolveRepository(groupRepoId(store, groupId)), body, tip))) continue;
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

/**
 * The run a review call left stuck before ccloop was given it (its prompt was never built), or null. `active`: the run
 * is still active and blocked at A2, so the close also gives its grant back; inactive, a stop already settled it.
 */
type UnpreparedRun = { runId: string; groupId: string; requirementReview?: { tip?: unknown }; state: string; failureCode?: string | null;
  unknown: { work: boolean; handoff: boolean }; remaining: { work: Amount; handoff: Amount }; executionId?: string | null;
  drive?: { blockedAt?: string | null; blockedReason?: string | null; prepared?: boolean } };
function unpreparedReviewRun(store: ControlStore, groupId: string, roundNo: number): { run: UnpreparedRun; active: boolean } | null {
  // Tester #350: the round's latest run, active or not. One settled by a stop (a pause, a handoff, any settlement before
  // #334) is inactive but never prepared all the same, and nothing else will move the review.
  const row = store.db.prepare("SELECT active, body FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, workItemOf(roundNo));
  if (row === undefined) return null;
  const run = JSON.parse(String(row.body)) as UnpreparedRun, active = Number(row.active) === 1;
  if (run.drive?.prepared === true || (run.executionId ?? null) !== null) return null;
  // It can no longer advance. Active: blocked at A2, the driver waits for a person; an active run in any other state --
  // resumed by a `recovery retry`, say -- may still be prepared, and is left to the driver. Inactive: settled
  // `settled-restartable`, which only a settlement that proved the run never started writes -- from whichever state a stop
  // found it in (blocked at A2 or A1, resumed to start-pending, still starting), so blockedAt proves nothing there. Any
  // other settlement (unrecoverable, failed) proved nothing about the provider and is left alone.
  return (active ? run.state === "blocked" && run.drive?.blockedAt === "A2" : run.state === "settled-restartable") ? { run, active } : null;
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
    const found = current?.state === "reviewing" && current.rounds.length + 1 === roundNo ? unpreparedReviewRun(store, groupId, roundNo) : null;
    if (current === null || found === null) return false;
    const { run } = found;
    const reason = run.drive?.blockedReason ?? `the run was ${run.state} before it was prepared`;
    // Tester #350: a run a stop already settled keeps its settlement -- that stop gave its grant back and made it inactive;
    // releasing the grant again would count it twice. Only the round is closed. It deliberately writes no
    // `single-call-result` receipt: its only readers are the replay guards of a call's result settlement
    // (groupSingleCall.ts and its siblings), which run on an active run that has an execution.
    if (found.active) {
      saveRun(store, { ...run, state: "failed-before-provider", failureCode: "requirement-review-prepare-failed", unknown: { work: false, handoff: false } } as never);
      interruptGroupSingleCall(store, run as never);
      closeSingleCall(store, run.runId, { id: `single-call-result:${groupId}:${run.runId}`, kind: "single-call-result", body: { groupId, runId: run.runId } });
    }
    const tip = typeof run.requirementReview?.tip === "string" ? run.requirementReview.tip : "";
    const round: ReviewRound = { roundNo, tip, runId: run.runId, at: store.now(), result: "failed", criteria: [],
      summary: `review could not be prepared: ${cutUtf8(reason, 500)}`, ...(current.rerun === undefined ? {} : { note: current.rerun.note }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    saveReview(store, groupId, { ...rest, rounds: [...current.rounds, round], state: "not-passed", why: "failed" });
    recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "failed", tip, state: "not-passed" } });
    return true;
  });
}

/** D2/Correction 1.5: after this many consecutive transient failures, the review no longer waits for the delivery. */
export const REVIEW_TRANSIENT_OPENS = 3;

/**
 * Delivery tail spec D2 (Correction 1.1, 1.5): whether the delivery of `tip` settled for the review's purpose -- no frozen
 * delivery (keep); blocked or conflicted (it goes ahead and is told why); a delivery that has failed transiently
 * REVIEW_TRANSIENT_OPENS times; the tip delivered (a history chain published for it), and its delivered acceptance recorded
 * when D3 applies; or the tip already in the target by local refs (nothing to carry). Otherwise it waits.
 */
async function deliverySettled(repo: string, body: unknown, tip: string): Promise<boolean> {
  const integration = readGroupIntegration(body);
  if (integration === null || !integration.frozen) return true;
  if (integration.state === "blocked" || integration.state === "conflict") return true;
  if (integration.transient >= REVIEW_TRANSIENT_OPENS) return true;
  if (integration.state !== "idle") return false;
  const delivered = integration.historyPublished !== undefined ? integration.historyPublished.groupTip === tip
    : integration.lastIntegrated === tip && integration.pending === null;
  if (delivered) {
    const target = deliveredAcceptanceTarget(body);
    if (target === null || target.tip !== tip) return true;
    const record = deliveredAcceptanceOf(body);
    return record !== null && record.tip === target.tip && record.commit === target.commit;
  }
  const scheme = integration.scheme;
  if (scheme.delivery === "keep" || integration.pending !== null) return false;
  for (const ref of [`refs/heads/${scheme.target}`, ...("remote" in scheme ? [`refs/remotes/${scheme.remote}/${scheme.target}`] : [])]) {
    const at = await refTip(repo, ref);
    if (at !== null && await isAncestor(repo, tip, at)) return true;
  }
  return false;
}

/**
 * Delivery tail spec D4: what Orca recorded beyond the diff, as lines -- in words that assume no language or test framework:
 * the acceptance on the reviewed tip (each command, its exit and time), the delivery (scheme, and delivered / not yet /
 * failed / backing off), and the acceptance on the delivered commit. Only what is known is said.
 */
async function reviewFacts(repo: string, body: unknown, tip: string): Promise<string[]> {
  const lines: string[] = [];
  const short = (commit: string): string => commit.slice(0, 12);
  const commandLines = (commands: ReadonlyArray<{ command: string; exit: string; ms: number }>) =>
    commands.map((c) => `  - \`${cutUtf8(c.command, 300)}\` -> exit ${c.exit} (${c.ms} ms)`);
  const accepted = acceptanceOf(body);
  if (accepted !== null && (accepted.tip === tip || accepted.tip === null)) {
    lines.push(`Acceptance on the reviewed tip ${short(tip)}: ${accepted.result}${accepted.why === undefined ? "" : ` (${accepted.why})`}`, ...commandLines(accepted.commands));
    const suite = accepted.fullSuite;
    if (suite?.command != null) lines.push(`  full suite \`${cutUtf8(suite.command, 300)}\`: exits ${suite.exits.join(", ") || "none"}${suite.baseline === undefined ? "" : `; at the group's base: exits ${suite.baseline.exits.join(", ")}`}`);
  }
  const integration = readGroupIntegration(body);
  if (integration === null) { lines.push(`Delivery: none configured -- the work stays on orca/<group>.`); return lines; }
  const scheme = integration.scheme;
  if (scheme.delivery === "keep") { lines.push(`Delivery: none configured -- the work stays on orca/<group>.`); return lines; }
  lines.push(`Delivery scheme: ${scheme.delivery}${"method" in scheme ? ` ${scheme.method}` : ""} into ${scheme.target}${"remote" in scheme ? ` on ${scheme.remote}` : ""}`);
  const delivered = integration.historyPublished !== undefined ? integration.historyPublished.groupTip === tip
    : integration.lastIntegrated === tip && integration.pending === null;
  if (integration.state === "blocked" || integration.state === "conflict") lines.push(`- not delivered: ${integration.state} (${integration.reason ?? "no reason recorded"})`);
  else if (delivered && integration.integratedCommit !== null) {
    let parents = "?";
    try { parents = String((await gitOk(repo, ["rev-list", "--parents", "-n", "1", integration.integratedCommit])).trim().split(/\s+/).length - 1); } catch { /* named as unknown */ }
    lines.push(`- delivered as ${integration.integratedCommit} (${parents} parents) on ${scheme.target}${integration.pr === null ? "" : `; pull request #${integration.pr.number} (${integration.pr.ready ? "ready" : "draft"}) ${integration.pr.url}`}`);
  } else if (delivered) lines.push(`- delivered: the tip ${short(tip)} is in ${scheme.target}`);
  else if (integration.retryAfter !== null) {
    const at = new Date(integration.retryAfter);
    lines.push(`- not delivered: retrying at ${Number.isNaN(at.getTime()) ? String(integration.retryAfter) : at.toISOString()} (${integration.transientReason ?? "no message recorded"})`);
  }
  else lines.push(`- not delivered yet${integration.lastIntegrated === null ? "" : `; last delivered work commit ${short(integration.lastIntegrated)}`}`);
  const target = deliveredAcceptanceTarget(body), record = deliveredAcceptanceOf(body);
  if (target !== null && target.tip === tip && record !== null && record.tip === target.tip && record.commit === target.commit) {
    lines.push(record.result === "not-needed"
      ? `Acceptance on the delivered commit: not needed (${record.why === "same-tree" ? "the delivered tree equals the reviewed tip's" : record.why === "before-record" ? "delivered before Orca recorded which tip a commit was made for; not checked" : "the target already held the reviewed tip"})`
      : `Acceptance on the delivered commit ${short(record.commit)}: ${record.result}`, ...commandLines(record.commands),
      // Review 2026-11-17: a red delivered acceptance's output, as the spec's D3 says the failure is in the prompt.
      ...(record.result === "failed" && record.tail !== undefined && record.tail !== "" ? [`  failing output (end): ${cutUtf8(record.tail, 1_500)}`] : []));
  }
  return lines;
}

const reviewIdentity = (run: SingleCallRunRow): { roundNo: number; tip: string } => {
  const r = run.requirementReview as { roundNo?: unknown; tip?: unknown } | undefined;
  if (typeof r?.roundNo !== "number" || typeof r.tip !== "string") throw new ControlError("recovery-blocked", "requirement-review-identity");
  return { roundNo: r.roundNo, tip: r.tip };
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * §3.2 bounded: the changed files (path, status, bytes and sha256 each; for #337 also what binaryFacts reads from the
 * header, which the prompt shows for a binary file) and the text diff cut at the bound.
 */
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
    const kind = binaryFacts(content);
    changedFiles.push({ path, status: st, bytes: content.length, sha256: sha256(content), binary, ...(kind === null ? {} : { kind }) });
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
    const facts = await reviewFacts(repo, body, tip);
    const acceptance = acceptanceOf(body);
    const baseline = acceptance?.result === "passed-relative" ? acceptance.fullSuite?.baseline : undefined;
    return {
      prompt: buildReviewPrompt({ ...inputs, ...changes, facts, ...(typeof contract?.note === "string" ? { note: contract.note } : {}),
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
      ...(current.rerun === undefined ? {} : { note: current.rerun.note }),
      // Tester #340: kept as data, not only in the summary sentence.
      ...(conflict === undefined ? {} : { checkConflict: { criterionId: conflict.criterionId, requiredCheck: cutUtf8(conflict.requiredCheck, 4096), because: cutUtf8(conflict.because, 4096) } }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    let next: RequirementReview = { ...rest, rounds: [...current.rounds, round], state: "passed" };
    if (result !== "passed") next = conflict === undefined ? settleNotPassed(store, runRow.groupId, next, round)
      // Tester #340: a definite not-met that conflicts with the person's restriction -- the person decides which gives way.
      : { ...next, state: "not-passed", why: "check-conflict" };
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
    // Tester #343 (spec S5): a criterion only the plan or the person can meet gets no work fix task -- one such fix burned
    // 48M tokens on a goal no file change could reach. A round recorded before S5 has no label and reads as `work`.
    const notMet = round.criteria.filter((c) => c.verdict === "not-met");
    const left = notMet.filter((c) => (c.fixableBy ?? "work") !== "work").map((c) => c.id);
    if (left.length > 0) round.leftToPerson = left;
    if (left.length === notMet.length) return { ...review, state: "not-passed", why: "not-fixable-by-work" };
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
  const named = fixTaskPaths(unmet);
  const union = (lists: string[][]) => [...new Set(lists.flat())];
  const targetPaths = paths !== undefined && paths.length > 0 ? [...new Set(paths)] : named.length > 0 ? named : union(tasks.map((t) => t.context.targetPaths));
  const commands = acceptanceCommands(store, groupId);
  // #322: a full suite the group's acceptance found red at its base too (passed-relative) is not this task's to turn green:
  // a fix that respects "do not repair a pre-existing failure" would fail it for good. The group's acceptance judges it
  // against the base again once the fix lands, so the fix task is not required to pass it; the goal says so.
  const accepted = acceptanceOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)));
  const baseRed = accepted?.result === "passed-relative" && accepted.fullSuite?.baseline !== undefined ? accepted.fullSuite.command : null;
  const kept = (checks: readonly string[]) => checks.filter((check) => check !== baseRed);
  const required = kept(commands.checks).length > 0 ? kept(commands.checks) : kept(source.verification.requiredChecks).length > 0 ? kept(source.verification.requiredChecks) : source.verification.requiredChecks;
  const baseRedNote = baseRed !== null && !required.includes(baseRed)
    ? [`\`${baseRed}\` already failed at the group's base; the group's acceptance judges it against the base, so this task is not required to pass it.`] : [];
  const { setupCommands: _setup, ...context } = source.context;
  return taskContractSchema.parse({
    ...source,
    objective: { taskId, goal: [goal ?? ["The requirement review found these acceptance criteria not met; make them met:", ...findings].join("\n"), ...baseRedNote,
      // Tester #343 (spec S5): a cheap second line of defence behind the reviewer's fixableBy.
      "If a criterion cannot be met by changing files, stop and report it in `decisions` instead of trying."].join("\n"),
      successCondition: `the requirement review finds criteria ${(unmet.length > 0 ? unmet.map((c) => c.id) : criteria.map((c) => c.id)).join(", ")} met`, nonGoals: [] },
    context: { ...context, targetPaths, ...(commands.setup.length === 0 ? {} : { setupCommands: commands.setup }) },
    safetyPolicy: { ...source.safetyPolicy, allowlistPaths: fixTaskAllowlist(tasks.map((t) => t.safetyPolicy.allowlistPaths), targetPaths), denylistPaths: union(tasks.map((t) => t.safetyPolicy.denylistPaths)),
      maxFilesTouched: Math.max(source.safetyPolicy.maxFilesTouched, targetPaths.length) },
    verification: { ...source.verification, requiredChecks: required },
  });
}

/**
 * Tester #352 (session 2026-11-18, controller rulings): the fix task's write set from its not-met findings. For "path X is
 * absent" the evidence is the OLD file and X is only in `missing`, so the paths `missing` names come first (each
 * criterion's, in text order), then the evidence's, deduplicated. The review's pseudo-evidence (`orca:acceptance`,
 * `orca:delivery`, `orca:delivered-acceptance`) names a record, not a file: it never enters the write set.
 */
export function fixTaskPaths(unmet: ReadonlyArray<{ readonly evidence: ReadonlyArray<{ readonly path: string }>; readonly missing: string | null }>): string[] {
  const all = [...unmet.flatMap((c) => missingTextPaths(c.missing)), ...unmet.flatMap((c) => c.evidence.map((e) => e.path))];
  return [...new Set(all)].filter((path) => !path.startsWith("orca:"));
}

/**
 * Tester #352: the repository-relative paths a finding's `missing` text names, in text order. A candidate is a backticked
 * span, or (fix round 1, Important 1) outside backticks a maximal run of path characters `[A-Za-z0-9._/*-]` -- so a path
 * glued to CJK text or wrapped in full-width or curly punctuation is found -- with sentence-ending dots stripped. A
 * backticked span must consist of path characters only (Important 2: no `--json`, `breach()`, `src/a.ts:12`) and contain
 * a `/` or end in a letter-led extension (`README.md`); a bare run must contain a `/` and end in such an extension or in
 * `/`. A trailing `/` names a directory and becomes `<directory>/**`. Each must have a target shape (targetShapeOk: no
 * leading `/`, no `*` but a trailing `/**`, no empty, `.`, `..` or `.git` segment), no segment starting with `-`, and not
 * be `**` alone: a stray token must not open the whole repository. The review schema stays as it is.
 */
function missingTextPaths(missing: string | null): string[] {
  if (missing === null) return [];
  const out: string[] = [];
  const extension = /\.[A-Za-z][A-Za-z0-9]*$/;
  for (const match of missing.matchAll(/`([^`]*)`|([A-Za-z0-9._/*-]+)/g)) {
    const quoted = match[1] !== undefined;
    const token = quoted ? match[1]!.trim() : match[2]!.replace(/\.+$/, "");
    if (quoted ? !/^[A-Za-z0-9._/*-]+$/.test(token) || !(token.includes("/") || extension.test(token))
      : !(token.includes("/") && (extension.test(token) || token.endsWith("/")))) continue;
    const path = token.endsWith("/") ? `${token}**` : token;
    if (path !== "**" && !path.split("/").some((segment) => segment.startsWith("-")) && targetShapeOk(path)) out.push(path);
  }
  return out;
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

/** Tester #343 (spec S5, agent's call for review: the number): an automatic fix task's token ceiling. */
export const AUTO_FIX_USED_MULTIPLE = 2;
export const AUTO_FIX_MIN_TOKENS = 1_000_000;
/** The ceiling: twice the tokens the source task's runs used, at least AUTO_FIX_MIN_TOKENS, never above the source's own grant. */
export function autoFixTokenCeiling(used: number, sourceGrantTokens: number | null): number {
  const ceiling = Math.max(AUTO_FIX_USED_MULTIPLE * used, AUTO_FIX_MIN_TOKENS);
  return sourceGrantTokens === null ? ceiling : Math.min(sourceGrantTokens, ceiling);
}

/**
 * Appends the fix task in the caller's transaction (a savepoint: a refusal leaves nothing); `refused` says why it could not.
 * Tester #343: an automatic fix (`by` "auto") covers only the not-met criteria changing files can meet, and its work grant
 * carries a token ceiling (autoFixTokenCeiling): deriveContract writes the grant's tokens into the contract's
 * `executionPolicy.tokenBudget`, the number ccloop stops a phase at (#225). A person's fix keeps the source's grant and
 * every not-met criterion.
 */
export function openFixTask(store: ControlStore, groupId: string, round: ReviewRound, by: string, goal?: string, paths?: readonly string[]): { taskId: string } | { refused: ReviewWhy; detail: string } {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  const criteria = reviewInputsOf(store, groupId, body).criteria;
  const auto = by === "auto";
  const scope: ReviewRound = auto ? { ...round, criteria: round.criteria.filter((c) => c.verdict !== "not-met" || (c.fixableBy ?? "work") === "work") } : round;
  const sourceId = fixSourceTaskId(store, groupId, scope);
  const taskId = fixTaskIdOf(store, groupId, round.roundNo);
  const grant = (readWork(store, groupId, sourceId) as unknown as { grant: { work: BudgetAmount; handoff: Amount } }).grant;
  const work: BudgetAmount = auto ? { ...grant.work, tokens: autoFixTokenCeiling(taskWorkTokens(store, groupId, sourceId), grant.work.tokens) } : grant.work;
  store.db.exec("SAVEPOINT review_fix");
  try {
    appendConfirmedTaskInTransaction(store, groupId, { taskId, contract: fixTaskContract(store, groupId, scope, criteria, taskId, sourceId, goal, paths), agentFrom: sourceId,
      // Follow-up L: a person's fix takes the sibling task's work grant as it is -- in an expectation-model group it has no
      // token number (null); `?? 0` made it 0, which deriveContract refuses, so no fix task could open there.
      work, handoff: grant.handoff, dependsOn: [] });
    store.db.exec("RELEASE review_fix");
    return { taskId };
  } catch (error) {
    store.db.exec("ROLLBACK TO review_fix"); store.db.exec("RELEASE review_fix");
    if (!(error instanceof ControlError)) throw error;
    return { refused: error.code === "group-budget-unavailable" ? "unfunded" : "failed", detail: error.detail === undefined ? error.code : `${error.code}:${error.detail}` };
  }
}
