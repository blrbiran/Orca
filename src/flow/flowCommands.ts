/**
 * Flow engine spec §14.2 (plan Task 15, C19): the flow control verbs. Every verb is one command on the `@flows` scope,
 * whose revision is always 0 (as the corrections scope): the kernel's own checks guard each act -- a message is deduped
 * by its command id, a plan runs only while it is the newest proposed one, an effect record moves only from `staged`, an
 * ask is answered only while it waits. The kernel works before the ledger's transaction (it writes git and its own
 * rows); the transaction books the outcome, so a replay answers it without acting again.
 *
 * `by`/`via` are CLI v2's attribution of the route (attributionOf): the person, never an agent, and the channel.
 */
import { routedAttributionFor, routedPauseAuthorityFor, routedPersonAuthorityFor } from "../control/commandClient.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "../control/commandLedger.js";
import { ControlError, type KnownControlErrorCode } from "../control/errors.js";
import type { ControlStore } from "../control/store.js";
import { realpath } from "node:fs/promises";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "../control/webProtocol.js";
import { discardEffect, enactEffect } from "./effects.js";
import { advanceRun, answerNeeds, FlowRefusal, latestByStep, loadRun, parkIfHeld, recordRunError, resumeExecution, startFlowRun, stepOf, type FlowDeps } from "./kernel.js";
import { answerAsk } from "./kinds/ask.js";
import { answerFlowClarify, flowClarifyConsensus } from "./kinds/clarify.js";
import type { ExecutionBody } from "./kinds/registry.js";
import { acceptMessage } from "./messages.js";
import { answerFeedbackClarify } from "./feedback/intake.js";
import { holdableAfter } from "./marks.js";
import { planStep } from "./planStep.js";
import { POOL_EXHAUSTED } from "./pool.js";
import { discardPlan, proposePlan, runPlan } from "./rerun.js";
import { appendMessage, getFlowRun, listExecutions } from "./store.js";

export const FLOW_VERBS = ["flow-start", "flow-message", "flow-plan", "flow-rerun", "flow-answer", "flow-effect", "flow-pool", "flow-plan-step"] as const;
export type FlowVerb = (typeof FLOW_VERBS)[number];
export type FlowCommand = Extract<RawAuthorityCommandV1, { verb: FlowVerb }>;
type Result = Extract<CommandSuccessV1["result"], { kind: `flow-${string}` }>;
export interface FlowCommandDeps {
  store: ControlStore; flow(): FlowDeps | null;
  /** Review finding I4: the registered `dir` projects (settings key, folder); absent: none, so no start is accepted. */
  projects?(): ReadonlyArray<{ repoId: string; path: string }>;
  /** Multi-directory projects spec §12: a flow runs on one folder, so a multi-dir project is refused by name. */
  multiDirRepoId?(repoId: string): boolean;
}

/**
 * Review finding I4 (controller's call, flagged for the human): a flow writes into the folder it runs on (copy-back), so
 * it starts only on a registered `dir` project's folder -- never on an arbitrary path a caller names. The run belongs to
 * that project (its settings layer); a `projectId` that names another project is refused.
 */
export async function registeredDirProject(projects: ReadonlyArray<{ repoId: string; path: string }>, dir: string, projectId: string | undefined): Promise<string> {
  const found = await dirProjectOf(projects, dir);
  if (found === null) throw new ControlError("flow-dir-unregistered", `${dir} is not a registered dir project's folder (add it with kind "dir" to the projects file)`);
  if (projectId !== undefined && projectId !== found) throw new ControlError("flow-dir-unregistered", `${dir} is project ${found}, not ${projectId}`);
  return found;
}

/**
 * The registered `dir` project whose folder `dir` is (by real path, NFC), or null. The one resolver a start and the start
 * dialog's presets read share (gaps plan Task 10-B fix round 2), so the dialog shows the presets the start applies.
 */
export async function dirProjectOf(projects: ReadonlyArray<{ repoId: string; path: string }>, dir: string): Promise<string | null> {
  const real = async (path: string): Promise<string | null> => { try { return (await realpath(path)).normalize("NFC"); } catch { return null; } };
  const wanted = await real(dir);
  if (wanted === null) return null;
  for (const project of projects) if (await real(project.path) === wanted) return project.repoId;
  return null;
}

