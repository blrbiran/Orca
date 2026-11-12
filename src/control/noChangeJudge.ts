import { z } from "zod";
import { frozenWorkAgent } from "./agentFreeze.js";
import { writeArtifact } from "./archive.js";
import { recordActivity } from "./activity.js";
import { groupRepoId } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { boundedGroupGrant, claimGroupSingleCallInTransaction, completeGroupSingleCallInTransaction } from "./groupSingleCall.js";
import { completeNoChangeInTransaction, cutUtf8, noChangeExplanationOf } from "./noChange.js";
import { readWork, saveWork } from "./queries.js";
import { noChangeJudgeWorkItemId, reopenNoChangeTaskInTransaction } from "./reopenTask.js";
import type { SingleCallHandler, SingleCallRunRow } from "./singleCallPurposes.js";
import { readCanonicalRecord } from "./snapshot.js";
import { QUIET_GIT } from "./workspace.js";
import { git } from "../scheduler/gitExec.js";
import type { ArtifactRef } from "./types.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/**
 * Tester follow-up G spec §10.1 (controller's call, overriding §1.1 for command verifiers): a command verifier runs the
 * checks in code and never judges the goal, so a command-verified run that changed nothing gets one cheap single call
 * first -- "is the goal already met in the base tree?" -- on the task's own worker slot, funded by the group. `met`
 * completes the task as no change (the record names the judge); `not-met` and `cannot-judge` re-run the task once in the
 * same group with the judge's finding as its operator note (Part 1.4's core, principal `system`); a second no change
 * stops in Problems as `no-change-twice`. The verdict is classified by code from a strict schema (Rule 5).
 */
export const NO_CHANGE_JUDGE_GRANT: Readonly<Amount> = Object.freeze({ tokens: 200_000, activeMs: 600_000, attempts: 1, sessions: 1 });
export const NO_CHANGE_JUDGE_FLOOR_TOKENS = 20_000;
export const NO_CHANGE_JUDGE_MAX_OUTPUT_TOKENS = 2_000;
/** The base tree's listing is cut at this many paths; the task's own files' contents at this many bytes in all. */
export const JUDGE_BASE_MAX_PATHS = 2_000;
export const JUDGE_BASE_MAX_BYTES = 100_000;
export const NO_CHANGE_JUDGE_USAGE_UNKNOWN = "no-change-judge-usage-unknown";
export const NO_CHANGE_FINDING_MAX_BYTES = 2048;

export type JudgeVerdict = "met" | "not-met" | "cannot-judge";
export const noChangeJudgeResponseSchema: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object", additionalProperties: false, required: ["verdict", "finding"],
  properties: { verdict: { type: "string", enum: ["met", "not-met", "cannot-judge"] }, finding: { type: "string", minLength: 1 } },
});
const judgeOutputSchema = z.object({
  verdict: z.enum(["met", "not-met", "cannot-judge"]),
  finding: z.string().refine((s) => s.trim().length > 0, "finding-empty").refine((s) => Buffer.byteLength(s, "utf8") <= NO_CHANGE_FINDING_MAX_BYTES, "finding-over-2048-bytes"),
}).strict();

/** Code, never the model: an answer that does not parse is `cannot-judge`, which §10.1 treats as `not-met`. */
export function classifyJudgeOutput(raw: unknown): { verdict: JudgeVerdict; finding: string } {
  const parsed = judgeOutputSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  return { verdict: "cannot-judge", finding: `judge output invalid: ${issue.path.join(".") || "(root)"}: ${issue.message}` };
}

export function buildNoChangeJudgePrompt(input: { goal: string; successCondition: string; requiredChecks: readonly string[]; explanation: string | null;
  baseListing: readonly string[]; baseFiles: ReadonlyArray<{ path: string; text: string }>; truncated: boolean }): string {
  return [
    "You are Orca's goal judge for one task. The task's agent finished without changing any file, and the task's required checks passed on the unchanged tree.",
    "Decide whether the task's goal is already met by the repository as it is (its base tree, shown below). Judge only from what is shown.",
    "",
    `Task goal: ${input.goal}`,
    `Success condition: ${input.successCondition}`,
    `Required checks (they passed): ${input.requiredChecks.join(" ; ")}`,
    `The agent's explanation of why nothing needed changing: ${input.explanation ?? "(the agent gave none)"}`,
    "",
    `Files in the base tree (${input.baseListing.length} shown):`,
    ...input.baseListing.map((path) => `- ${path}`),
    "",
    "Contents of the task's own files in the base tree:",
    ...input.baseFiles.flatMap((file) => [`--- ${file.path}`, file.text]),
    ...(input.truncated ? ["", "(The listing or the contents above were cut to fit; what is missing was not shown to you.)"] : []),
    "",
    "Answer with a JSON object {\"verdict\": \"met\" | \"not-met\" | \"cannot-judge\", \"finding\": \"...\"}.",
    "- met: the goal is already met; the finding names where (file and what it does).",
    "- not-met: something the goal needs is missing; the finding says what to change, for the agent that will run the task again.",
    "- cannot-judge: what is shown is not enough to decide; the finding says what you could not see.",
    "The finding is at most 2048 bytes.",
  ].join("\n");
}

