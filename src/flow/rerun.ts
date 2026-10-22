/**
 * Flow engine spec §7 (P7 as amended, plan Task 11): re-run plans. Code bounds what may re-run (candidates.ts, pure);
 * one `rerun-proposal` call may only propose skips from those candidates (proposal.ts validates it); the person decides
 * which steps run (`runPlan`); code runs the chosen ones in template order and lets a step leave the plan when its reasons
 * went away (cutoff.ts). An unattended plan (made by `orca-auto`) has nobody to decide: it takes the proposal as it is,
 * and each skip it took is written as a minor decision the person can correct later (P3, P5). `flows.rerunReview: auto`
 * runs a person's plan with the proposal at once too (they can still stop or rewind it).
 *
 * The proposal call is keyed `{flowRunId, "@plan", planNo}` on the parent group, as an execution's call is keyed by its
 * step; its raw output comes back through completeFlowCall and is judged here.
 */
import { MAX_AUTO_RETRIES } from "../control/requirementSchemas.js";
import type { ControlStore } from "../control/store.js";
import type { FlowCallResult } from "./calls.js";
import { candidates, chosenPlan, type Candidate, type Execution, type FlowMessage, type Journal } from "./journal/candidates.js";
import { afterExecution } from "./journal/cutoff.js";
import { validateProposal, type Skip } from "./journal/proposal.js";
import { advanceRun, definitionOf, FlowRefusal, loadRun, recordOfExecution, stepOf, type FlowDeps, type RanOnInputs } from "./kernel.js";
import type { ExecutionBody, LoadedRun } from "./kinds/registry.js";
import { bounded } from "./prompt.js";
import { readFlowSettings } from "./settings.js";
import { appendFlowDecision, appendMessage, getFlowRun, listExecutions, listHeads, listPlans, putPlan, setFlowRunState, type PlanRow } from "./store.js";
import { evaluateWhen } from "./template/when.js";
import { vaultGit } from "./vault/vault.js";

export { PLAN_KEY } from "./store.js";
import { PLAN_KEY } from "./store.js";
/** Global Constraints: the proposal's diffs are bounded per output and in total; the cut is recorded in the prompt. */
const DIFF_PER_OUTPUT = 16 * 1024;
const DIFF_TOTAL = 64 * 1024;
const PROPOSAL_MAX_OUTPUT_TOKENS = 4_000;
export const PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["skips"],
  properties: {
    skips: { type: "array", items: { type: "object", additionalProperties: false, required: ["stepKey", "reason"], properties: { stepKey: { type: "string" }, reason: { type: "string" } } } },
    startAt: { type: "string" },
  },
});

export interface PlanCandidates { list: Candidate[]; feedback: Record<string, string[]>; edits: string[]; trigger: string }
export interface PlanProposal { retries: number; lastInvalid: string | null; call: { runId?: string } | null; callResult?: FlowCallResult; skips: Skip[] | null; exhausted: string | null }
export interface PlanChosen { steps: string[]; skips: string[]; added: string[] }
export interface RunningPlan { flowRunId: string; planNo: number; by: string; via: string; candidates: PlanCandidates; chosen: PlanChosen }

const isOpen = (plan: PlanRow): boolean => plan.state === "proposed" || plan.state === "running";
export const openPlan = (store: ControlStore, flowRunId: string): PlanRow | null => listPlans(store, flowRunId).filter(isOpen).at(-1) ?? null;

/** The kernel's journal in the planner's terms (§6.4): every execution with what it ran on and what it produced. */
function journalOf(store: ControlStore, run: LoadedRun): Journal {
  const executions: Execution[] = listExecutions(store, run.row.id).map((e) => {
    const body = e.body as ExecutionBody & { ranOnInputs?: RanOnInputs };
    return {
      stepKey: e.stepKey, seq: e.seq, state: e.state, failure: body.failure ?? null, definitionHash: e.definitionHash, fingerprint: e.fingerprint ?? "",
      // No record of what it ran on (it never started): unknown, so every input counts as moved.
      ranOnInputs: body.ranOnInputs ?? { start: "unknown", params: "unknown", earlier: [] },
      outputHash: e.outputHash, projection: null, readSet: null,
    };
  });
  return { executions, heads: listHeads(store, run.row.id) };
}

