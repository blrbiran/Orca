import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AcceptanceFailureIdentity } from "./acceptanceFailureIdentity.js";
import { frozenWorkAgent } from "./agentFreeze.js";
import { binaryFacts } from "./binaryFacts.js";
import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { chainRounds } from "./clarifyChain.js";
import { dirWorkspaceOf, groupRepoId, isDirGroup, readPlacement, STOP_KEPT } from "./dirGroup.js";
import { DIR_EXCLUDES } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import { readConfirmedReconcileSlot } from "./executionSnapshot.js";
import { acceptanceCommands, clearGroupFailure, logGroupFailureOnce, recordWorkBranchMissing, workBranchKnownMissing } from "./groupAcceptance.js";
import { acceptanceOf, acceptanceSatisfied, deliveredAcceptanceOf, deliveredAcceptanceTarget } from "./groupAcceptanceRecord.js";
import { gitOk, isAncestor, refTip } from "./integrationGit.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { appendConfirmedTaskInTransaction } from "./groupTaskAppend.js";
import { readArchivedContract, readArchivedPlan, readBudgetProposal } from "./queries.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, completeGroupSingleCallInTransaction, interruptGroupSingleCall, readGroupCallContract } from "./groupSingleCall.js";
import { saveRun } from "./budget.js";
import { closeSingleCall } from "./singleCallLedger.js";
import { dirTargetRepoId, isMultiGroup, multiDirOf, type FrozenMultiDir } from "./multiGroup.js";
import { targetShapeOk } from "./requirementOverview.js";
import { cutUtf8 } from "./noChange.js";
import { planLayers, planOrderTasks } from "./planOrder.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readWork } from "./queries.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { readDraft, readRounds, taskWrites, type TaskWrite } from "./requirementRecords.js";
import { reviewOf, reviewRequired, type CriterionVerdict, type RelativePass, type RequirementReview, type ReviewRound, type ReviewRoundResult, type ReviewWhy } from "./requirementReviewRecord.js";
import type { SingleCallHandler, SingleCallRecordFacts, SingleCallRunRow } from "./singleCallPurposes.js";
import { taskWorkTokens } from "./usagePause.js";
import { QUIET_GIT, workBranchTip } from "./workspace.js";
import { isDirFlowGroup } from "../flow/groups.js";
import { DEFAULT_CAPS } from "../flow/vault/snapshot.js";
import { DEFAULT_EXCLUDES } from "../flow/vault/vault.js";
import { git, gitPrefix } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { FrozenSlot } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import { offPlanFactLines } from "./offPlanWrites.js";
import { failureNamesLine } from "./failureNames.js";
import { preexistingFailureFactLines, reportedBaseCheckPending } from "./preexistingFailure.js";
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

/** The three record pseudo-paths an answer may cite (#337 §4.2: matched as exact strings, never by the `orca:` prefix). */
export const REVIEW_RECORD_PATHS: ReadonlySet<string> = new Set(["orca:acceptance", "orca:delivery", "orca:delivered-acceptance"]);

/** #337 §4.2: a multi-directory group's evidence path, `<key>:<path>`, split on its first `:`; null unless the key is a member's. */
export function dirEvidence(path: string, dirKeys: readonly string[]): { key: string; path: string } | null {
  const at = path.indexOf(":");
  if (at <= 0 || at === path.length - 1) return null;
  const key = path.slice(0, at);
  return dirKeys.includes(key) ? { key, path: path.slice(at + 1) } : null;
}

/**
 * Code, not the model: invalid when the ids are not exactly the consensus criteria (missing, extra, repeated), a `met` or
 * `not-met` names no evidence, or a `not-met` says nothing is missing. Any cannot-judge makes the round cannot-judge (§3.5).
 * #337 §4.2: given a multi-directory group's member keys, every evidence path that is not a record must be `<key>:<path>`.
 */