type WorkRunBody = { runId: string; groupId: string; taskId: string; state: string; executionProfile?: { profileId?: unknown; profileHash?: unknown }; drive?: Record<string, unknown> & { base?: string | null; noChange?: unknown } };
const readRunJson = (store: ControlStore, runId: string): WorkRunBody => {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) throw new ControlError("run-not-found");
  return JSON.parse(String(row.body));
};
const writeRunJson = (store: ControlStore, run: WorkRunBody): void => { store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId); };
/** The judge's state on the task's work run (driveRecord noChangeJudge), and its block reason when it waits for a person. */
export function setJudgeState(store: ControlStore, workRunId: string, judge: { runId: string | null; state: "pending" | "met" | "not-met" | "cannot-judge" | "failed" | "unfunded"; finding?: string }, blockedReason?: string | null): void {
  const run = readRunJson(store, workRunId);
  run.drive = { ...run.drive!, noChangeJudge: judge, ...(blockedReason === undefined ? {} : { blockedReason }) };
  writeRunJson(store, run);
}

/**
 * The claim, in the caller's transaction (the settle of the task's work run): on the task's frozen work agent and the work
 * run's execution profile, funded by the group within its remainder. `unfunded` names why it could not be funded.
 */
export function claimNoChangeJudgeInTransaction(store: ControlStore, input: { groupId: string; taskId: string; workRunId: string; at: number }): { runId: string } | { unfunded: string } {
  const workRun = readRunJson(store, input.workRunId);
  const profileId = workRun.executionProfile?.profileId, profileHash = workRun.executionProfile?.profileHash;
  if (typeof profileId !== "string" || typeof profileHash !== "string") throw new ControlError("recovery-blocked", "no-change-judge-profile");
  const funded = boundedGroupGrant(store, input.groupId, { ...NO_CHANGE_JUDGE_GRANT }, NO_CHANGE_JUDGE_FLOOR_TOKENS, input.at);
  if ("unfunded" in funded) return funded;
  const agent = frozenWorkAgent(readWork(store, input.groupId, input.taskId));
  const slot = { selection: agent.agent, configHash: agent.configHash, timeoutMs: agent.timeoutMs, killGraceMs: agent.killGraceMs, capabilities: agent.agentCapabilities, partial: {}, provenance: agent.agentProvenance };
  return claimGroupSingleCallInTransaction(store, {
    groupId: input.groupId, workItemId: noChangeJudgeWorkItemId(input.workRunId), purpose: "no-change-judge",
    identity: { noChangeJudge: { taskId: input.taskId, workRunId: input.workRunId } }, slot: slot as never, profile: { profileId, profileHash }, grant: funded.grant,
    contract: { schema: "orca-no-change-judge-contract-v1", taskId: input.taskId, workRunId: input.workRunId, maxOutputTokens: NO_CHANGE_JUDGE_MAX_OUTPUT_TOKENS },
  });
}

/**
 * §10.1, in the settle's own transaction (stepE's onSettled), for a command-verified run whose attempt is a bound no-change
 * proof and whose task is left blocked: a run that follows the judge's own re-run stops as `no-change-twice` (no second
 * judge); otherwise the judge is claimed (`pending`), or the run names why it could not be funded. False when the task
 * is not blocked on a complete settle (D14's empty-result applies as before).
 */
export function routeNoChangeJudgeInTransaction(store: ControlStore, input: { groupId: string; taskId: string; runId: string; at: number }): boolean {
  const work = readWork(store, input.groupId, input.taskId) as unknown as { status: string; lineageRunIds?: string[]; noChangeRerun?: { fromRunId?: string } };
  const run = readRunJson(store, input.runId) as WorkRunBody & { recoverable?: boolean };
  if (work.status !== "blocked" || run.recoverable !== true) return false;
  const rerunOf = work.noChangeRerun?.fromRunId;
  if (typeof rerunOf === "string" && rerunOf !== input.runId && (work.lineageRunIds ?? []).includes(rerunOf)) {
    setJudgeState(store, input.runId, { runId: null, state: "not-met" }, "no-change-twice");
    return true;
  }
  const claimed = claimNoChangeJudgeInTransaction(store, { groupId: input.groupId, taskId: input.taskId, workRunId: input.runId, at: input.at });
  if ("unfunded" in claimed) setJudgeState(store, input.runId, { runId: null, state: "unfunded" }, `no-change-judge-unfunded:${claimed.unfunded}`);
  else setJudgeState(store, input.runId, { runId: claimed.runId, state: "pending" });
  return true;
}