/** §7.2 measured now: definitions from the run's template (with the skills its active execution ran), `when`, the import. */
export function currentCandidates(deps: FlowDeps, run: LoadedRun, messages: readonly FlowMessage[]): Candidate[] {
  const journal = journalOf(deps.store, run);
  const rows = listExecutions(deps.store, run.row.id);
  const definitionHashes: Record<string, string> = {};
  for (const step of run.template.steps) {
    const active = rows.find((e) => e.stepKey === step.id && e.seq === journal.heads[step.id]);
    definitionHashes[step.id] = definitionOf(deps, run, step, (active?.body as { skillLocks?: [] } | undefined)?.skillLocks ?? []);
  }
  const whenFalse = new Set(run.template.steps.filter((s) => s.when !== undefined && !evaluateWhen(s.when, { params: run.params, classification: null })).map((s) => s.id));
  // §5.3: a step whose active output no longer merged into a composition was flagged red there (kernel.ts).
  const composeConflicts = new Set(run.template.steps.filter((step) => {
    const active = rows.find((e) => e.stepKey === step.id && e.seq === journal.heads[step.id]);
    return ((active?.body as ExecutionBody | undefined)?.flags ?? []).includes("compose-conflict");
  }).map((step) => step.id));
  return candidates(journal, run.template, messages, {
    definitionHashes, start: run.body.importCommit ?? "none", params: run.row.paramsSha256, whenFalse, composeConflicts,
  });
}

const feedbackMessages = (feedback: Record<string, string[]>): FlowMessage[] =>
  Object.keys(feedback).map((stepKey) => ({ kind: "feedback", target: { kind: "step", stepKey } }));

/** What a changed output says, bounded: a record's projection or JSON, a commit's diff against its parent. */
async function changeOf(deps: FlowDeps, run: LoadedRun, stepKey: string): Promise<string> {
  const seq = listHeads(deps.store, run.row.id)[stepKey];
  const active = listExecutions(deps.store, run.row.id).find((e) => e.stepKey === stepKey && e.seq === seq);
  if (active === undefined) return "(no output)";
  if (active.outputKind === "artifact") return JSON.stringify(recordOfExecution(deps.store, active));
  if (active.outputKind === "commit" && run.body.vaultPath !== null && run.body.dir !== null) {
    const parent = String((active.body as { parent?: string }).parent ?? active.baseCommit);
    return vaultGit({ path: run.body.vaultPath, dir: run.body.dir }, ["diff", parent, active.outputRef!]);
  }
  return "(no output)";
}

async function proposalPrompt(deps: FlowDeps, run: LoadedRun, plan: { candidates: PlanCandidates; lastInvalid: string | null }): Promise<string> {
  const lines = [
    "Orca flow re-run proposal, instruction version 1.",
    "Code listed the steps that may need to run again (the candidates) with the reasons. You may only propose to SKIP candidates",
    "whose output would not change; give a reason for each. You cannot add steps, reorder them, or skip a step that has feedback.",
    "Answer JSON {\"skips\": [{\"stepKey\", \"reason\"}], \"startAt\"?: <candidate>} (startAt skips every earlier candidate).",
    "",
    "## Candidates",
    ...plan.candidates.list.map((c) => {
      const step = stepOf(run, c.stepKey);
      const hint = step.hints?.skipWhen === undefined ? "" : ` -- skip when: ${step.hints.skipWhen}`;
      return `- ${c.stepKey} (${step.kind}): ${c.reasons.join(", ")}${hint}`;
    }),
  ];
  const feedback = Object.entries(plan.candidates.feedback);
  if (feedback.length > 0) lines.push("", "## The person's feedback", ...feedback.flatMap(([key, texts]) => texts.map((t) => `- on ${key}: ${t}`)));
  const changed = [...new Set([...plan.candidates.edits, ...plan.candidates.list.flatMap((c) => c.reasons.filter((r) => r.startsWith("upstream-changed:")).map((r) => r.slice(17)))])]
    .filter((key) => run.template.steps.some((s) => s.id === key));
  let left = DIFF_TOTAL;
  const diffs: string[] = [];
  for (const key of changed) {
    const cut = bounded(await changeOf(deps, run, key), Math.min(DIFF_PER_OUTPUT, left));
    left -= Buffer.byteLength(cut.text, "utf8");
    diffs.push(`### ${key}\n${cut.text}${cut.cut > 0 ? `\n[cut: ${cut.cut} more bytes]` : ""}`);
  }
  if (diffs.length > 0) lines.push("", "## Changed outputs (bounded)", ...diffs);
  if (plan.lastInvalid !== null) lines.push("", `## Your previous answer was discarded\n\n${plan.lastInvalid}`);
  return `${lines.join("\n")}\n`;
}