/**
 * Spec Global Constraints' refusal codes, booked under their own names (errors.ts); a refusal with a detail
 * (`role-unresolved:<role>`, `flow-param-invalid:<id>`) keeps it as the error's detail. Any other kernel refusal is
 * `flow-refused` with the kernel's code as the detail, never a 500.
 */
const BOOKED: ReadonlySet<string> = new Set([
  "flow-run-not-found", "flow-step-not-found", "flow-template-invalid", "flow-template-version-missing", "flow-param-invalid", "flow-command-missing", "role-unresolved",
  "flow-profiles-unresolved", "flow-ask-closed", "flow-answer-invalid", "flow-effect-not-staged", "flow-effect-closed", "flow-plan-stale",
  "flow-message-target-missing", "flow-run-stopped", "flow-attachment-invalid",
  // Gaps spec §13: a plan step the choice cannot answer.
  "flow-plan-step-not-candidate",
]);

export function asFlowControlError(error: unknown): unknown {
  if (!(error instanceof FlowRefusal)) return error;
  const colon = error.code.indexOf(":");
  const base = colon === -1 ? error.code : error.code.slice(0, colon);
  const detail = [colon === -1 ? "" : error.code.slice(colon + 1), error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : ""].filter((s) => s !== "").join(": ");
  if (BOOKED.has(base)) return new ControlError(base as KnownControlErrorCode, detail === "" ? undefined : detail);
  return new ControlError("flow-refused", detail === "" ? error.code : `${error.code}: ${detail}`);
}

function success(context: WebCommandContext, result: Result): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    // The `@flows` scope has no revision and no projection (commandLedger.ts settingRevision).
    commandRevision: context.currentCommandRevision, projectionSeq: null,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

/** A replay or a stale revision answers before anything is done; otherwise the kernel acts and its outcome is booked. */
export async function applyFlowCommand(deps: FlowCommandDeps, command: FlowCommand): Promise<CommandSuccessV1 | CommandErrorBodyV1> {
  const replay = preflightWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, command); if (replay) return replay.body;
  let result: Result;
  try {
    const flow = deps.flow();
    if (flow === null) throw new ControlError("flow-unavailable", "this panel runs no flow kernel (no execution driver)");
    result = await act(flow, command, deps.projects ?? (() => []), deps.multiDirRepoId);
  } catch (failure) {
    const error = asFlowControlError(failure);
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
  }
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }) as never, authorityChanged: false,
    apply: (context) => success(context, result),
  }).body;
}

/**
 * Review M4: once the kernel acted (a run started, an answer taken), the command is what it did: a failure while the
 * run is then advanced is the run's -- recorded on it (`lastError`, as the pump records one) -- not the command's.
 */
async function advanceAfter(flow: FlowDeps, flowRunId: string): Promise<void> {
  try { await advanceRun(flow, flowRunId); }
  catch (error) { recordRunError(flow, flowRunId, error instanceof Error ? error.message : String(error)); }
}