const judgeOf = (run: SingleCallRunRow): { taskId: string; workRunId: string } => {
  const judge = run.noChangeJudge as { taskId?: unknown; workRunId?: unknown } | undefined;
  if (typeof judge?.taskId !== "string" || typeof judge.workRunId !== "string") throw new ControlError("recovery-blocked", "no-change-judge-identity");
  return { taskId: judge.taskId, workRunId: judge.workRunId };
};
/** The grant the judge was claimed with, from its frozen contract (what verifyStoppedSingleCall checks the run against). */
const claimedGrant = (store: ControlStore, run: SingleCallRunRow): Amount => {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='single-call-contract'").get(`single-call-contract:${run.groupId}:${run.workItemId}`);
  if (!row) throw new ControlError("recovery-blocked", "no-change-judge-contract");
  const contract = JSON.parse(readCanonicalRecord(store, String((JSON.parse(String(row.body)) as { contractHash: string }).contractHash))) as { grant?: { work?: Amount } };
  if (contract.grant?.work === undefined) throw new ControlError("recovery-blocked", "no-change-judge-contract");
  return contract.grant.work;
};

const pattern = (target: string): RegExp => new RegExp(`^${target.split("**").map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")}$`);
const touches = (path: string, targets: readonly string[]): boolean =>
  targets.some((target) => path === target || path.startsWith(`${target.replace(/\/+$/, "")}/`) || (target.includes("*") && pattern(target).test(path)));

/** What `evaluate` hands `complete`: the verdict, the agent's explanation, and the acceptance proof written for `met`. */
interface JudgeSettled { verdict: JudgeVerdict; finding: string; explanation: string | null; source: ArtifactRef | null }
const isJudgeSettled = (value: unknown): value is JudgeSettled => typeof value === "object" && value !== null && typeof (value as { verdict?: unknown }).verdict === "string";