async function requestProposal(deps: FlowDeps, run: LoadedRun, planNo: number): Promise<void> {
  const plan = listPlans(deps.store, run.row.id).find((p) => p.planNo === planNo)!;
  const proposal = plan.proposal as PlanProposal;
  deps.calls.request({
    key: { flowRunId: run.row.id, stepKey: PLAN_KEY, seq: planNo }, groupId: run.row.groupId, purpose: "rerun-proposal",
    prompt: await proposalPrompt(deps, run, { candidates: plan.candidates as PlanCandidates, lastInvalid: proposal.lastInvalid }),
    responseSchema: PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: PROPOSAL_MAX_OUTPUT_TOKENS,
  });
}

/**
 * §7.1: a plan from the person's feedback and edits (or a repin, a rewind, `orca flow plan`, an unattended trigger).
 * An open older plan is abandoned; the feedback of the steps it had not run yet moves into this one. No candidates:
 * nothing to decide, a plan with nothing chosen carries every output onto the new basis.
 */
export async function makePlan(deps: FlowDeps, flowRunId: string, input: { by: string; via: string; trigger: string; feedback?: Record<string, string[]>; edits?: string[] }): Promise<number> {
  // A rewind decides itself which earlier feedback stands (§8.3): nothing is carried from the plans it replaces.
  const carry = input.trigger !== "rewind";
  const run = loadRun(deps.store, flowRunId);
  const feedback: Record<string, string[]> = {};
  const executions = listExecutions(deps.store, flowRunId);
  const plans = listPlans(deps.store, flowRunId);
  for (const older of plans.filter((p) => carry && isOpen(p))) {
    for (const [key, texts] of Object.entries((older.candidates as PlanCandidates).feedback)) {
      if (!executions.some((e) => e.stepKey === key && e.planNo === older.planNo)) feedback[key] = [...(feedback[key] ?? []), ...texts];
    }
  }
  for (const [key, texts] of Object.entries(input.feedback ?? {})) feedback[key] = [...new Set([...(feedback[key] ?? []), ...texts])];
  const edits = input.edits ?? [];
  const messages: FlowMessage[] = [...feedbackMessages(feedback), ...edits.map((stepKey) => ({ kind: "edit" as const, target: { kind: "step" as const, stepKey } }))];
  const list = currentCandidates(deps, run, messages);
  const planNo = (plans.at(-1)?.planNo ?? 0) + 1;
  const empty = list.length === 0;
  deps.store.transaction(() => {
    for (const older of plans.filter(isOpen)) putPlan(deps.store, { ...older, state: "abandoned" });
    const proposal: PlanProposal = { retries: 0, lastInvalid: null, call: empty ? null : {}, skips: empty ? [] : null, exhausted: null };
    putPlan(deps.store, {
      flowRunId, planNo, state: empty ? "running" : "proposed", candidates: { list, feedback, edits, trigger: input.trigger } satisfies PlanCandidates,
      proposal, chosen: empty ? ({ steps: [], skips: [], added: [] } satisfies PlanChosen) : null, by: input.by, via: input.via,
    });
    const state = getFlowRun(deps.store, flowRunId)!.state;
    if (state === "done") setFlowRunState(deps.store, flowRunId, "done", "running");
  });
  if (!empty) await requestProposal(deps, run, planNo);
  return planNo;
}

