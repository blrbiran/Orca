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
import { validateProposal, type Skip, type Unsure } from "./journal/proposal.js";
import { canonicalBytes } from "../control/canonicalJson.js";
import { advanceRun, definitionOf, FlowRefusal, loadRun, ranOnInputsOf, recordOfExecution, stepOf, type FlowDeps, type RanOnInputs } from "./kernel.js";
import type { ExecutionBody, LoadedRun } from "./kinds/registry.js";
import { bounded } from "./prompt.js";
import { readFlowSettings } from "./settings.js";
import { appendFlowDecision, appendMessage, getFlowRun, getHead, listExecutions, listHeads, listMessages, listPlans, putPlan, setFlowRunState, setMessageState, type PlanRow } from "./store.js";
import { marksOf } from "./marks.js";
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
    unsure: { type: "array", items: { type: "object", additionalProperties: false, required: ["stepKey", "question"], properties: { stepKey: { type: "string" }, question: { type: "string" } } } },
  },
});

/**
 * Gaps spec §5.6: what a newer plan takes over from the open plan it replaces -- the questions still pending there, the
 * accept decisions whose step's inputs did not move since (already filtered when the plan is made), and the person's
 * `run` answers on steps that had not run yet.
 */
export interface CarriedDecisions { pending: Array<{ stepKey: string; question: string; fromPlan: number }>; accepted: AcceptedItem[]; run: Array<{ stepKey: string; question: string; answer: PendingAnswer }> }
export interface PlanCandidates { list: Candidate[]; feedback: Record<string, string[]>; edits: string[]; trigger: string; carried?: CarriedDecisions; fills?: string[] }
export interface PlanProposal { retries: number; lastInvalid: string | null; call: { runId?: string } | null; callResult?: FlowCallResult; skips: Skip[] | null; unsure?: Unsure[] | null; exhausted: string | null }
export type PlanStepChoice = "run" | "accept-unchanged";
export interface PendingAnswer { choice: PlanStepChoice; by: string; via: string; at: number; source: "person" | "timeout" | "carried"; fromPlan?: number }
/** Gaps spec §5.2: an unsure candidate under `auto` asks the person; at `deadline` it resolves to accept-unchanged. */
export interface PendingItem { stepKey: string; question: string; askedAt: number; deadline: number; answer: PendingAnswer | null; closed?: string }
/** Gaps spec §5.5: the step's output stands for its new inputs; `ranOnInputs` is what those inputs were when decided (§5.6). */
export interface AcceptedItem { stepKey: string; seq: number; by: string; via: string; at: number; source: "person" | "timeout" | "carried"; fromPlan?: number; ranOnInputs: RanOnInputs }
export interface PlanChosen { steps: string[]; skips: string[]; added: string[]; pending?: PendingItem[]; accepted?: AcceptedItem[] }
export interface RunningPlan { flowRunId: string; planNo: number; by: string; via: string; candidates: PlanCandidates; chosen: PlanChosen }

const isOpen = (plan: PlanRow): boolean => plan.state === "proposed" || plan.state === "running";
export const openPlan = (store: ControlStore, flowRunId: string): PlanRow | null => listPlans(store, flowRunId).filter(isOpen).at(-1) ?? null;

type StoredBody = ExecutionBody & { ranOnInputs?: RanOnInputs; carriedForward?: number; projection?: string | null };

/**
 * The kernel's journal in the planner's terms (§6.4): every execution with what it ran on and what it produced. Gaps
 * spec §5.5: an active output stands for what its newest done or carried-forward execution ran on -- a plan skip, an
 * accept or a timeout carries the output onto new inputs without running it, and the next plan must see those inputs,
 * not the older ones the output was first made on. The output (hash, projection) stays the head's.
 */