export const NO_CHANGE_JUDGE_HANDLER: SingleCallHandler = {
  purpose: "no-change-judge",
  async prepare(deps, run) {
    const { taskId, workRunId } = judgeOf(run);
    const contract = readConfirmedTaskExecution(deps.store, run.groupId, taskId).contract;
    const workRun = readRunJson(deps.store, workRunId);
    const base = workRun.drive?.base;
    if (typeof base !== "string") return { blocked: "no-change-judge-base-missing" };
    let listing: string[] = [], truncated = false;
    const files: Array<{ path: string; text: string }> = [];
    try {
      const repo = deps.resolveRepository(groupRepoId(deps.store, run.groupId));
      const all = (await git(repo, [...QUIET_GIT, "ls-tree", "-r", "--name-only", base])).split("\n").filter((line) => line.length > 0);
      listing = all.slice(0, JUDGE_BASE_MAX_PATHS);
      truncated = all.length > listing.length;
      let budget = JUDGE_BASE_MAX_BYTES;
      for (const path of all.filter((p) => touches(p, contract.context.targetPaths))) {
        const text = await git(repo, [...QUIET_GIT, "show", `${base}:${path}`]);
        if (Buffer.byteLength(text, "utf8") > budget) { files.push({ path, text: cutUtf8(text, budget) }); truncated = true; break; }
        files.push({ path, text });
        budget -= Buffer.byteLength(text, "utf8");
      }
    } catch { truncated = true; }
    return {
      prompt: buildNoChangeJudgePrompt({ goal: contract.objective.goal, successCondition: contract.objective.successCondition, requiredChecks: contract.verification.requiredChecks,
        explanation: await noChangeExplanationOf(deps.store, workRunId), baseListing: listing, baseFiles: files, truncated }),
      responseSchema: { ...noChangeJudgeResponseSchema }, maxOutputTokens: NO_CHANGE_JUDGE_MAX_OUTPUT_TOKENS,
    };
  },
  async evaluate(deps, run, rawOutput, failure = null) {
    const { workRunId } = judgeOf(run);
    const explanation = await noChangeExplanationOf(deps.store, workRunId);
    if (failure !== null) return { verdict: "cannot-judge", finding: `judge call failed: ${failure}`, explanation, source: null } satisfies JudgeSettled;
    const { verdict, finding } = classifyJudgeOutput(rawOutput);
    if (verdict !== "met") return { verdict, finding, explanation, source: null } satisfies JudgeSettled;
    // The acceptance proof, as stepE writes it for a no-change completion, naming the judge (acceptanceEvidence binds it).
    const drive = readRunJson(deps.store, workRunId).drive!;
    const noChange = drive.noChange as { attempt: string };
    const source = await writeArtifact(deps.store, `acceptance-${workRunId}`, Buffer.from(JSON.stringify({ runId: workRunId, checksPassed: true, landing: "no-change", commit: noChange.attempt, noChange,
      decidedBy: "judge", judge: { runId: run.runId, finding }, intent: `drive:${workRunId}` })));
    return { verdict, finding, explanation, source } satisfies JudgeSettled;
  },
  classify: classifyJudgeOutput,
  complete(deps, runRow, settled, commitTerminal, failure = null) {
    const release = deps.admissionGate?.enter();
    try { deps.store.transaction(() => NO_CHANGE_JUDGE_HANDLER.completeInTransaction!(deps.store, runRow, settled, commitTerminal, failure)); }
    finally { release?.(); }
  },
  completeInTransaction(store, runRow, settled, commitTerminal, failure = null) {
    const { taskId, workRunId } = judgeOf(runRow);
    const stopped = completeGroupSingleCallInTransaction(store, runRow, claimedGrant(store, runRow), commitTerminal, NO_CHANGE_JUDGE_USAGE_UNKNOWN);
    if (stopped === null) return;
    const answer: JudgeSettled = isJudgeSettled(settled) ? settled : { ...classifyJudgeOutput(settled), explanation: null, source: null };
    const judgeRun = readRunJson(store, runRow.runId);
    writeRunJson(store, { ...judgeRun, ...{ judgeVerdict: { verdict: answer.verdict, finding: answer.finding, failure } } } as WorkRunBody);
    // A call that failed names its code on the task's run and waits for a person (reopen, or accept as no change).
    if (failure !== null) {
      setJudgeState(store, workRunId, { runId: runRow.runId, state: "failed", finding: answer.finding }, `no-change-judge-failed:${failure}`);
      recordActivity(store, { groupId: runRow.groupId, taskId, runId: workRunId, kind: "no-change-judged", body: { judgeRunId: runRow.runId, verdict: "failed", finding: answer.finding } });
      return;
    }
    if (answer.verdict === "met" && answer.source !== null) {
      store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`acceptance:${workRunId}`, JSON.stringify({ runId: workRunId, accepted: true, source: answer.source }));
      setJudgeState(store, workRunId, { runId: runRow.runId, state: "met", finding: answer.finding });
      completeNoChangeInTransaction(store, { groupId: runRow.groupId, taskId, runId: workRunId, decidedBy: "judge", explanation: answer.explanation, judge: { runId: runRow.runId, finding: answer.finding } });
      return;
    }
    // not-met and cannot-judge (§10.1): re-run the task once in this group with the finding as its note. A group that
    // cannot take the re-run now (stopped, unfunded) keeps the task blocked by name, for a person or an orchestrating agent.
    const state = answer.verdict === "cannot-judge" ? "cannot-judge" : "not-met";
    setJudgeState(store, workRunId, { runId: runRow.runId, state, finding: answer.finding });
    recordActivity(store, { groupId: runRow.groupId, taskId, runId: workRunId, kind: "no-change-judged", body: { judgeRunId: runRow.runId, verdict: answer.verdict, finding: answer.finding } });
    store.db.exec("SAVEPOINT no_change_rerun");
    try {
      reopenNoChangeTaskInTransaction(store, { groupId: runRow.groupId, taskId, runId: workRunId, note: answer.finding, by: "system", commandId: runRow.runId });
      const work = readWork(store, runRow.groupId, taskId);
      saveWork(store, runRow.groupId, { ...work, noChangeRerun: { fromRunId: workRunId, judgeRunId: runRow.runId } } as never);
      store.db.exec("RELEASE no_change_rerun");
    } catch (error) {
      store.db.exec("ROLLBACK TO no_change_rerun"); store.db.exec("RELEASE no_change_rerun");
      if (!(error instanceof ControlError)) throw error;
      setJudgeState(store, workRunId, { runId: runRow.runId, state, finding: answer.finding }, `no-change-not-met:${error.code}`);
    }
  },
  usageUnknownReason: NO_CHANGE_JUDGE_USAGE_UNKNOWN,
};