/** `orca flow plan`: a plan from what the journal says now, with no new message. */
export async function proposePlan(deps: FlowDeps, flowRunId: string, by: string, via: string): Promise<number> {
  const planNo = await makePlan(deps, flowRunId, { by, via, trigger: "plan" });
  await advanceRun(deps, flowRunId);
  return planNo;
}

/** The setting `flows.rerunReview` of the run's project (global, built-in default `review`). */
function rerunReviewOf(deps: FlowDeps, run: LoadedRun): "auto" | "review" {
  return deps.rerunReview?.(run.body.projectId) ?? readFlowSettings(deps.store, run.body.projectId).rerunReview.value;
}

/** Choose the steps: candidates minus the skips plus the additions, always in template order (never the proposal's). */
function choose(store: ControlStore, plan: PlanRow, run: LoadedRun, skips: readonly string[], add: readonly string[], proposal: PlanProposal): void {
  const steps = chosenPlan((plan.candidates as PlanCandidates).list, { skips, add }, run.template.steps.map((s) => s.id));
  putPlan(store, { ...plan, state: "running", proposal, chosen: { steps, skips: [...skips], added: [...add] } satisfies PlanChosen });
}

/** A settled proposal: unattended (or `rerunReview: auto`) takes it now; otherwise the plan waits for the person. */
function settleProposal(deps: FlowDeps, run: LoadedRun, plan: PlanRow, proposal: PlanProposal): void {
  const unattended = plan.by === "orca-auto";
  deps.store.transaction(() => {
    if (!unattended && rerunReviewOf(deps, run) === "review") { putPlan(deps.store, { ...plan, proposal }); return; }
    choose(deps.store, plan, run, proposal.skips!.map((s) => s.stepKey), [], proposal);
    // P7, §7.4: each skip the model proposed and nobody looked at is a minor decision the person can correct by feedback.
    if (unattended) {
      for (const skip of proposal.skips!) {
        appendFlowDecision(deps.store, { flowRunId: run.row.id, grade: "minor", stepKey: skip.stepKey, by: "orca-auto", body: { kind: "rerun-skip", planNo: plan.planNo, reason: skip.reason, source: "rerun-proposal" } });
      }
    }
  });
}

/** The rerun-proposal call came back: judge it (§7.3); invalid ⇒ the retry path; exhausted ⇒ no proposal, every candidate. */
export async function completePlanCall(deps: FlowDeps, flowRunId: string, planNo: number, rawOutput: unknown, failure: string | null): Promise<void> {
  const run = loadRun(deps.store, flowRunId);
  const plan = listPlans(deps.store, flowRunId).find((p) => p.planNo === planNo);
  const proposal = plan?.proposal as PlanProposal | undefined;
  if (plan === undefined || plan.state !== "proposed" || proposal === undefined || proposal.skips !== null) return;
  const { callResult: _done, ...rest } = proposal;
  const cands = plan.candidates as PlanCandidates;
  // A call the pool or the parent could not fund never gets better by asking again.
  const final = failure === "flow-pool-exhausted" || failure === "flow-call-unconfirmed";
  const verdict = failure !== null ? { ok: false as const, why: `call-failed:${failure}` } : validateProposal(rawOutput, cands.list, new Set(Object.keys(cands.feedback)));
  if (verdict.ok) return settleProposal(deps, run, plan, { ...rest, call: null, skips: verdict.skips });
  if (!final && rest.retries < MAX_AUTO_RETRIES) {
    deps.store.transaction(() => putPlan(deps.store, { ...plan, proposal: { ...rest, retries: rest.retries + 1, lastInvalid: verdict.why, call: {} } satisfies PlanProposal }));
    return requestProposal(deps, run, planNo);
  }
  settleProposal(deps, run, plan, { ...rest, call: null, skips: [], exhausted: verdict.why });
}