export function classifyReviewOutput(raw: unknown, criterionIds: readonly string[], dirKeys?: readonly string[]): { result: "passed" | "not-met" | "cannot-judge"; criteria: CriterionVerdict[]; summary: string;
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
    if (dirKeys !== undefined) {
      const stray = c.evidence.find((e) => !REVIEW_RECORD_PATHS.has(e.path) && dirEvidence(e.path, dirKeys) === null);
      if (stray !== undefined) return { result: "invalid", reason: `evidence-dir:${stray.path}` };
    }
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
/**
 * #337 §4.2: one member of a multi-directory group as the prompt shows it -- its changes against its own base (the diff cut
 * at `share` bytes, its equal part of REVIEW_DIFF_MAX_BYTES), no changes, or a work branch that is gone.
 */
export type ReviewDirectory = { key: string; state: "unchanged" } | { key: string; state: "gone" }
  | { key: string; state: "changed"; kind: "repository" | "folder"; base: string; tip: string; changedFiles: ChangedFile[]; diff: string; truncated: boolean; share: number };
/** #337 §4.1: a folder group's heading, in place of a repository group's `The group's diff against its base:`. */
export const FOLDER_DIFF_HEADING = "The folder's changes: before = the copy of the folder Orca took when the work started; after = the work Orca will place into the folder:";
const fileLine = (f: ChangedFile): string => `- ${f.status} ${f.path} ${f.bytes} ${f.sha256}${!f.binary ? "" : f.kind === undefined ? " (binary: named only, its bytes are not shown)" : ` (binary: ${f.kind}; its other bytes are not shown)`}`;
const FILES_HEADING = "Files the group changed (status, path, bytes, sha256; for a binary file, its type and stored pixel size (EXIF rotation is not read) when Orca could read them from its header):";
function directoryLines(directories: readonly ReviewDirectory[]): string[] {
  return directories.flatMap((d) => d.state === "unchanged" ? ["", `Directory ${d.key}: no changes.`]
    : d.state === "gone" ? ["", `Directory ${d.key}: Orca's work branch is gone; not shown.`]
    : ["", `Directory ${d.key} (${d.kind}): files changed and diff, before = ${d.base.slice(0, 12)}, after = ${d.tip.slice(0, 12)}:`, ...d.changedFiles.map(fileLine), d.diff,
      ...(d.truncated ? [`(Directory ${d.key}: the diff was cut at ${d.share} bytes; the rest was not shown to you.)`] : [])]);
}
/**
 * Tester #391: what the acceptance recorded about the project-wide check, when it was red on the tip (or flaky). The tails
 * are the last 2 KB of each run's output; `baseExits` is present only when the same command also ran at the group's base
 * and was red there (`passed-relative`). The failing-test names in the tails are a reference, not the decision.
 * Review of #383: `reported` is how many task runs had reported the suite red -- with every tip exit green the record is
 * flaky without ever having been red on this tip, and the prompt must not say otherwise.
 */
export interface AcceptanceBaseline { command: string; tipExits: string[]; baseExits?: string[]; flaky?: boolean; reported?: number; tipTail?: string; baseTail?: string; tipIdentities?: AcceptanceFailureIdentity[]; baseIdentities?: AcceptanceFailureIdentity[] }

function recordedFailureNames(identities: readonly AcceptanceFailureIdentity[] | undefined, tail: string | undefined): string {
  if (identities === undefined || identities.length === 0) return failureNamesLine(tail);
  const labels = [...new Set(identities.map(({ file, testPath }) => cutUtf8(testPath.length === 0 ? file : `${file}: ${testPath.join(" > ")}`, 240)))];
  return `${labels.slice(0, 20).join("; ")}${labels.length > 20 ? ` (+${labels.length - 20} more named)` : ""}`;
}

const exitList = (exits: readonly string[]): string => exits.length === 0 ? "not recorded" : exits.join(", ");

/** #391: the acceptance section -- its exits on both sides, the failing names the last 2 KB gives, and how to read them. */
function acceptanceBaselineLines(baseline: AcceptanceBaseline): string[] {
  const baseRed = baseline.baseExits !== undefined;
  // Review of #383: task runs reported the suite red, yet both confirmation runs on this tip exited 0. It was never red
  // here, so neither the red-tip phrasing nor "passed on the retry" describes it.
  const reportedGreen = !baseRed && (baseline.reported ?? 0) > 0 && baseline.tipExits.every((exit) => exit === "0");
  const tipNames = recordedFailureNames(baseline.tipIdentities, baseline.tipTail);
  const baseNames = recordedFailureNames(baseline.baseIdentities, baseline.baseTail);
  const hasIdentities = (baseline.tipIdentities?.length ?? 0) + (baseline.baseIdentities?.length ?? 0) > 0;
  return [
    baseRed
      ? `Project-wide check ${JSON.stringify(baseline.command)} failed at the group's base and on this tip (tip: ${exitList(baseline.tipExits)}; base: ${exitList(baseline.baseExits!)}). This alone does not prove the failures are the same. Base failure: ${baseNames}. Tip failure: ${tipNames}.`
      : reportedGreen
        ? `Project-wide check ${JSON.stringify(baseline.command)}: task runs reported this suite red; both confirmation runs on this tip were green (exit(s) ${exitList(baseline.tipExits)}). No run of it at the group's base is recorded, so the relative-pass rule below does not apply to it. Recorded output: ${tipNames}.`
        : `Project-wide check ${JSON.stringify(baseline.command)} was red on this tip (exit(s) ${exitList(baseline.tipExits)}${baseline.flaky === true ? "; it passed on the retry, so it is flaky" : ""}). ${baseline.baseIdentities?.length ? `Stored failures at the group's base: ${baseNames}.` : "No run of it at the group's base is recorded, so the relative-pass rule below does not apply to it."} Tip failure: ${tipNames}.`,
    hasIdentities
      ? "The named failures come from recorded TAP identities where available. Any output excerpt holds only the last 2 KB. Use the recorded acceptance outcome to decide the check."
      : "Those failures are the last 2 KB of each output only. If they end in the test runner's summary without the failing tests' names, the identities are unavailable -- say so in `missing` if it matters, but do not answer cannot-judge for that reason alone when acceptance has decided the check. Red on this tip with the same exits at the group's base was red before the group; the tip's and the base's failing tests do not have to be the same identities.",
  ];
}
export function buildReviewPrompt(input: { idea: string; statement: string; criteria: ReadonlyArray<{ id: string; text: string }>; openBranches: readonly string[];
  changedFiles: readonly ChangedFile[]; diff: string; truncated: boolean; note?: string; acceptanceFailed?: boolean;
  acceptanceBaseline?: AcceptanceBaseline; plan?: ReviewPlan | null; facts?: readonly string[];
  /** #337: a folder group's heading (§4.1); a multi-directory group's sections, in place of the one diff (§4.2). */
  folder?: boolean; directories?: readonly ReviewDirectory[] }): string {
  const multi = input.directories !== undefined;
  return [
    "You are Orca's requirement reviewer. A group of tasks implemented the requirement below; its tasks' checks passed on the result.",
    // Delivery tail D4 (#336, #337 prompt half): evidence is not only the diff.
    "Evidence may be a file's content, a file's metadata (path, size, hash), a command's recorded result, or a delivery Orca recorded -- each section below says which.",
    // Review of #337: metadata is evidence only of itself -- a PDF's hash does not show what the PDF says.
    "A file's listed metadata (size, hash, type, stored pixel size) shows only those facts, never what its unshown content says.",
    // Tester #382 (human ruling): Orca's ledger and requirement document are runtime files, never deliverables.
    ORCA_RUNTIME_FILES_NOTE,
    ...(input.acceptanceFailed === true ? ["Group acceptance failed on this tip (a project-wide check, possibly one that was already failing). Judge the criteria from the delivered work below anyway."] : []),
    ...(input.acceptanceBaseline === undefined ? [] : acceptanceBaselineLines(input.acceptanceBaseline)),
    // Tester #391 (human ruling: 「统一到验收的『base 也红』口径」): acceptance's relative-pass policy is the standard; the
    // reviewer does not re-decide it from the failing-test names, which may not even be in the recorded tail.
    "When the acceptance record says a check passed relative to the base (it was red on this tip and red with the same exits when run at the group's base), that record alone decides a criterion about that check: a relative pass alone decides it, without the failing tests' names matching between the tip and the base, and repairing that pre-existing failure is not part of this group's delivery.",
    // Tester #392 (human ruling: 「review 按最终 diff 判归属，越界写入只作参考」): an off-plan write is a fact, not a verdict.
    "An off-plan write (a line under \"What Orca recorded beyond the diff\") is information, not a failed criterion: judge ownership from the final changed files and diff above only. A write that the owning task's final content replaced is not part of the delivery, so it is no reason to fail a criterion.",
    "Treat the person's explicit restrictions in the original requirement as binding, even if a check cannot pass without violating them. Never silently repair a forbidden pre-existing failure just to turn a check green.",
    "For every criterion, match the evidence to its exact subject and relation. A path's existence or a citation to an unrelated file does not by itself prove a content or dependency constraint.",
    "For a dependency constraint, follow whether the criterion describes a direct import or a transitive dependency; do not substitute one for the other, and do not claim a relation is traced unless the supplied material shows it.",
    "Use judgment for the evidence provided; this guidance does not require static analysis.",
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
    ...(multi ? [`${FILES_HEADING.slice(0, -1)}, by directory; each directory's diff is against its own base:`, ...directoryLines(input.directories!)] : [
      FILES_HEADING,
      ...input.changedFiles.map(fileLine),
      "",
      input.folder === true ? FOLDER_DIFF_HEADING : "The group's diff against its base:",
      input.diff,
      ...(input.truncated ? [`(The diff was cut at ${REVIEW_DIFF_MAX_BYTES} bytes; what follows was not shown to you.)`] : []),
    ]),
    "",
    // Tester #343 (spec 2026-11-17 S5): the review prompt carries no version marker (the contract's schema id
    // `orca-requirement-review-contract-v1` names the call's contract, not this text); this is the change that added fixableBy.
    "Answer with a JSON object {\"criteria\": [{\"id\", \"verdict\", \"evidence\", \"missing\", \"fixableBy\"}], \"summary\"}.",
    "- verdict met: name the evidence (file path and line; or the file's path with line null when the evidence is what is listed for it -- its size, hash, type or stored pixel size, never what its unshown content says; for a record above, {\"path\": \"orca:acceptance\" | \"orca:delivery\" | \"orca:delivered-acceptance\", \"line\": null} -- a command and its exit as recorded there). missing is null.",
    // #337 §4.2: a multi-directory group's evidence names its directory; code checks the key (classifyReviewOutput).
    ...(multi ? [`- In this group a file's path is always written <key>:<path> -- its directory's key, a colon, then its path in that directory (for example "${input.directories![0]?.key ?? "key"}:README.md"); a record above keeps its own name.`] : []),
    "- verdict not-met: name the evidence you looked at, in the same forms, and say in `missing` what is still needed.",
    "- verdict cannot-judge: only when neither the diff, the files listed nor Orca's records above can show it; if the supplied material does not show the relevant subject and relation, name in `missing` which record or content would. Do not guess what a file's unshown content says.",
    "- fixableBy, for every criterion, says who could meet it: \"work\" when changing files in the repository (or, for a folder group, the folder) can meet it; \"plan\" when it is about the accepted plan itself (its tasks, their targetPaths, dependsOn or order), which no change to files alters; \"person\" when only the person can decide (their instructions contradict each other, or it depends on a fact outside the repository). Orca opens an automatic fix task only for not-met criteria that are \"work\".",
    "If a not-met criterion asks for a change that contradicts an explicit human restriction and a required check, add checkConflict: {criterionId, requiredCheck, because}; \"checkConflict\": null when there is none. Name the exact check and the person's instruction; do not assume that two red test runs have the same cause. Orca will stop automatic repair for review, not waive the check.",
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
    // #337 §5.6: set once a folder or multi-directory group's round is due; a deterministic claim error then ends it.
    let claiming: { tip: string } | null = null;
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
      if (!acceptanceSatisfied(store, groupId, body) && !(acceptance !== null && (acceptance.result === "test-change-pending" || (acceptance.result === "failed" && acceptance.why === undefined)))) continue;
      // #337 §8: a dir flow group is still not reviewed (it carries no requirement; this keeps the old record shape).
      if (isDirFlowGroup(store, groupId)) {
        if (review?.state === "not-run") continue;
        deps.write(() => saveReview(store, groupId, { state: "not-run", why: "dir", rounds: [], autoFixRounds: 0 }));
        moved = true;
        continue;
      }
      if (!roundDue(store, groupId, review)) continue;
      // Tester #466: an agent's unanswered "pre-existing failure" whose base run is still pending is confirmed (or not)
      // before the review is told about it -- an unconfirmed report alone kept a green group at review.
      if (reportedBaseCheckPending(store, groupId, body)) continue;
      // #337 §4, §5.2, §5.6 (human: 「不要卡在」): a folder or multi-directory group is reviewed on its work branches. It runs no
      // group-wide acceptance on a tip and Orca places its work by itself, so neither wait below applies; a work branch
      // that is gone ends the review (noted) and never rewrites the acceptance record.
      const noted = noteGroup(store, groupId);
      let tip: string, tips: Record<string, string> | undefined;
      if (noted) {
        const found = await workTips(deps, groupId, body);
        if (found === null) { deps.write(() => endRoundFailed(store, groupId, "", `the work branch orca/${groupId} is gone`)); moved = true; continue; }
        ({ tip, tips } = found);
        claiming = { tip };
      } else {
        // Tester #278 rest (follow-up I): a work branch recorded missing is skipped without a git child until a new landing;
        // one found missing here is recorded as the acceptance pass records it (one record, one stderr line).
        if (workBranchKnownMissing(store, groupId, body)) continue;
        const found = await workBranchTip(deps.resolveRepository(groupRepoId(store, groupId)), groupId);
        if (found === null) { recordWorkBranchMissing(deps, groupId, "requirement review"); moved = true; continue; }
        tip = found;
        // A fix task moved the tip: wait for the acceptance pass to check the new tip before reviewing it.
        const accepted = acceptanceOf(body);
        if (accepted !== null && accepted.tip !== null && accepted.tip !== tip) continue;
        if (review?.state === "fixing" && accepted?.tip !== tip) continue;
        // Delivery tail spec D2 (human ruling 1): a satisfied tip waits for its delivery to settle, so a criterion about the
        // delivery is judged when it can be true. A failed acceptance (#314) opens the review at once: it is never delivered.
        if (acceptanceSatisfied(store, groupId, body) && !(await deliverySettled(deps.resolveRepository(groupRepoId(store, groupId)), body, tip))) continue;
      }
      deps.write(() => {
        const current = reviewOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body))) ?? { state: "pending" as const, rounds: [], autoFixRounds: 0 };
        const roundNo = current.rounds.length + 1, at = store.now();
        const funded = boundedGroupGrant(store, groupId, { ...REQUIREMENT_REVIEW_GRANT }, REVIEW_FLOOR_TOKENS, at);
        if ("unfunded" in funded) {
          const round: ReviewRound = { roundNo, tip, runId: null, at, result: "unfunded", criteria: [], summary: `the group cannot fund the review (${funded.unfunded})` };
          const next = settledReview(store, groupId, { ...current, state: "not-passed", why: "unfunded", rounds: [...current.rounds, round] });
          saveReview(store, groupId, next);
          // #337 §5.1: the state the review was saved with (a repository group's activity is unchanged).
          recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "unfunded", tip, ...(next.state === "noted" ? { state: next.state } : {}) } });
          return;
        }
        const reviewer = reviewerOf(store, groupId);
        // #337 §4.2 (§15 D3): a multi-directory group's tips, one per member, live on the call's identity and contract only.
        const ofTips = tips === undefined ? {} : { tips };
        claimGroupSingleCallInTransaction(store, { groupId, workItemId: workItemOf(roundNo), purpose: "requirement-review",
          identity: { requirementReview: { roundNo, tip, ...ofTips } }, slot: reviewer.slot, profile: reviewer.profile, grant: funded.grant,
          contract: { schema: "orca-requirement-review-contract-v1", roundNo, tip, ...ofTips, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS, ...(current.rerun === undefined ? {} : { note: current.rerun.note }) } });
        const { why: _why, ...open } = current;
        saveReview(store, groupId, { ...open, state: "reviewing" });
      });
      moved = true;
    } catch (error) {
      // #337 §5.6: a folder or multi-directory group's claim that failed for a reason no retry changes (recovery-blocked:
      // no profile, no criteria, no base) ends its review, noted, instead of waiting on a person. Decided by class (Rule 5).
      let ended = false;
      if (claiming !== null && error instanceof ControlError && error.code === "recovery-blocked") {
        const tip = claiming.tip, summary = error.detail ?? error.code;
        try {
          ended = deps.write(() => {
            const current = reviewOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)));
            if (!roundDue(store, groupId, current)) return false;
            endRoundFailed(store, groupId, tip, summary);
            return true;
          });
          if (ended) moved = true;
        } catch (inner) { error = inner; }
      }
      if (!ended) {
        // Tried again next round, logged once while the same failure repeats (#278); a round without it clears it.
        threw = true;
        logGroupFailureOnce(store, "requirement review", groupId, error);
      }
    } finally { if (!threw) clearGroupFailure(store, "requirement review", groupId); }
  }
  return moved;
}