function journalOf(store: ControlStore, run: LoadedRun): Journal {
  const rows = listExecutions(store, run.row.id);
  const heads = listHeads(store, run.row.id);
  const standsOn = new Map<string, RanOnInputs>();
  for (const e of rows) {
    const body = e.body as StoredBody;
    const head = heads[e.stepKey];
    const carriesHead = e.state === "skipped" && body.carriedForward !== undefined && body.carriedForward === head;
    if (body.ranOnInputs !== undefined && ((e.state === "done" && e.seq === head) || carriesHead)) standsOn.set(e.stepKey, body.ranOnInputs);
  }
  // kernel.ts ranOnInputsOf: a `parallelWith` sibling is not an input; it is recorded as it stands when the planner reads
  // it, so only its re-run (never its finishing later) makes the step a candidate.
  const order = run.template.steps.map((s) => s.id);
  const active = (key: string) => rows.find((e) => e.stepKey === key && e.seq === heads[key] && e.state === "done");
  const withSiblings = (stepKey: string, inputs: RanOnInputs): RanOnInputs => {
    const step = run.template.steps.find((s) => s.id === stepKey);
    const siblings = run.template.steps.filter((s) => step !== undefined && order.indexOf(s.id) < order.indexOf(stepKey) && parallelSteps(s, step)
      && !inputs.earlier.some((e) => e.stepKey === s.id));
    if (siblings.length === 0) return inputs;
    const asItStands = siblings.map((s) => ({ stepKey: s.id, outputHash: active(s.id)?.outputHash ?? null, projection: (active(s.id)?.body as StoredBody | undefined)?.projection ?? null }));
    return { ...inputs, earlier: [...inputs.earlier, ...asItStands] };
  };
  const executions: Execution[] = rows.map((e) => {
    const body = e.body as StoredBody;
    const ranOnInputs = (e.seq === heads[e.stepKey] ? standsOn.get(e.stepKey) : undefined) ?? body.ranOnInputs;
    return {
      stepKey: e.stepKey, seq: e.seq, state: e.state, failure: body.failure ?? null, definitionHash: e.definitionHash, fingerprint: e.fingerprint ?? "",
      // No record of what it ran on (it never started): unknown, so every input counts as moved.
      ranOnInputs: ranOnInputs === undefined ? { start: "unknown", params: "unknown", earlier: [] } : withSiblings(e.stepKey, ranOnInputs),
      outputHash: e.outputHash, projection: body.projection ?? null, readSet: null,
    };
  });
  return { executions, heads };
}