/**
 * The kernel's view of the open plan: "wait" while a proposal is out or the person has not chosen; "moved" when a
 * proposal result was judged; the running plan (after the cutoff: §7.5, a chosen step whose reasons all went away leaves
 * it -- steps only ever leave; the person's additions stay); null with no open plan.
 */
export async function planOf(deps: FlowDeps, run: LoadedRun): Promise<"wait" | "moved" | RunningPlan | null> {
  const plan = openPlan(deps.store, run.row.id);
  if (plan === null) return null;
  const proposal = plan.proposal as PlanProposal;
  if (plan.state === "proposed") {
    if (proposal.callResult === undefined) return "wait";
    await completePlanCall(deps, run.row.id, plan.planNo, proposal.callResult.rawOutput, proposal.callResult.failure);
    return "moved";
  }
  const cands = plan.candidates as PlanCandidates;
  const chosen = plan.chosen as PlanChosen;
  // Executed = finished under this plan.
  const executions = listExecutions(deps.store, run.row.id);
  const executed = chosen.steps.filter((key) => executions.some((e) => e.stepKey === key && e.planNo === plan.planNo && (e.state === "done" || e.state === "skipped")));
  if (executed.length > 0) {
    // Still live: the feedback of chosen steps not run yet, and a chosen step running now (a parallel sibling) as re-running.
    const started = chosen.steps.filter((key) => !executed.includes(key) && executions.some((e) => e.stepKey === key && e.planNo === plan.planNo));
    const live = { ...Object.fromEntries(Object.entries(cands.feedback).filter(([key]) => !executed.includes(key))), ...Object.fromEntries(started.map((key) => [key, []])) };
    const now = currentCandidates(deps, run, feedbackMessages(live));
    const kept = afterExecution({ chosen: chosen.steps, executed }, now).chosen;
    const steps = chosen.steps.filter((key) => kept.includes(key) || chosen.added.includes(key));
    if (steps.length !== chosen.steps.length) {
      deps.store.transaction(() => putPlan(deps.store, { ...plan, chosen: { ...chosen, steps } satisfies PlanChosen }));
      return "moved";
    }
  }
  return { flowRunId: run.row.id, planNo: plan.planNo, by: plan.by, via: plan.via, candidates: cands, chosen };
}

export function finishPlan(store: ControlStore, plan: RunningPlan): void {
  const row = listPlans(store, plan.flowRunId).find((p) => p.planNo === plan.planNo);
  if (row !== undefined) putPlan(store, { ...row, state: "done" });
}

/**
 * §7.4 `orca flow rerun` / the Web checklist: the person runs the open plan. Without `skip` the proposal's skips stand
 * (the checklist's unticked rows); `add` names non-candidates to run too. Only the newest open, proposed plan can run:
 * anything else is `flow-plan-stale`.
 */
export async function runPlan(deps: FlowDeps, flowRunId: string, planNo: number, choice: { skip?: string[]; add?: string[] }, by: string, via: string): Promise<void> {
  const run = loadRun(deps.store, flowRunId);
  const plan = openPlan(deps.store, flowRunId);
  const proposal = plan?.proposal as PlanProposal | undefined;
  if (plan === null || plan.planNo !== planNo || plan.state !== "proposed" || proposal?.skips == null) throw new FlowRefusal("flow-plan-stale", `plan ${planNo}`);
  for (const key of [...(choice.skip ?? []), ...(choice.add ?? [])]) stepOf(run, key);
  const skips = choice.skip ?? proposal.skips.map((s) => s.stepKey);
  const at = deps.now();
  deps.store.transaction(() => {
    appendMessage(deps.store, {
      flowRunId, requestId: `rerun:${planNo}`, kind: "command", target: "run", body: { command: "rerun", planNo, skip: skips, add: choice.add ?? [] },
      by, via, state: "applied", reason: null, at,
    });
    choose(deps.store, plan, run, skips, choice.add ?? [], proposal);
  });
  await advanceRun(deps, flowRunId);
}