async function act(flow: FlowDeps, command: FlowCommand, projects: () => ReadonlyArray<{ repoId: string; path: string }>,
  multiDirRepoId?: (repoId: string) => boolean): Promise<Result> {
  const who = routedAttributionFor(command.commandId) ?? { by: command.actorId, via: "web" };
  switch (command.verb) {
    case "flow-start": {
      const p = command.payload;
      if (p.dir === undefined) throw new ControlError("control-argument-invalid", "phase 1 runs a flow on a folder: give dir");
      // Multi-directory projects spec §12: refused before the folder resolver, which would answer flow-dir-unregistered.
      if (p.projectId !== undefined && (multiDirRepoId?.(p.projectId) ?? false)) throw new ControlError("flow-project-multi-dir-unsupported", p.projectId);
      const projectId = await registeredDirProject(projects(), p.dir, p.projectId);
      const template = p.template.startsWith("builtin/") ? p.template : `builtin/${p.template}`;
      const started = await startFlowRun(flow, {
        templateRef: template, dir: p.dir, params: p.params, by: who.by, operatorId: command.actorId, via: who.via, projectId, ...(p.clarify === undefined ? {} : { clarify: p.clarify }),
        ...(p.pool === undefined ? {} : { pool: p.pool }), ...(p.unattended === undefined ? {} : { unattended: p.unattended }),
        // A retry of this command (lost answer) finds the run it started instead of starting a second one.
        idempotencyKey: command.commandId,
      });
      await advanceAfter(flow, started.flowRunId);
      return { kind: "flow-started", flowRunId: started.flowRunId, groupId: started.groupId };
    }
    case "flow-message": {
      const p = command.payload;
      loadRun(flow.store, p.runId);
      const stored = await acceptMessage(flow, p.runId, { kind: p.kind, target: p.target, body: p.body, by: who.by, via: who.via, requestId: command.commandId,
        personAuthority: routedPersonAuthorityFor(command.commandId), pauseAuthority: routedPauseAuthorityFor(command.commandId) });
      return { kind: "flow-message-stored", flowRunId: p.runId, seq: stored.seq, state: stored.state, reason: stored.reason, deduped: stored.deduped, ...deferHolds(flow, p, stored.state) };
    }
    case "flow-plan": {
      loadRun(flow.store, command.payload.runId);
      const planNo = await proposePlan(flow, command.payload.runId, who.by, who.via);
      return { kind: "flow-plan-made", flowRunId: command.payload.runId, planNo };
    }
    case "flow-rerun": {
      const p = command.payload;
      if (p.discard === true) {
        if (p.skip !== undefined || p.add !== undefined) throw new ControlError("control-argument-invalid", "a discarded plan takes no skip or add");
        await discardPlan(flow, p.runId, p.planNo, who.by, who.via);
        return { kind: "flow-plan-discarded", flowRunId: p.runId, planNo: p.planNo };
      }
      await runPlan(flow, p.runId, p.planNo, { ...(p.skip === undefined ? {} : { skip: p.skip }), ...(p.add === undefined ? {} : { add: p.add }) }, who.by, who.via);
      return { kind: "flow-plan-run", flowRunId: p.runId, planNo: p.planNo };
    }
    case "flow-answer": return answer(flow, command.payload, who);
    case "flow-effect": {
      const p = command.payload;
      if (p.action === "discard") {
        discardEffect(flow, p.recordId, who.by, who.via);
        return { kind: "flow-effect-done", recordId: p.recordId, action: p.action, state: "discarded" };
      }
      const enacted = await enactEffect(flow, p.recordId, who.by, who.via, p.action);
      return enacted.state === "running" ? { kind: "flow-effect-done", recordId: p.recordId, action: p.action, state: "running" }
        : { kind: "flow-effect-done", recordId: p.recordId, action: p.action, state: "restaged", replacedBy: enacted.recordId };
    }
    case "flow-pool": return raisePool(flow, command.payload.runId, command.payload.raiseTokens, who, command.commandId);
    case "flow-plan-step": {
      const p = command.payload;
      await planStep(flow, { flowRunId: p.runId, planNo: p.planNo, stepKey: p.stepKey, choice: p.choice, by: who.by, via: who.via });
      return { kind: "flow-plan-step-applied", flowRunId: p.runId, planNo: p.planNo, stepKey: p.stepKey, choice: p.choice };
    }
  }
}

type MessagePayload = Extract<FlowCommand, { verb: "flow-message" }>["payload"];
/**
 * Gaps spec §6.3: a `defer` (not refused) names the effect steps it holds -- those after it it may hold that it did not
 * say `proceed` for -- and the command that releases them (a person's: `proceed` needs the token).
 */
function deferHolds(flow: FlowDeps, p: MessagePayload, state: string): { held?: string[]; release?: string } {
  if (state === "rejected" || p.kind !== "command" || p.body.command !== "defer" || p.target.kind !== "step") return {};
  const effects = typeof p.body.effects === "object" && p.body.effects !== null ? p.body.effects as Record<string, unknown> : {};
  const held = holdableAfter(loadRun(flow.store, p.runId).template, p.target.stepKey).filter((key) => effects[key] !== "proceed");
  if (held.length === 0) return {};
  return { held, release: `orca flow defer ${p.runId} --step ${p.target.stepKey} ${held.map((key) => `--effects ${key}=proceed`).join(" ")} --as-person` };
}

type AnswerPayload = Extract<FlowCommand, { verb: "flow-answer" }>["payload"];
/**
 * §8.1 `answer`: what the waiting step asked decides how the answer is taken; exactly one form of answer is given. Gaps
 * spec §4.6: `feedback` (instead of a step) answers that feedback intake's clarify round, by `clarify` or `consensus`.
 */