/** #337 §5.1: a folder (dir) or multi-directory group -- reviewed like any other, and a review that did not pass ends `noted`. */
export function noteGroup(store: ControlStore, groupId: string): boolean {
  return isDirGroup(store, groupId) || isMultiGroup(store, groupId);
}

/**
 * #337 §5.1 (human: 「不要卡在」, ruling 2): the one mapping from a review that did not pass to `noted`, for a folder or
 * multi-directory group (the predicate is the group's kind, never the record's why). Every site that saves `not-passed`
 * applies it before both its saveReview and its recordActivity. A repository group's review is returned as it is.
 */
export function settledReview(store: ControlStore, groupId: string, review: RequirementReview): RequirementReview {
  return review.state === "not-passed" && noteGroup(store, groupId) ? { ...review, state: "noted" } : review;
}

/** #337 §5.6: a round with no call (a work branch gone, a claim no retry changes), `failed`; the review ends as settledReview says. */
function endRoundFailed(store: ControlStore, groupId: string, tip: string, summary: string): void {
  const current = reviewOf(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body))) ?? { state: "pending" as const, rounds: [], autoFixRounds: 0 };
  const roundNo = current.rounds.length + 1;
  const round: ReviewRound = { roundNo, tip, runId: null, at: store.now(), result: "failed", criteria: [], summary: cutUtf8(summary, 500),
    ...(current.rerun === undefined ? {} : { note: current.rerun.note }) };
  const { rerun: _rerun, why: _why, ...rest } = current;
  const next = settledReview(store, groupId, { ...rest, rounds: [...current.rounds, round], state: "not-passed", why: "failed" });
  saveReview(store, groupId, next);
  recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "failed", tip, state: next.state } });
}

/**
 * #337 §4.1-§4.2: the tip a folder or multi-directory group's review reads. A folder group: its vault's `orca/<g>`. A
 * multi group: each member's `orca/<g>` (a member whose branch is gone is left out of `tips`), and `tip` the primary's, or
 * the first member's in registered order that has one. Null when no branch is left.
 */
async function workTips(deps: ReviewPassDeps, groupId: string, body: unknown): Promise<{ tip: string; tips?: Record<string, string> } | null> {
  const multi = multiDirOf(body);
  if (multi === null) {
    const tip = await workBranchTip(deps.resolveRepository(groupRepoId(deps.store, groupId)), groupId);
    return tip === null ? null : { tip };
  }
  const tips: Record<string, string> = {};
  for (const member of multi.dirs) {
    const tip = await workBranchTip(deps.resolveRepository(dirTargetRepoId(deps.store, groupId, member.key)), groupId);
    if (tip !== null) tips[member.key] = tip;
  }
  const first = multi.dirs.find((member) => tips[member.key] !== undefined);
  return first === undefined ? null : { tip: tips[first.key]!, tips };
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
    const next = settledReview(store, groupId, { ...rest, rounds: [...current.rounds, round], state: "not-passed", why: "failed" });
    saveReview(store, groupId, next);
    recordActivity(store, { groupId, kind: "requirement-review", body: { roundNo, result: "failed", tip, state: next.state } });
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
  // Working-tree delivery spec §4.1: no target ref; only a settled delivery counts.
  if (scheme.delivery === "keep" || scheme.delivery === "working-tree" || integration.pending !== null) return false;
  for (const ref of [`refs/heads/${scheme.target}`, ...("remote" in scheme ? [`refs/remotes/${scheme.remote}/${scheme.target}`] : [])]) {
    const at = await refTip(repo, ref);
    if (at !== null && await isAncestor(repo, tip, at)) return true;
  }
  return false;
}