/** §7.2 measured now: definitions from the run's template (with the skills its active execution ran), `when`, the import. */
export function currentCandidates(deps: FlowDeps, run: LoadedRun, messages: readonly FlowMessage[], acceptedUnchanged?: ReadonlySet<string>, filled?: ReadonlySet<string>): Candidate[] {
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
  // Gaps spec §6.2: a skipped or deferred step is never a candidate (like a `when`-false one); §6.4: a filled one is.
  const marked = new Set(marksOf(listMessages(deps.store, run.row.id)).keys());
  return candidates(journal, run.template, messages, {
    definitionHashes, start: run.body.importCommit ?? "none", params: run.row.paramsSha256, whenFalse, composeConflicts, marked,
    ...(acceptedUnchanged === undefined ? {} : { acceptedUnchanged }),
    ...(filled === undefined ? {} : { filled }),
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
    "Orca flow re-run proposal, instruction version 2.",
    "Code listed the steps that may need to run again (the candidates) with the reasons. You may only propose to SKIP candidates",
    "whose output would not change; give a reason for each. You cannot add steps, reorder them, or skip a step that has feedback.",
    "Mark a candidate \"unsure\" only when its output might or might not change and the person would know: give one short",
    "question (at most 200 characters) they can answer with \"run it\" or \"keep it\". Never mark a step that has feedback, a fill,",
    "or that never succeeded. A candidate you neither skip nor mark unsure runs.",
    "Answer JSON {\"skips\": [{\"stepKey\", \"reason\"}], \"startAt\"?: <candidate>, \"unsure\"?: [{\"stepKey\", \"question\"}]} (startAt skips every earlier candidate).",
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

const sameInputs = (a: RanOnInputs, b: RanOnInputs): boolean => canonicalBytes(a).equals(canonicalBytes(b));
/** The person's words or hands put the step in the plan (feedback, fill) or there is no output to keep: never carried past. */
const keepsNoDecision = (c: Candidate | undefined): boolean => c !== undefined && c.reasons.some((r) => r === "feedback" || r === "fill" || r === "never-succeeded");

/**
 * Gaps spec §5.6: what the open plans this one replaces hand over. A pending question still unanswered carries (the new
 * proposal settles it again, with a fresh deadline). An accept carries only while the step's inputs are the ones it was
 * decided on -- equal `ranOnInputsOf` now, and no earlier step it depends on is a candidate of the new plan (it is
 * about to re-run, so the inputs will move: unknown => include) -- and the new plan gives it no reason of its own
 * (feedback, fill). A person's `run` answer on a step that has not run yet carries as it is: running is never wrong.
 */
function carriedFrom(store: ControlStore, run: LoadedRun, older: readonly PlanRow[], list: readonly Candidate[], executions: ReturnType<typeof listExecutions>): CarriedDecisions | undefined {
  const order = run.template.steps.map((s) => s.id);
  const earlierCandidate = (key: string): boolean => {
    const step = stepOf(run, key);
    return list.some((c) => order.indexOf(c.stepKey) < order.indexOf(key) && !parallelSteps(stepOf(run, c.stepKey), step));
  };
  const out: CarriedDecisions = { pending: [], accepted: [], run: [] };
  for (const plan of older) {
    const chosen = plan.chosen as PlanChosen | null;
    if (chosen === null) continue;
    const ranUnder = (key: string) => executions.some((e) => e.stepKey === key && e.planNo === plan.planNo && (e.body as StoredBody).carriedForward === undefined);
    for (const item of chosen.pending ?? []) {
      if (item.answer === null) out.pending.push({ stepKey: item.stepKey, question: item.question, fromPlan: plan.planNo });
      else if (item.answer.choice === "run" && !ranUnder(item.stepKey)) out.run.push({ stepKey: item.stepKey, question: item.question, answer: { ...item.answer, source: "carried", fromPlan: plan.planNo } });
    }
    for (const item of chosen.accepted ?? []) {
      const candidate = list.find((c) => c.stepKey === item.stepKey);
      if (!sameInputs(item.ranOnInputs, ranOnInputsOf(store, run, item.stepKey)) || earlierCandidate(item.stepKey) || keepsNoDecision(candidate)) continue;
      out.accepted.push({ ...item, source: "carried", fromPlan: plan.planNo });
    }
  }
  return out.pending.length + out.accepted.length + out.run.length === 0 ? undefined : out;
}
const parallelSteps = (a: { id: string; parallelWith?: string }, b: { id: string; parallelWith?: string }): boolean => a.parallelWith === b.id || b.parallelWith === a.id;

/**
 * §7.1: a plan from the person's feedback and edits (or a repin, a rewind, `orca flow plan`, an unattended trigger).
 * An open older plan is abandoned; the feedback of the steps it had not run yet moves into this one. No candidates:
 * nothing to decide, a plan with nothing chosen carries every output onto the new basis.
 */
export async function makePlan(deps: FlowDeps, flowRunId: string, input: { by: string; via: string; trigger: string; feedback?: Record<string, string[]>; edits?: string[]; fills?: string[] }): Promise<number> {
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
  // Gaps spec §6.4: a fill an open plan had not run yet moves into this one, as its feedback does (unless marked again).
  const marked = marksOf(listMessages(deps.store, flowRunId));
  const carriedFills = plans.filter((p) => carry && isOpen(p)).flatMap((older) => ((older.candidates as PlanCandidates).fills ?? [])
    .filter((key) => !executions.some((e) => e.stepKey === key && e.planNo === older.planNo)));
  const fills = [...new Set([...carriedFills, ...(input.fills ?? [])])].filter((key) => !marked.has(key));
  const edits = input.edits ?? [];
  const messages: FlowMessage[] = [...feedbackMessages(feedback), ...edits.map((stepKey) => ({ kind: "edit" as const, target: { kind: "step" as const, stepKey } }))];
  const list = currentCandidates(deps, run, messages, undefined, new Set(fills));
  const carried = carry ? carriedFrom(deps.store, run, plans.filter(isOpen), list, executions) : undefined;
  const planNo = (plans.at(-1)?.planNo ?? 0) + 1;
  const empty = list.length === 0;
  deps.store.transaction(() => {
    for (const older of plans.filter(isOpen)) putPlan(deps.store, { ...older, state: "abandoned" });
    const proposal: PlanProposal = { retries: 0, lastInvalid: null, call: empty ? null : {}, skips: empty ? [] : null, exhausted: null };
    putPlan(deps.store, {
      flowRunId, planNo, state: empty ? "running" : "proposed",
      candidates: { list, feedback, edits, trigger: input.trigger, ...(carried === undefined ? {} : { carried }), ...(fills.length === 0 ? {} : { fills }) } satisfies PlanCandidates,
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
  const marked = marksOf(listMessages(store, run.row.id));
  const steps = chosenPlan((plan.candidates as PlanCandidates).list, { skips, add }, run.template.steps.map((s) => s.id)).filter((key) => !marked.has(key));
  putPlan(store, { ...plan, state: "running", proposal, chosen: { steps, skips: [...skips], added: [...add] } satisfies PlanChosen });
}

/** Gaps spec §5.3: `flows.rerunAskTimeoutSeconds` of the run's project (project > global > 300), in milliseconds. */
function askTimeoutOf(deps: FlowDeps, run: LoadedRun): number {
  return readFlowSettings(deps.store, run.body.projectId).rerunAskTimeoutSeconds.value * 1000;
}

/**
 * A settled proposal. Under `rerunReview: review` (and only for a person's plan) the plan waits for the person's
 * checklist, the unsure marks shown with no deadline. Otherwise nobody ticks it (gaps spec §5.2): the model's skips are
 * taken, each a minor decision the person can correct by feedback (P5, P7); each unsure candidate becomes a pending
 * question with a deadline resolved now (§5.3); everything else runs. What the replaced plan handed over (§5.6) comes
 * first: a carried accept keeps its step out, a carried `run` keeps it in, a carried question is asked again unless the
 * new proposal skips it -- with the new proposal's question when it gives one, and always a fresh deadline.
 */
function settleProposal(deps: FlowDeps, run: LoadedRun, plan: PlanRow, proposal: PlanProposal): void {
  const unattended = plan.by === "orca-auto";
  deps.store.transaction(() => {
    if (!unattended && rerunReviewOf(deps, run) === "review") { putPlan(deps.store, { ...plan, proposal }); return; }
    const cands = plan.candidates as PlanCandidates;
    const carried = cands.carried ?? { pending: [], accepted: [], run: [] };
    // Gaps spec §6.2: a step the person skipped or deferred since the plan was made is no longer one of its candidates.
    const marked = marksOf(listMessages(deps.store, run.row.id));
    const isCandidate = (key: string) => !marked.has(key) && cands.list.some((c) => c.stepKey === key);
    const now = deps.now();
    const accepted = carried.accepted.map((a) => ({ ...a, at: now }));
    const kept = new Set([...accepted.map((a) => a.stepKey), ...carried.run.map((r) => r.stepKey)]);
    const skips = proposal.skips!.filter((s) => !kept.has(s.stepKey));
    const skipped = new Set(skips.map((s) => s.stepKey));
    const questions = new Map((proposal.unsure ?? []).map((u) => [u.stepKey, u.question]));
    for (const item of carried.pending) {
      if (isCandidate(item.stepKey) && !skipped.has(item.stepKey) && !questions.has(item.stepKey) && !keepsNoDecision(cands.list.find((c) => c.stepKey === item.stepKey))) questions.set(item.stepKey, item.question);
    }
    const deadline = now + askTimeoutOf(deps, run);
    const order = run.template.steps.map((s) => s.id);
    const pending: PendingItem[] = order.filter((key) => questions.has(key) && !kept.has(key) && isCandidate(key))
      .map((stepKey) => ({ stepKey, question: questions.get(stepKey)!, askedAt: now, deadline, answer: null }));
    const answered: PendingItem[] = carried.run.filter((r) => isCandidate(r.stepKey))
      .map((r) => ({ stepKey: r.stepKey, question: r.question, askedAt: now, deadline: now, answer: r.answer }));
    const out = new Set([...skipped, ...pending.map((p) => p.stepKey), ...accepted.map((a) => a.stepKey)]);
    const steps = chosenPlan(cands.list, { skips: [...out], add: [] }, order).filter(isCandidate);
    putPlan(deps.store, { ...plan, state: "running", proposal, chosen: { steps, skips: [...skipped], added: [], pending: [...pending, ...answered], accepted } satisfies PlanChosen });
    // P7, §7.4, gaps §5.2: each skip the model proposed and nobody ticked is a minor decision the person can correct by feedback.
    for (const skip of skips) {
      appendFlowDecision(deps.store, { flowRunId: run.row.id, grade: "minor", stepKey: skip.stepKey, by: "orca-auto", body: { kind: "rerun-skip", planNo: plan.planNo, reason: skip.reason, source: "rerun-proposal" } });
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
  if (verdict.ok) return settleProposal(deps, run, plan, { ...rest, call: null, skips: verdict.skips, unsure: verdict.unsure });
  if (!final && rest.retries < MAX_AUTO_RETRIES) {
    deps.store.transaction(() => putPlan(deps.store, { ...plan, proposal: { ...rest, retries: rest.retries + 1, lastInvalid: verdict.why, call: {} } satisfies PlanProposal }));
    return requestProposal(deps, run, planNo);
  }
  settleProposal(deps, run, plan, { ...rest, call: null, skips: [], unsure: [], exhausted: verdict.why });
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
  // Gaps spec §5.3: a pending question past its deadline is accepted as unchanged by orca-auto -- never run -- once.
  const at = deps.now();
  const overdue = (chosen.pending ?? []).filter((item) => item.answer === null && item.deadline <= at);
  if (overdue.length > 0) {
    deps.store.transaction(() => {
      let row = plan;
      for (const item of overdue) {
        const answer: PendingAnswer = { choice: "accept-unchanged", by: "orca-auto", via: "orca", at, source: "timeout" };
        try { row = decidePlanStep(deps.store, run, row, item.stepKey, answer); }
        catch (error) {
          // A question code can no longer answer that way (the step has no output to keep, or is accepted already) is
          // closed with the refusal, nothing decided -- never thrown, so it cannot hold up the other overdue questions.
          if (!(error instanceof FlowRefusal)) throw error;
          const chosenNow = row.chosen as PlanChosen;
          row = { ...row, chosen: { ...chosenNow, pending: (chosenNow.pending ?? []).map((p) => (p.stepKey === item.stepKey && p.answer === null ? { ...p, answer, closed: error.message } : p)) } };
          putPlan(deps.store, row);
          continue;
        }
        appendFlowDecision(deps.store, { flowRunId: run.row.id, grade: "minor", stepKey: item.stepKey, by: "orca-auto", body: { kind: "rerun-unsure-timeout", planNo: plan.planNo, stepKey: item.stepKey, question: item.question, deadline: item.deadline } });
      }
    });
    return "moved";
  }
  // Executed = finished under this plan (an accepted step carried forward under it counts: its output stands).
  const executions = listExecutions(deps.store, run.row.id);
  const finishedUnder = (key: string) => executions.some((e) => e.stepKey === key && e.planNo === plan.planNo && (e.state === "done" || e.state === "skipped"));
  const accepted = chosen.accepted ?? [];
  const executed = [...new Set([...chosen.steps, ...accepted.map((a) => a.stepKey)])].filter(finishedUnder);
  if (executed.length > 0) {
    // Still live: the feedback of chosen steps not run yet, and a chosen step running now (a parallel sibling) as re-running.
    const started = chosen.steps.filter((key) => !executed.includes(key) && executions.some((e) => e.stepKey === key && e.planNo === plan.planNo));
    const live = { ...Object.fromEntries(Object.entries(cands.feedback).filter(([key]) => !executed.includes(key))), ...Object.fromEntries(started.map((key) => [key, []])) };
    // §5.5: an executed step the person accepted feeds the cutoff as unchanged for every later step.
    const unchanged = new Set(accepted.map((a) => a.stepKey).filter((key) => chosen.steps.includes(key) && finishedUnder(key)));
    const fills = new Set((cands.fills ?? []).filter((key) => !executed.includes(key)));
    const now = currentCandidates(deps, run, feedbackMessages(live), unchanged, fills);
    const kept = afterExecution({ chosen: chosen.steps, executed }, now).chosen;
    const steps = chosen.steps.filter((key) => kept.includes(key) || chosen.added.includes(key));
    if (steps.length !== chosen.steps.length) {
      deps.store.transaction(() => putPlan(deps.store, { ...plan, chosen: { ...chosen, steps } satisfies PlanChosen }));
      return "moved";
    }
  }
  return { flowRunId: run.row.id, planNo: plan.planNo, by: plan.by, via: plan.via, candidates: cands, chosen };
}

/**
 * Gaps spec §5.5: the person's (or the timeout's) answer on one step of the running plan, inside the caller's
 * transaction; returns the plan as written. `run` takes a pending question into the plan's steps (template order).
 * `accept-unchanged` on a pending step, or a chosen step with no execution under the plan yet, takes it out (the kernel
 * carries its output forward when it reaches it); on a step executed under the plan it records that its new output
 * counts as unchanged (the cutoff). Anything else -- not in the plan, never succeeded, running, already decided -- is
 * `flow-plan-step-not-candidate`. Steps only ever leave a plan by accept; `run` only answers a question the plan asked.
 */
export function decidePlanStep(store: ControlStore, run: LoadedRun, plan: PlanRow, stepKey: string, answer: PendingAnswer): PlanRow {
  const chosen = plan.chosen as PlanChosen;
  const pending = chosen.pending ?? [];
  const accepted = chosen.accepted ?? [];
  const refuse = (why: string): never => { throw new FlowRefusal("flow-plan-step-not-candidate", `${stepKey}: ${why}`); };
  if (accepted.some((a) => a.stepKey === stepKey)) refuse("already accepted as unchanged");
  const open = pending.find((p) => p.stepKey === stepKey && p.answer === null);
  const answerOpen = (items: PendingItem[]): PendingItem[] => items.map((p) => (p === open ? { ...p, answer } : p));
  const order = run.template.steps.map((s) => s.id);
  let next: PlanChosen;
  if (answer.choice === "run") {
    if (open === undefined) refuse("no open question on it in this plan");
    next = { ...chosen, steps: order.filter((key) => key === stepKey || chosen.steps.includes(key)), pending: answerOpen(pending) };
  } else {
    const under = listExecutions(store, run.row.id).filter((e) => e.stepKey === stepKey && e.planNo === plan.planNo);
    const executed = under.find((e) => e.state === "done" && (e.body as StoredBody).carriedForward === undefined);
    const head = getHead(store, run.row.id, stepKey);
    let seq: number;
    if (open !== undefined || (chosen.steps.includes(stepKey) && under.length === 0)) {
      if (head === null) refuse("it has no output to keep");
      seq = head!;
    } else if (executed !== undefined && chosen.steps.includes(stepKey)) seq = executed.seq;
    else return refuse(under.length > 0 ? "it is running under this plan" : "not in this plan");
    const { at, by, via, source } = answer;
    const item: AcceptedItem = { stepKey, seq, by, via, at, source, ranOnInputs: ranOnInputsOf(store, run, stepKey) };
    next = executed !== undefined && open === undefined
      ? { ...chosen, accepted: [...accepted, item] }
      : { ...chosen, steps: chosen.steps.filter((key) => key !== stepKey), pending: answerOpen(pending), accepted: [...accepted, item] };
  }
  const row: PlanRow = { ...plan, chosen: next };
  putPlan(store, row);
  return row;
}

/**
 * Gaps spec §6.1-§6.2 (Review Focus 3): the person skipped or deferred `stepKey` while a running plan still had it to
 * run: it leaves the plan (steps only ever leave), with any question still open on it. Inside the caller's transaction.
 */
export function dropFromOpenPlan(store: ControlStore, flowRunId: string, stepKey: string): void {
  const plan = openPlan(store, flowRunId);
  const chosen = plan?.chosen as PlanChosen | null | undefined;
  if (plan === null || plan.state !== "running" || chosen == null) return;
  if (listExecutions(store, flowRunId).some((e) => e.stepKey === stepKey && e.planNo === plan.planNo && (e.body as StoredBody).carriedForward === undefined && e.state !== "skipped")) return;
  const pending = (chosen.pending ?? []).filter((p) => !(p.stepKey === stepKey && p.answer === null));
  if (!chosen.steps.includes(stepKey) && pending.length === (chosen.pending ?? []).length) return;
  putPlan(store, { ...plan, chosen: { ...chosen, steps: chosen.steps.filter((key) => key !== stepKey), ...(chosen.pending === undefined ? {} : { pending }) } satisfies PlanChosen });
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

/**
 * §7.4, §8.1 `orca flow discard-plan` (human-only, the `flow-rerun` verb with `discard`): the person withdraws the open
 * plan they have not run. It is `abandoned`; the person's feedback that made it (and that it carried in from older
 * plans) is `excluded` -- messages only move forward, and an `accepted` one would rebuild the same plan at the next
 * boundary -- so no later plan carries it and no rewind re-applies it. Edits stay: they are outputs already (a rewind
 * undoes those). Only the newest open, proposed plan can be discarded: anything else is `flow-plan-stale`.
 */
export async function discardPlan(deps: FlowDeps, flowRunId: string, planNo: number, by: string, via: string): Promise<void> {
  loadRun(deps.store, flowRunId);
  const plan = openPlan(deps.store, flowRunId);
  if (plan === null || plan.planNo !== planNo || plan.state !== "proposed") throw new FlowRefusal("flow-plan-stale", `plan ${planNo}`);
  const feedback = (plan.candidates as PlanCandidates).feedback;
  const withdrawn = listMessages(deps.store, flowRunId).filter((m) => {
    if (m.kind !== "feedback" || m.state !== "applied" || m.by === "orca-auto") return false;
    const body = m.body as { text?: unknown; target?: { stepKey?: string } };
    const key = body.target?.stepKey;
    return key !== undefined && (feedback[key] ?? []).includes(String(body.text));
  });
  const at = deps.now();
  deps.store.transaction(() => {
    putPlan(deps.store, { ...plan, state: "abandoned" });
    for (const m of withdrawn) setMessageState(deps.store, flowRunId, m.seq, "applied", "excluded", `excluded by discarding plan ${planNo}`);
    appendMessage(deps.store, {
      flowRunId, requestId: `discard-plan:${planNo}`, kind: "command", target: "run", body: { command: "discard-plan", planNo, excluded: withdrawn.map((m) => m.seq) },
      by, via, state: "applied", reason: null, at,
    });
  });
  await advanceRun(deps, flowRunId);
}