async function answer(flow: FlowDeps, p: AnswerPayload, who: { by: string; via: string }): Promise<Result> {
  const given = [p.values, p.text, p.clarify, p.consensus].filter((v) => v !== undefined).length;
  if (given !== 1) throw new ControlError("flow-answer-invalid", "give exactly one of values, text, clarify, consensus");
  if ((p.stepKey === undefined) === (p.feedback === undefined)) throw new ControlError("flow-answer-invalid", "give exactly one of stepKey, feedback");
  if (p.feedback !== undefined) {
    if (p.clarify === undefined && p.consensus === undefined) throw new ControlError("flow-answer-invalid", "a feedback round takes clarify or consensus");
    loadRun(flow.store, p.runId);
    const target = { flowRunId: p.runId, messageSeq: p.feedback };
    await answerFeedbackClarify(flow, target, p.clarify === undefined ? "consensus" : { roundNo: p.clarify.roundNo, answers: p.clarify.answers }, who.by, who.via);
    await advanceAfter(flow, p.runId);
    return { kind: "flow-feedback-answered", flowRunId: p.runId, messageSeq: p.feedback, answer: p.clarify === undefined ? "consensus" : "clarify" };
  }
  const stepKey = p.stepKey!;
  const run = loadRun(flow.store, p.runId);
  const step = stepOf(run, stepKey);
  const target = { flowRunId: p.runId, stepKey };
  const done = (kind: "ask" | "needs" | "clarify" | "consensus"): Result => ({ kind: "flow-answered", flowRunId: p.runId, stepKey, answer: kind });
  if (p.clarify !== undefined) { await answerFlowClarify(flow, target, p.clarify, who.by, who.via); await advanceAfter(flow, p.runId); return done("clarify"); }
  if (p.consensus !== undefined) { await flowClarifyConsensus(flow, target, who.by, who.via); await advanceAfter(flow, p.runId); return done("consensus"); }
  if (p.values !== undefined) {
    if (step.kind !== "ask") throw new FlowRefusal("flow-answer-invalid", `${stepKey} is a ${step.kind} step: answer its question with text`);
    await answerAsk(flow, target, p.values, who.by, who.via);
    await advanceAfter(flow, p.runId);
    return done("ask");
  }
  await answerNeeds(flow, target, p.text!, who.by, who.via);
  await advanceAfter(flow, p.runId);
  return done("needs");
}

/**
 * §6.3 `flow-pool`: the person raises the run's pool (human-only). Executions parked on an exhausted pool start again,
 * except one a standing defer holds: it is parked as held (kernel parkIfHeld, gaps §6.3).
 * The raise is a `command` message deduped by the command id, so a retried command raises nothing twice.
 */
async function raisePool(flow: FlowDeps, flowRunId: string, raise: number, who: { by: string; via: string }, requestId: string): Promise<Result> {
  loadRun(flow.store, flowRunId);
  const at = flow.now();
  flow.store.transaction(() => {
    const { deduped } = appendMessage(flow.store, {
      flowRunId, requestId, kind: "command", target: "run", body: { command: "pool-raise", tokens: raise }, by: who.by, via: who.via, state: "applied", reason: null, at,
    });
    if (!deduped) flow.store.db.prepare("UPDATE flow_runs SET pool_tokens=pool_tokens+? WHERE id=?").run(raise, flowRunId);
  });
  const run = loadRun(flow.store, flowRunId);
  for (const execution of latestByStep(listExecutions(flow.store, flowRunId)).values()) {
    const body = execution.body as ExecutionBody & { needsYou?: { reason?: string } };
    if (execution.state !== "parked" || body.needsYou?.reason !== POOL_EXHAUSTED) continue;
    // Final review I1: a raise is a budget act, not a release -- an effect step a standing defer holds stays held.
    if (parkIfHeld(flow, run, execution)) continue;
    const { needsYou: _parked, ...rest } = body;
    await resumeExecution(flow, run, { ...execution, body: rest as ExecutionBody });
  }
  return { kind: "flow-pool-raised", flowRunId, poolTokens: getFlowRun(flow.store, flowRunId)!.poolTokens };
}