/**
 * Delivery tail spec D4: what Orca recorded beyond the diff, as lines -- in words that assume no language or test framework:
 * the acceptance on the reviewed tip (each command, its exit and time), the delivery (scheme, and delivered / not yet /
 * failed / backing off), and the acceptance on the delivered commit. Only what is known is said. Off-plan writes spec W3
 * (#346): first, one line per task whose landing changed paths outside its targetPaths; then (#341 L2) one per check
 * found already failing before the work, with the person's answer.
 */
export async function reviewFacts(repo: string, body: unknown, tip: string, store: ControlStore, groupId: string): Promise<string[]> {
  // Pre-existing failures spec L2 (#341): each check already red before the work, and the person's answer to it.
  const lines: string[] = [...offPlanFactLines(store, groupId), ...preexistingFailureFactLines(store, groupId, body)];
  const short = (commit: string): string => commit.slice(0, 12);
  const commandLines = (commands: ReadonlyArray<{ command: string; exit: string; ms: number }>) =>
    commands.map((c) => `  - \`${cutUtf8(c.command, 300)}\` -> exit ${c.exit} (${c.ms} ms)`);
  const accepted = acceptanceOf(body);
  // #337 §4.4: a folder or multi-directory group's acceptance is not run, and the line says why in words.
  if (accepted !== null && accepted.result === "not-run" && (accepted.why === "dir" || accepted.why === "multi-repo")) lines.push(NOT_RUN_ACCEPTANCE_LINE);
  else if (accepted !== null && (accepted.tip === tip || accepted.tip === null)) {
    lines.push(`Acceptance on the reviewed tip ${short(tip)}: ${accepted.result}${accepted.why === undefined ? "" : ` (${accepted.why})`}`, ...commandLines(accepted.commands));
    const suite = accepted.fullSuite;
    if (suite?.command != null) {
      lines.push(`  full suite \`${cutUtf8(suite.command, 300)}\`: exits ${suite.exits.join(", ") || "none"}${suite.baseline === undefined ? "" : `; at the group's base: exits ${suite.baseline.exits.join(", ")}`}`);
      // Tester #391: a red (or flaky) full suite's failing tests, on both sides, so the reviewer can compare them -- and an
      // explicit statement when the recorded 2 KB names none, which is common: the runner's summary is all that is left.
      if (suite.flaky || suite.exits.some((exit) => exit !== "0")) {
        // Review of #383: flaky because task runs reported it red, with both confirmation runs green -- no tip run failed,
        // so the label must not claim failing tests.
        const redOnTip = suite.exits.some((exit) => exit !== "0");
        const comparison = accepted.identityComparisons?.find((item) => item.command === suite.command);
        lines.push(`  ${redOnTip ? "failing tests on this tip" : "confirmation-run output on this tip"}: ${recordedFailureNames(redOnTip ? comparison?.tipIdentities : undefined, accepted.tail)}`);
        if (suite.baseline !== undefined || comparison?.baseIdentities.length) {
          lines.push(`  failing tests at the group's base: ${recordedFailureNames(comparison?.baseIdentities, suite.baseline?.tail)}`);
        }
      }
    }
  }
  // #337 §4.1, §4.4: Orca places a folder or multi-directory group's work itself; what this review sees of the folder.
  if (noteGroup(store, groupId)) { lines.push(PLACED_DELIVERY_LINE, ...folderFactLines(body)); return lines; }
  const integration = readGroupIntegration(body);
  if (integration === null) { lines.push(`Delivery: none configured -- the work stays on orca/<group>.`); return lines; }
  const scheme = integration.scheme;
  if (scheme.delivery === "keep") { lines.push(`Delivery: none configured -- the work stays on orca/<group>.`); return lines; }
  // Working-tree delivery spec §4.6: written into the registered checkout, uncommitted; there is no target branch.
  const into = scheme.delivery === "working-tree" ? "the registered working tree (uncommitted)" : scheme.target;
  lines.push(`Delivery scheme: ${scheme.delivery}${"method" in scheme ? ` ${scheme.method}` : ""} into ${into}${"remote" in scheme ? ` on ${scheme.remote}` : ""}`);
  const delivered = integration.historyPublished !== undefined ? integration.historyPublished.groupTip === tip
    : integration.lastIntegrated === tip && integration.pending === null;
  if (integration.state === "blocked" || integration.state === "conflict") lines.push(`- not delivered: ${integration.state} (${integration.reason ?? "no reason recorded"})`);
  else if (delivered && integration.integratedCommit !== null) {
    let parents = "?";
    try { parents = String((await gitOk(repo, ["rev-list", "--parents", "-n", "1", integration.integratedCommit])).trim().split(/\s+/).length - 1); } catch { /* named as unknown */ }
    lines.push(`- delivered as ${integration.integratedCommit} (${parents} parents) on ${into}${integration.pr === null ? "" : `; pull request #${integration.pr.number} (${integration.pr.ready ? "ready" : "draft"}) ${integration.pr.url}`}`);
  } else if (delivered) lines.push(scheme.delivery === "working-tree" ? `- delivered: the tip ${short(tip)} was written into the working tree, uncommitted` : `- delivered: the tip ${short(tip)} is in ${into}`);
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

/** #337 §4.4: the acceptance line of a folder or multi-directory group (its record is `not-run`, why `dir` / `multi-repo`). */
export const NOT_RUN_ACCEPTANCE_LINE = "Acceptance: not run -- Orca runs no group-wide check on a folder or multi-directory group; each task's own checks ran on its attempt.";
/** #337 §4.4: the delivery line of a folder or multi-directory group. */
export const PLACED_DELIVERY_LINE = "Delivery: Orca places the work into the person's folder or branches by itself; this review judges Orca's work branches, not the person's folder or branches.";
const mib = (bytes: number): string => `${bytes / (1024 * 1024)} MiB`;
/** #337 §4.1: what the folder's import leaves out, read from the import's own caps and exclude lists (never typed in). */
export function folderExclusionLine(): string {
  return `Orca's copy of the folder leaves out: any file over ${mib(DEFAULT_CAPS.perFileBytes)} and anything past ${mib(DEFAULT_CAPS.perSnapshotBytes)} in total; `
    + `files the folder's .gitignore excludes; ${DEFAULT_EXCLUDES.join(", ")}; nested repositories and special files; ${DIR_EXCLUDES.map((p) => p.replace(/^\//, "")).join(", ")}. `
    + "A criterion about such a file cannot be judged from this review.";
}
/**
 * #337 §4.1-§4.2: the fact lines of each folder the group writes -- what its import leaves out and the paths placement
 * withheld (they are in the work but not in the person's folder). A multi group's lines name the member.
 */
function folderFactLines(body: unknown): string[] {
  const withheldLine = (value: unknown): string[] => {
    const withheld = readPlacement(value)?.withheld ?? [];
    return withheld.length === 0 ? [] : [`Placement withheld these paths from the folder (they are in the work below but not in the person's folder): ${withheld.slice(0, STOP_KEPT).map((w) => w.path).join(", ")}`];
  };
  const multi = multiDirOf(body);
  if (multi === null) return dirWorkspaceOf(body) === null ? [] : [folderExclusionLine(), ...withheldLine((body as { placement?: unknown }).placement)];
  const placements = (multi.landing as { placement?: Record<string, unknown> } | null)?.placement ?? {};
  return multi.dirs.filter((member) => member.kind === "dir")
    .flatMap((member) => [folderExclusionLine(), ...withheldLine(placements[member.key])].map((line) => `Directory ${member.key} (folder): ${line}`));
}

const reviewIdentity = (run: SingleCallRunRow): { roundNo: number; tip: string; tips?: Record<string, string> } => {
  const r = run.requirementReview as { roundNo?: unknown; tip?: unknown; tips?: unknown } | undefined;
  if (typeof r?.roundNo !== "number" || typeof r.tip !== "string") throw new ControlError("recovery-blocked", "requirement-review-identity");
  // #337 §4.2: a multi-directory group's call names each member's tip.
  const tips = r.tips !== null && typeof r.tips === "object" && Object.values(r.tips).every((v) => typeof v === "string") ? r.tips as Record<string, string> : undefined;
  return { roundNo: r.roundNo, tip: r.tip, ...(tips === undefined ? {} : { tips }) };
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Tester #377 (human ruling, session 3ba26002: 「同意」; follow-up G spec, Correction of 2026-11-19): the not-met criteria of
 * a round on `tip` that fail only because the repository was already red at the group's base. Code decides from Orca's
 * own records (Rule 5); the reviewer's verdict is kept as given. A criterion qualifies when every evidence item it names is
 * the acceptance record (none a delivered file), its agreed text names the full-suite command, the acceptance on this tip
 * is `passed-relative` with a base run, every suite run on the tip exited non-zero with an exit the base also gave (the
 * base red on every run), every other command on the tip exited 0, and no person answered that command's pre-existing
 * failure `allow-fix`. This function still compares exits only, never test identities: #391 shows the failing names to the
 * reviewer as a reference, but a relative pass is decided by acceptance's rule (tip red + base red), so names that do not
 * line up cannot turn it into cannot-judge. Review of #377: the text must name the command as a whole (namesCommand), and
 * only numeric exits qualify.
 */
export function relativePasses(body: unknown, tip: string, criteria: ReadonlyArray<CriterionVerdict>, texts: ReadonlyArray<{ id: string; text: string }>): RelativePass[] {
  const accepted = acceptanceOf(body);
  if (accepted === null || accepted.tip !== tip || accepted.result !== "passed-relative") return [];
  const suite = accepted.fullSuite, command = suite?.command, base = suite?.baseline;
  if (typeof command !== "string" || command.trim() === "" || base === undefined) return [];
  // Review of #377 (M5): only numeric non-zero exits qualify, on either side -- a timeout is not "the same failure".
  const red = (exit: string): boolean => /^[0-9]+$/.test(exit) && exit !== "0";
  if (base.exits.length === 0 || !base.exits.every(red)) return [];
  if (suite!.exits.length === 0 || suite!.exits.some((exit) => !red(exit) || !base.exits.includes(exit))) return [];
  if (accepted.commands.some((c) => c.command !== command && !c.command.startsWith("baseline: ") && c.exit !== "0")) return [];
  const answers = (body as { preexistingFailureAnswers?: Record<string, { answer?: unknown } | undefined> } | null)?.preexistingFailureAnswers;
  if (answers?.[command]?.answer === "allow-fix") return [];
  return criteria.filter((c) => c.verdict === "not-met" && c.evidence.length > 0 && c.evidence.every((e) => e.path === "orca:acceptance")
    && namesCommand(texts.find((t) => t.id === c.id)?.text ?? "", command))
    .map((c) => ({ criterionId: c.id, command, tipExits: [...suite!.exits], baseExits: [...base.exits] }));
}

/**
 * Review of #377 (I1): whether `text` names `command` as a whole. Before it: the start, whitespace, a backtick, a quote or
 * an opening bracket -- never a letter, digit, `:`, `-`, `/` or `.` (`pnpm test` does not name `npm test`). After it: the
 * end, a backtick, a closing quote or bracket, sentence punctuation that ends there (followed by the end, whitespace or a
 * closing mark -- so `test:e2e` and `test.js` do not qualify), or whitespace and then a word of letters only (prose such as
 * "exits"; an argument such as `-- file`, `tests/x.py` or `2>&1` does not qualify).
 */
export function namesCommand(text: string, command: string): boolean {
  const closing = "`\"'”」）)";
  for (let at = text.indexOf(command); at !== -1; at = text.indexOf(command, at + 1)) {
    if (at > 0 && !/[\s`"'“「（(]/u.test(text[at - 1]!)) continue;
    const rest = text.slice(at + command.length);
    if (rest === "" || closing.includes(rest[0]!)) return true;
    if (/^[.,;:!?。，；：！？](?:$|\s|[`"'”」）)])/u.test(rest)) return true;
    if (/^\s+\p{L}+(?:$|\s|[.,;:!?。，；：！？`"'”」）)])/u.test(rest)) return true;
  }
  return false;
}

/**
 * §3.2 bounded: the changed files (path, status, bytes and sha256 each; for #337 also what binaryFacts reads from the
 * header, which the prompt shows for a binary file) and the text diff cut at the bound.
 */
async function groupChanges(repo: string, base: string, tip: string, excluded: readonly string[] = [], maxBytes = REVIEW_DIFF_MAX_BYTES): Promise<{ changedFiles: ChangedFile[]; diff: string; truncated: boolean }> {
  // #334: the file lists grow with the number of files (a 12-task merge group changed 2,449), not with their size; they
  // get the same room as the blobs below instead of Node's default 1 MiB.
  const listed = { maxBuffer: REVIEW_GIT_LIST_MAX_BYTES };
  // #337 §4.1: Orca's own files in a folder's vault (its ledger, the requirement document) are not the work: left out of
  // the change list and the diff alike. A repository group passes none (its pathspec is absent, its commands unchanged).
  const spec = excluded.length === 0 ? [] : ["--", ".", ...excluded.map((path) => `:(exclude,literal)${path}`)];
  const numstat = (await git(repo, [...QUIET_GIT, "diff", "--numstat", "-z", "--no-renames", `${base}..${tip}`, ...spec], listed)).split("\0").filter((s) => s.length > 0);
  const status = new Map((await git(repo, [...QUIET_GIT, "diff", "--name-status", "--no-renames", `${base}..${tip}`, ...spec], listed)).split("\n").filter((l) => l.length > 0)
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
  const read = await gitPrefix(repo, [...QUIET_GIT, "diff", "--no-color", "--no-renames", `${base}..${tip}`, ...spec], maxBytes + 4);
  const text = read.stdout.toString("utf8");
  const truncated = read.truncated || Buffer.byteLength(text, "utf8") > maxBytes;
  return { changedFiles, diff: truncated ? cutUtf8(text, maxBytes) : text, truncated };
}

/**
 * #337 §4.1-§4.2: Orca's own paths in a group's work -- its `.decisions/` ledger and the requirement document. #382: a
 * repository group's document lives under `.orca/requirements/` (requirementExport.ts), and both are Orca's runtime files,
 * never the group's deliverables, so they are excluded from a repository group's diff too (not only a folder's).
 */
function orcaOwnPaths(body: unknown, folder: boolean): string[] {
  const document = (body as { requirement?: { export?: { path?: unknown } } } | null)?.requirement?.export?.path;
  return [...DIR_EXCLUDES.map((p) => p.replace(/^\/|\/$/g, "")),
    ...(folder ? (typeof document === "string" && document.length > 0 ? [document] : []) : [ORCA_REQUIREMENT_DIR])];
}
/** #382: where a repository group's requirement document is committed; Orca's, not a deliverable. */
export const ORCA_REQUIREMENT_DIR = ".orca/requirements";
/** #382: said in every review prompt, so a criterion is never failed for Orca's own files appearing in the work. */
export const ORCA_RUNTIME_FILES_NOTE = "Orca's own runtime files -- `.decisions/` and `.orca/requirements/` -- are not deliverables: they are excluded from the changed files and the diff below, and their presence must never fail a criterion.";

/** #337 §4.2: each member's base -- the `drive.dirs[]` base on the group's first work run (rowid order) that wrote it. */
function memberBases(store: ControlStore, groupId: string): Map<string, string> {
  const bases = new Map<string, string>();
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: string; drive?: { dirs?: Array<{ key?: unknown; base?: unknown }> } };
    if (run.phase !== "work" || !Array.isArray(run.drive?.dirs)) continue;
    for (const dir of run.drive.dirs) if (typeof dir.key === "string" && typeof dir.base === "string" && !bases.has(dir.key)) bases.set(dir.key, dir.base);
  }
  return bases;
}

/**
 * #337 §4.2, §7: a multi-directory group's sections in registered order. Each changed member gets an equal part of
 * REVIEW_DIFF_MAX_BYTES, so one large directory cannot hide the others; the `.decisions/` filter applies to the primary
 * and to every folder member, the requirement document's to every folder member.
 */
async function memberDirectories(resolveRepository: (repoId: string) => string, store: ControlStore, groupId: string, body: unknown, multi: FrozenMultiDir, tips: Readonly<Record<string, string>>): Promise<ReviewDirectory[]> {
  const bases = memberBases(store, groupId);
  const changed = multi.dirs.filter((member) => tips[member.key] !== undefined && bases.has(member.key) && bases.get(member.key) !== tips[member.key]);
  const share = Math.floor(REVIEW_DIFF_MAX_BYTES / Math.max(1, changed.length));
  const out: ReviewDirectory[] = [];
  for (const [index, member] of multi.dirs.entries()) {
    const tip = tips[member.key];
    if (tip === undefined) { out.push({ key: member.key, state: "gone" }); continue; }
    if (!changed.includes(member)) { out.push({ key: member.key, state: "unchanged" }); continue; }
    const base = bases.get(member.key)!, folder = member.kind === "dir";
    const repo = resolveRepository(dirTargetRepoId(store, groupId, member.key));
    const changes = await groupChanges(repo, base, tip, folder || index === 0 ? orcaOwnPaths(body, folder) : [], share);
    out.push({ key: member.key, state: "changed", kind: folder ? "folder" : "repository", base, tip, share, ...changes });
  }
  return out;
}

/** #334: room for the changed-file lists and one blob read (the cat-file bound this file always gave). */
const REVIEW_GIT_LIST_MAX_BYTES = 256 * 1024 * 1024;

/** Tester #358: ccloop's code for a single-call answer it could not read as one JSON object of the asked shape. */
export const REVIEW_SHAPE_FAILURE = "single-call-output-invalid";
/**
 * Review of D3 (I3): ccloop's codex refusals of an answer given more than once -- an earlier agent message that is itself
 * an object (`:messages`) or a second completed turn (`:turns`). `:tool` (the model ran a tool) is not asked again.
 */
export const REVIEW_REPEATED_ANSWER_CODES: ReadonlySet<string> = new Set(["codex-single-call-not-single:messages", "codex-single-call-not-single:turns"]);

/**
 * Tester #358, review of D3 (I3): a review call whose answer says nothing about the work because of its shape -- no single
 * object of the asked shape, or the answer printed twice. ccloop's omp adapter also answers `single-call-output-invalid`
 * when the model stopped at its output-token cap (`stopReason === "length"`); ccloop's record carries the same code and no
 * cause for both, so Orca cannot tell that one apart, and its one re-ask may hit the same cap (bounded: once a round).
 */
export function reviewShapeFailure(failure: string | null, facts: SingleCallRecordFacts | undefined): boolean {
  return failure === REVIEW_SHAPE_FAILURE || (typeof facts?.errorCode === "string" && REVIEW_REPEATED_ANSWER_CODES.has(facts.errorCode));
}

/**
 * Tester #358 (plan 2026-11-18 batch D, D3): in the failed call's settlement transaction (already billed), a second call of
 * the same round on the same work item -- only when this was the round's first call, the group is neither archived nor
 * stopping, and it can still fund a review. Answers whether it was claimed; when not, the round settles as before.
 */
function askReviewAgain(store: ControlStore, runRow: SingleCallRunRow, roundNo: number, tip: string, contract: Record<string, unknown> | null, tips?: Record<string, string>): boolean {
  const { groupId, workItemId } = runRow;
  if (Number(store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id=? AND work_item_id=?").get(groupId, workItemId)!.n) !== 1) return false;
  if (isGroupArchived(store, groupId) || store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) return false;
  const funded = boundedGroupGrant(store, groupId, { ...REQUIREMENT_REVIEW_GRANT }, REVIEW_FLOOR_TOKENS, store.now());
  if ("unfunded" in funded) return false;
  const reviewer = reviewerOf(store, groupId);
  const note = typeof contract?.note === "string" ? { note: contract.note } : {};
  // #337 §4.2: the same round on the same tips as the call it replaces.
  const ofTips = tips === undefined ? {} : { tips };
  claimGroupSingleCallInTransaction(store, { groupId, workItemId, purpose: "requirement-review",
    identity: { requirementReview: { roundNo, tip, ...ofTips } }, slot: reviewer.slot, profile: reviewer.profile, grant: funded.grant,
    contract: { schema: "orca-requirement-review-contract-v1", roundNo, tip, ...ofTips, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS, ...note } });
  return true;
}

interface ReviewSettled { classified: ReturnType<typeof classifyReviewOutput> | null; failure: string | null }

export const REQUIREMENT_REVIEW_HANDLER: SingleCallHandler = {
  purpose: "requirement-review",
  async prepare(deps, run) {
    const { tip, tips } = reviewIdentity(run);
    const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(run.groupId)!.body));
    const inputs = reviewInputsOf(deps.store, run.groupId, body);
    const contract = readGroupCallContract(deps.store, run.groupId, run.workItemId);
    // #337 §4.2: a multi-directory group is one call with a section per member; §4.1: a folder group's own files are left out.
    const multi = multiDirOf(body), folder = dirWorkspaceOf(body) !== null;
    const repo = multi === null ? deps.resolveRepository(groupRepoId(deps.store, run.groupId)) : "";
    const changes = multi !== null
      ? { changedFiles: [], diff: "", truncated: false, directories: await memberDirectories(deps.resolveRepository, deps.store, run.groupId, body, multi, tips ?? {}) }
      // #382: a repository group excludes Orca's own runtime files too, not only a folder group.
      : { ...await groupChanges(repo, groupBaseCommit(deps.store, run.groupId), tip, orcaOwnPaths(body, folder)), ...(folder ? { folder } : {}) };
    const facts = await reviewFacts(repo, body, tip, deps.store, run.groupId);
    const acceptance = acceptanceOf(body);
    // Tester #391: a red or flaky suite's tails go to the prompt in every such case, not only for passed-relative -- the
    // base exits are there only when the base was red too.
    const suite = acceptance?.tip === tip ? acceptance.fullSuite : undefined;
    const comparison = acceptance?.identityComparisons?.find((item) => item.command === suite?.command);
    const suiteRed = suite !== undefined && suite.command !== null && (suite.flaky || suite.exits.some((exit) => exit !== "0"));
    const acceptanceBaseline: AcceptanceBaseline | undefined = suite === undefined || suite.command === null || !suiteRed ? undefined : {
      command: suite.command, tipExits: [...suite.exits], ...(suite.flaky ? { flaky: true } : {}),
      ...(suite.reported === undefined ? {} : { reported: suite.reported }),
      ...(acceptance?.tail === undefined ? {} : { tipTail: cutUtf8(acceptance.tail, 2_000) }),
      ...(comparison === undefined ? {} : { tipIdentities: comparison.tipIdentities, baseIdentities: comparison.baseIdentities }),
      ...(suite.baseline === undefined ? {} : { baseExits: [...suite.baseline.exits], ...(suite.baseline.tail === undefined ? {} : { baseTail: cutUtf8(suite.baseline.tail, 2_000) }) }),
    };
    return {
      prompt: buildReviewPrompt({ ...inputs, ...changes, facts, ...(typeof contract?.note === "string" ? { note: contract.note } : {}),
        acceptanceFailed: acceptance?.result === "failed", ...(acceptanceBaseline === undefined ? {} : { acceptanceBaseline }) }),
      responseSchema: { ...requirementReviewResponseSchema }, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    };
  },
  async evaluate(deps, run, rawOutput, failure = null) {
    if (failure !== null) return { classified: null, failure } satisfies ReviewSettled;
    const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(run.groupId)!.body));
    const dirKeys = multiDirOf(body)?.dirs.map((member) => member.key);
    const classified = classifyReviewOutput(rawOutput, reviewInputsOf(deps.store, run.groupId, body).criteria.map((c) => c.id), dirKeys);
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
  complete(deps, runRow, settled, commitTerminal, failure = null, facts) {
    const release = deps.admissionGate?.enter();
    try { deps.store.transaction(() => REQUIREMENT_REVIEW_HANDLER.completeInTransaction!(deps.store, runRow, settled, commitTerminal, failure, facts)); }
    finally { release?.(); }
  },
  completeInTransaction(store, runRow, settled, commitTerminal, failure = null, facts) {
    const { roundNo, tip, tips } = reviewIdentity(runRow);
    const contract = readGroupCallContract(store, runRow.groupId, runRow.workItemId);
    const grant = (contract?.grant as { work?: Amount } | undefined)?.work;
    if (grant === undefined) throw new ControlError("recovery-blocked", "requirement-review-contract");
    if (completeGroupSingleCallInTransaction(store, runRow, grant, commitTerminal, REQUIREMENT_REVIEW_USAGE_UNKNOWN) === null) return;
    const answer = (settled as ReviewSettled | null)?.classified ?? null;
    const failed = failure ?? (settled as ReviewSettled | null)?.failure ?? null;
    const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(runRow.groupId)!.body));
    const current = reviewOf(body) ?? { state: "reviewing" as const, rounds: [], autoFixRounds: 0 };
    // Tester #358: an answer in a broken shape says nothing about the work; the round's call is asked once more, and the
    // activity says so (review of D3).
    if (reviewShapeFailure(failed, facts) && current.state === "reviewing" && askReviewAgain(store, runRow, roundNo, tip, contract, tips)) {
      recordActivity(store, { groupId: runRow.groupId, runId: runRow.runId, kind: "requirement-review", body: { roundNo, result: "asked-again", tip, state: current.state, failure: facts?.errorCode ?? failed } });
      return;
    }
    // Tester #377: a not-met criterion red only because the base was red is a relative pass; when every not-met one is,
    // the round passes (the reviewer's verdicts are kept, and the round names each relative pass).
    const relative = failed === null && answer !== null && answer.result === "not-met"
      ? relativePasses(body, tip, answer.criteria, reviewInputsOf(store, runRow.groupId, body).criteria) : [];
    const allRelative = relative.length > 0 && answer !== null && answer.result === "not-met"
      && answer.criteria.every((c) => c.verdict !== "not-met" || relative.some((r) => r.criterionId === c.id));
    const result: ReviewRoundResult = failed !== null || answer === null ? "failed" : allRelative ? "passed" : answer.result;
    const conflict = answer !== null && answer.result !== "invalid" && result === "not-met" ? answer.checkConflict : undefined;
    const round: ReviewRound = { roundNo, tip, runId: runRow.runId, at: store.now(), result,
      criteria: answer !== null && answer.result !== "invalid" ? answer.criteria : [],
      summary: failed !== null ? `review call failed: ${failed}` : answer === null ? "no answer" : answer.result === "invalid" ? `answer invalid: ${answer.reason}`
        : conflict === undefined ? answer.summary : `check conflict reported for ${conflict.criterionId}: ${cutUtf8(conflict.requiredCheck, 200)}; ${cutUtf8(conflict.because, 500)}. No automatic fix; review the person's restriction and the check.`,
      ...(current.rerun === undefined ? {} : { note: current.rerun.note }),
      // Tester #340: kept as data, not only in the summary sentence.
      ...(conflict === undefined ? {} : { checkConflict: { criterionId: conflict.criterionId, requiredCheck: cutUtf8(conflict.requiredCheck, 4096), because: cutUtf8(conflict.because, 4096) } }),
      ...(relative.length === 0 ? {} : { relativePass: relative }) };
    const { rerun: _rerun, why: _why, ...rest } = current;
    const testChangeOnly = result === "not-met" && conflict === undefined && testChangeOnlyReview(body, round);
    let next: RequirementReview = { ...rest, rounds: [...current.rounds, round], state: "passed" };
    if (result !== "passed") {
      if (testChangeOnly) next = { ...next, state: "not-passed", why: "test-change-only" };
      else if (conflict === undefined) next = settleNotPassed(store, runRow.groupId, next, round);
      // Tester #340: a definite not-met that conflicts with the person's restriction -- the person decides which gives way.
      // Tester #502: the same round can also carry a plan-level not-met. Record it as left to a person here (the shared
      // rule settleNotPassed uses) before the conflict branch, so review-fix/review-accept do not hide the one step that
      // can change the plan (`orca requirement open`).
      else {
        const left = leftToPersonOf(round);
        if (left.length > 0) round.leftToPerson = left;
        next = { ...next, state: "not-passed", why: "check-conflict" };
      }
    }
    // #337 §5.1: before both the save and the activity, so the activity names the state saved.
    next = settledReview(store, runRow.groupId, next);
    saveReview(store, runRow.groupId, next);
    recordActivity(store, { groupId: runRow.groupId, kind: "requirement-review", body: { roundNo, result, tip, state: next.state, ...(round.fixTaskId === undefined ? {} : { action: "fix-opened", taskId: round.fixTaskId }),
      ...(relative.length === 0 ? {} : { relativePass: relative.map((r) => r.criterionId) }) } });
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
    // Tester #377: a relative pass does not count as not-met.
    const notMet = notMetOf(round);
    const left = leftToPersonOf(round);
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

/** The round's criteria that are not met, a relative pass aside (tester #377). One rule for every caller (tester #502). */
function notMetOf(round: ReviewRound): ReviewRound["criteria"] {
  return round.criteria.filter((c) => c.verdict === "not-met" && !isRelativePass(round, c.id));
}

/** Tester #343: the not-met criteria no work fix covers, with who can meet them; shared by settleNotPassed and a
 * check-conflict round (tester #502) so a plan-level finding is recorded in both shapes. */
function leftToPersonOf(round: ReviewRound): string[] {
  return notMetOf(round).filter((c) => (c.fixableBy ?? "work") !== "work").map((c) => c.id);
}

function testChangeOnlyReview(body: unknown, round: ReviewRound): boolean {
  const paths = new Set(acceptanceOf(body)?.testChanges?.paths ?? []);
  const notMet = round.criteria.filter((criterion) => criterion.verdict === "not-met");
  return paths.size > 0 && notMet.length > 0 && notMet.every((criterion) => criterion.evidence.length > 0 && criterion.evidence.every((evidence) => paths.has(evidence.path)));
}

const isRelativePass = (round: ReviewRound, criterionId: string): boolean => (round.relativePass ?? []).some((r) => r.criterionId === criterionId);

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

/** #337 §5.4: a path a finding names may enter a write set -- a target shape, no segment starting with `-`, not `**` alone. */
const writablePath = (path: string): boolean => path !== "**" && !path.split("/").some((segment) => segment.startsWith("-")) && targetShapeOk(path);

/**
 * #337 §5.4b (I-4): a multi-directory group's fix write set from its not-met findings, by member key -- the `<key>:<path>`
 * tokens each `missing` text names (a backticked span, or a bare `key:path` run, its key a member's; the path then takes
 * missingTextPaths's rules), then the evidence's. The three record paths are dropped by exact match, so a member keyed
 * `orca` keeps its `orca:<path>` files. A token with no known key is ignored.
 */
export function multiFixPaths(unmet: ReadonlyArray<{ readonly evidence: ReadonlyArray<{ readonly path: string }>; readonly missing: string | null }>, keys: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, path: string): void => { const list = out.get(key) ?? []; if (!list.includes(path)) list.push(path); out.set(key, list); };
  for (const c of unmet) {
    if (c.missing === null) continue;
    for (const match of c.missing.matchAll(/`([^`]*)`|([A-Za-z0-9._-]+):([A-Za-z0-9._/*-]+)/g)) {
      const found = match[1] !== undefined ? dirEvidence(match[1].trim(), keys) : dirEvidence(`${match[2]}:${match[3]}`, keys);
      if (found === null) continue;
      for (const path of missingTextPaths(match[1] !== undefined ? `\`${found.path}\`` : found.path)) add(found.key, path);
    }
  }
  for (const c of unmet) for (const e of c.evidence) {
    if (REVIEW_RECORD_PATHS.has(e.path)) continue;
    const found = dirEvidence(e.path, keys);
    if (found !== null && writablePath(found.path)) add(found.key, found.path);
  }
  return out;
}

/**
 * #337 §5.3 (C-1): a multi-directory group's fix task, from stored records only (a split needs ccloop and resolved paths).
 * Writes per member: the paths the findings name (multiFixPaths), else every member some task wrote with the union of its
 * stored `writes[].targetPaths`; each member's checks are the union of the tasks' `writes[].checks` for it, the base-red
 * suite left out as fixTaskContract leaves it out. The primary is the first written member in registered order and must
 * have checks (multi spec §6.1), else `multi-fix-checks:<key>`. The contract is fixTaskContract's (objective, goal,
 * policies) with the primary's paths, checks, allow and deny lists, and one additionalRepos entry per other member.
 */
export function multiFixTask(store: ControlStore, groupId: string, round: ReviewRound, criteria: ReadonlyArray<{ id: string; text: string }>, taskId: string, sourceId: string,
  goal?: string, paths?: readonly string[]): { contract: ReturnType<typeof fixTaskContract>; writes: TaskWrite[] } | { refused: string } {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as unknown;
  const multi = multiDirOf(body)!;
  const keys = multi.dirs.map((member) => member.key);
  const plan = readArchivedPlan(store, groupId);
  const appended = new Set(plan.appendedTaskIds ?? []);
  const tasks = plan.plan.tasks.filter((task) => !appended.has(task.taskId)).map((task) => {
    const writes = taskWrites(store, groupId, task.taskId) ?? [];
    const contract = readArchivedContract(store, groupId, task.taskId).contract;
    const written = [...writes].sort((l, r) => keys.indexOf(l.dir) - keys.indexOf(r.dir));
    return { writes, contract, primary: (contract.context as { repoKey?: string }).repoKey ?? written[0]?.dir ?? keys[0]! };
  });
  const accepted = acceptanceOf(body);
  const baseRed = accepted?.result === "passed-relative" && accepted.fullSuite?.baseline !== undefined ? accepted.fullSuite.command : null;
  const unmet = round.criteria.filter((c) => c.verdict === "not-met");
  const named = paths !== undefined && paths.length > 0 ? multiFixPaths([{ evidence: paths.map((path) => ({ path })), missing: null }], keys) : multiFixPaths(unmet, keys);
  const byKey = new Map<string, string[]>();
  if (named.size > 0) for (const [key, list] of named) byKey.set(key, list);
  else for (const task of tasks) for (const w of task.writes) byKey.set(w.dir, [...new Set([...(byKey.get(w.dir) ?? []), ...w.targetPaths])]);
  const checksOf = (key: string): string[] => [...new Set(tasks.flatMap((task) => task.writes.filter((w) => w.dir === key).flatMap((w) => w.checks)))].filter((check) => check !== baseRed);
  const writes: TaskWrite[] = keys.filter((key) => byKey.has(key)).map((key) => ({ dir: key, targetPaths: byKey.get(key)!, checks: checksOf(key) }));
  if (writes.length === 0) return { refused: "multi-fix-writes" };
  const primary = writes[0]!;
  if (primary.checks.length === 0) return { refused: `multi-fix-checks:${primary.dir}` };
  // Any archived contract that names the member: its repoPath (A2 replaces it with the run's own workspace anyway).
  const repoPathOf = (key: string): string => {
    for (const task of tasks) {
      const context = task.contract.context as { repoPath: string; additionalRepos?: Array<{ key: string; repoPath: string }> };
      if (task.primary === key) return context.repoPath;
      const extra = context.additionalRepos?.find((repo) => repo.key === key);
      if (extra !== undefined) return extra.repoPath;
    }
    return (tasks.find((task) => task.contract.objective.taskId === sourceId)?.contract.context as { repoPath: string } | undefined)?.repoPath ?? key;
  };
  const base = fixTaskContract(store, groupId, round, criteria, taskId, sourceId, goal, primary.targetPaths);
  const { repoKey: _key, additionalRepos: _extras, ...context } = base.context as typeof base.context & { repoKey?: string; additionalRepos?: unknown };
  const extras = writes.slice(1).map((w) => ({ key: w.dir, repoPath: repoPathOf(w.dir), targetPaths: w.targetPaths, allowlistPaths: w.targetPaths, requiredChecks: w.checks }));
  const owners = tasks.filter((task) => task.primary === primary.dir);
  const contract = taskContractSchema.parse({
    ...base,
    context: { ...context, repoPath: repoPathOf(primary.dir), targetPaths: primary.targetPaths, ...(extras.length === 0 ? {} : { repoKey: primary.dir, additionalRepos: extras }) },
    safetyPolicy: { ...base.safetyPolicy, allowlistPaths: fixTaskAllowlist(owners.map((task) => task.contract.safetyPolicy.allowlistPaths), primary.targetPaths),
      denylistPaths: [...new Set(owners.flatMap((task) => task.contract.safetyPolicy.denylistPaths))] },
    verification: { ...base.verification, requiredChecks: primary.checks },
  });
  return { contract, writes };
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
/**
 * The ceiling: twice the tokens the source task's runs used, at least AUTO_FIX_MIN_TOKENS, never above the source's own grant.
 * Tester #377 (stuck-runs spec Correction of 2026-11-19): nor above `groupLeftTokens`, what the group can still fund for the
 * fix's work (null: no token limit) -- so the floor holds only when the group can pay it.
 */
export function autoFixTokenCeiling(used: number, sourceGrantTokens: number | null, groupLeftTokens: number | null = null): number {
  const ceiling = Math.max(AUTO_FIX_USED_MULTIPLE * used, AUTO_FIX_MIN_TOKENS);
  const bounded = sourceGrantTokens === null ? ceiling : Math.min(sourceGrantTokens, ceiling);
  return groupLeftTokens === null ? bounded : Math.min(groupLeftTokens, bounded);
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
  // Tester #377: nor does it cover a relative pass (red only because the base was red). A person's `review-fix` keeps
  // relative passes in scope by design (review of #377, M3): the person chose to fix, and every not-met criterion is theirs.
  const scope: ReviewRound = auto ? { ...round, criteria: round.criteria.filter((c) => c.verdict !== "not-met" || ((c.fixableBy ?? "work") === "work" && !isRelativePass(round, c.id))) } : round;
  const sourceId = fixSourceTaskId(store, groupId, scope);
  const taskId = fixTaskIdOf(store, groupId, round.roundNo);
  const grant = (readWork(store, groupId, sourceId) as unknown as { grant: { work: BudgetAmount; handoff: Amount } }).grant;
  // Tester #377: what the group's unallocated reserve can fund for the work once the handoff is reserved beside it -- the
  // two allocations appendConfirmedTaskInTransaction checks together. Nothing left: unfunded, as that check would say.
  const reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve.tokens;
  const groupLeft = reserve === null ? null : reserve - grant.handoff.tokens;
  if (auto && groupLeft !== null && groupLeft <= 0) return { refused: "unfunded", detail: "group-budget-unavailable:tokens" };
  const work: BudgetAmount = auto ? { ...grant.work, tokens: autoFixTokenCeiling(taskWorkTokens(store, groupId, sourceId), grant.work.tokens, groupLeft) } : grant.work;
  store.db.exec("SAVEPOINT review_fix");
  try {
    // #337 §5.3: a multi-directory group's fix names the members it writes, stored on its work item for A2.
    let built: { contract: ReturnType<typeof fixTaskContract>; writes?: TaskWrite[] };
    if (isMultiGroup(store, groupId)) {
      const multi = multiFixTask(store, groupId, scope, criteria, taskId, sourceId, goal, paths);
      if ("refused" in multi) throw new ControlError("recovery-blocked", multi.refused);
      built = multi;
    } else built = { contract: fixTaskContract(store, groupId, scope, criteria, taskId, sourceId, goal, paths) };
    appendConfirmedTaskInTransaction(store, groupId, { taskId, contract: built.contract, agentFrom: sourceId,
      // Follow-up L: a person's fix takes the sibling task's work grant as it is -- in an expectation-model group it has no
      // token number (null); `?? 0` made it 0, which deriveContract refuses, so no fix task could open there.
      work, handoff: grant.handoff, dependsOn: [], ...(built.writes === undefined ? {} : { writes: built.writes }) });
    store.db.exec("RELEASE review_fix");
    return { taskId };
  } catch (error) {
    store.db.exec("ROLLBACK TO review_fix"); store.db.exec("RELEASE review_fix");
    if (!(error instanceof ControlError)) throw error;
    return { refused: error.code === "group-budget-unavailable" ? "unfunded" : "failed", detail: error.detail === undefined ? error.code : `${error.code}:${error.detail}` };
  }
}
