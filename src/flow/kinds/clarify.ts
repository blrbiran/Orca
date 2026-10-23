/**
 * Flow engine spec §10 (H22, H23; plan Task 8 criteria C8, C9): the `clarify` kind on the flow host. Today's round
 * machinery -- `requirement_rounds`, the call purpose `clarify`, CLARIFY_CAPS, the output classifier, the active chain --
 * keyed by (parent group, step key, execution), never the dev flow's ('clarify', 1). The template supplies background,
 * focus and sections; the context is the run's params and a bounded listing of the composition; consensus completes the
 * step with the document as its output record.
 *
 * Optional at three levels (§10.2): a template may omit the step; under `mode: auto` a round-1 answer may claim zero
 * rounds, which code accepts only for small + clear (one minor decision records the understanding); a run started with
 * `clarify: skip` records the idea as the document, marked not clarified.
 */
import { callRecordOf } from "../calls.js";
import { sha256Canonical, canonicalBytes } from "../../control/canonicalJson.js";
import { activeChain, chainRounds, reviseRound, supersededForPrompt, type RevisionPayload } from "../../control/clarifyChain.js";
import { flowClarifyInstruction, flowClarifyJsonSchema, type ClarifyHost, type ConsensusInput } from "../../control/clarifyHost.js";
import { buildClarifyPrompt, classifyClarifyOutput } from "../../control/requirementClarify.js";
import { latestRoundAt, newRound, readRoundsAt, writeRoundAt, type RoundsKey } from "../../control/requirementRecords.js";
import { CLARIFY_CAPS, MAX_AUTO_RETRIES, clarifyTier, type ClassPair, type RoundBody } from "../../control/requirementSchemas.js";
import { appendQueued, applyOutcome, compositionFor, contextFor, FlowRefusal, loadRun, startQueued, stepOf, type FlowDeps } from "../kernel.js";
import { makePlan } from "../rerun.js";
import { finishExecution, getHead, listExecutions, type ExecutionRow, type ExecutionState } from "../store.js";
import type { FlowStep } from "../template/schema.js";
import { vaultGit } from "../vault/vault.js";
import type { ExecutionBody, KindContext, KindDefinition, LoadedRun } from "./registry.js";

type ClarifyStep = Extract<FlowStep, { kind: "clarify" }>;
/** The driver run whose output the kernel is judging (flow/calls.ts stores it with the output). */
const callRunOf = (ctx: KindContext): string | undefined => (ctx.body as { callResult?: { runId?: string } }).callResult?.runId;
const LISTING_MAX = 500;
/** A clarify step that drafts no further round and waits for the person to agree (the run view's needsYou reason). */
export const CLARIFY_AWAITING_CONSENSUS = "clarify-awaiting-consensus";
export const FLOW_CLARIFY_MAX_OUTPUT_TOKENS = 64_000;

const roundsKey = (run: LoadedRun, stepKey: string, execSeq: number): RoundsKey => ({ groupId: run.row.groupId, stepKey, execSeq });
const clarifyStep = (step: FlowStep): ClarifyStep => {
  if (step.kind !== "clarify") throw new Error("orca: clarify kind on a non-clarify step");
  return step;
};

/**
 * Round 1's class, as the classifier and the caps read it: the first position of the active chain (gaps spec §9: a
 * revision copies only the chain into a new execution, and a revision of round 1 carries round 1's result).
 */
function effectiveClass(rounds: readonly RoundBody[]): ClassPair | null {
  const c = chainRounds(rounds)[0]?.result?.classification;
  return c === undefined ? null : { scope: c.scope, clarity: c.clarity };
}
const roundCap = (rounds: readonly RoundBody[]): number => CLARIFY_CAPS[clarifyTier(effectiveClass(rounds))].rounds;

/** Spec §10.1 flow host: `flowClarifyHost(run, step, execSeq)`; `onConsensus` hands the document to `complete`. */
export function flowClarifyHost(store: FlowDeps["store"], run: LoadedRun, step: ClarifyStep, execSeq: number, complete: (document: unknown) => void = () => undefined): ClarifyHost {
  const zeroRound = step.mode === "auto";
  return {
    groupId: run.row.groupId, stepKey: step.id, execSeq,
    background: () => ({
      instruction: flowClarifyInstruction({ background: step.background === undefined ? "" : run.assets[step.background] ?? "", focus: step.focus ?? null, sections: step.sections ?? [], zeroRound }),
      contextName: "context",
    }),
    async context() {
      let files: string[] = [];
      let total = 0;
      if (run.body.vaultPath !== null && run.body.dir !== null && run.body.importCommit !== null) {
        const composition = await compositionFor(store, run, step.id);
        if (composition !== null) {
          const all = (await vaultGit(composition.vault, ["ls-tree", "-r", "--name-only", "-z", composition.commit])).split("\0").filter((p) => p.length > 0);
          total = all.length;
          files = all.slice(0, LISTING_MAX);
        }
      }
      const context = { params: run.params, files, ...(total > files.length ? { filesCut: total - files.length } : {}) };
      return { canonicalJson: canonicalBytes(context).toString("utf8"), hash: sha256Canonical(context) };
    },
    sections: () => step.sections ?? [],
    onConsensus(input: ConsensusInput) {
      const rounds = chainRounds(readRoundsAt(store, roundsKey(run, step.id, execSeq)));
      complete(documentOf(step, rounds, { openBranches: input.openBranches, openQuestions: input.openQuestions }));
      return null;
    },
  };
}

/** The step's output record: the brief as the chain of rounds left it (spec §10.1 "the requirement document"). */
function documentOf(step: ClarifyStep, chain: readonly RoundBody[], extra: Record<string, unknown>): unknown {
  const understood = chain.filter((r) => r.result !== null);
  const last = understood.at(-1)?.result ?? null;
  const accepted = (decisions: RoundBody["glossaryDecisions"]) => new Set((decisions ?? []).filter((d) => d.accept).map((d) => d.id));
  return {
    schema: "orca-flow-clarify-document-v1", sections: step.sections ?? [],
    statement: last?.statement ?? "", acceptanceCriteria: last?.acceptanceCriteria ?? [],
    rounds: understood.map((r) => {
      const answerOf = new Map((r.answers ?? []).map((a) => [a.id, a.text]));
      return { roundNo: r.roundNo, questions: r.result!.questions.map((q) => ({ id: q.id, question: q.question, recommendedAnswer: q.recommendedAnswer, answer: answerOf.get(q.id) ?? null })) };
    }),
    glossary: understood.flatMap((r) => r.result!.glossary.filter((g) => accepted(r.glossaryDecisions).has(g.id))),
    adrs: understood.flatMap((r) => r.result!.adrs.filter((a) => accepted(r.adrDecisions).has(a.id))),
    ...extra,
  };
}

async function clarifyPrompt(ctx: KindContext, host: ClarifyHost, rounds: RoundBody[], drafting: RoundBody): Promise<string> {
  const context = await host.context();
  const { chain } = activeChain(rounds);
  const position = chain.indexOf(drafting.roundNo);
  return buildClarifyPrompt({
    idea: String(ctx.run.params.idea ?? ""), contentLanguage: ctx.run.params.language === "zh" ? "zh" : "en", overview: context,
    earlier: chainRounds(rounds).filter((r) => r.roundNo !== drafting.roundNo), retryReason: ctx.body.retryReason,
    limits: { roundNo: position === -1 ? drafting.roundNo : position + 1, classification: effectiveClass(rounds), roundCap: roundCap(rounds) },
    // Gaps spec §9 (F §10.3): superseded rounds go in as earlier answers that may still apply, unless a revision excluded them.
    superseded: supersededForPrompt(rounds), frame: host.background(),
  });
}

export const CLARIFY_KIND: KindDefinition = {
  kind: "clarify", kindVersion: 1, interactive: true,
  async start(ctx) {
    const step = clarifyStep(ctx.step);
    // §10.2 level 3: skipped at start, the document is the idea, marked not clarified.
    if (ctx.run.body.clarify === "skip") {
      return { done: { record: { schema: "orca-flow-clarify-document-v1", sections: step.sections ?? [], statement: String(ctx.run.params.idea ?? ""), acceptanceCriteria: [], rounds: [], glossary: [], adrs: [], notClarified: true } } };
    }
    const key = roundsKey(ctx.run, step.id, ctx.key.seq);
    let drafting = latestRoundAt(ctx.store, key);
    if (drafting === null) { drafting = newRound(1); writeRoundAt(ctx.store, key, drafting); }
    // Gaps spec §9: a revision whose chain re-advances to "waits for consensus" starts waiting on the person; the reviser
    // then says why (advanceChain).
    if (drafting.state === "answered" && ctx.body.revision !== undefined) return { waiting: { ask: { kind: "clarify-round", roundNo: drafting.roundNo } } };
    if (drafting.state !== "drafting") throw new Error(`orca: clarify ${step.id}#${ctx.key.seq} has no round drafting`);
    const host = flowClarifyHost(ctx.store, ctx.run, step, ctx.key.seq);
    const prompt = await clarifyPrompt(ctx, host, readRoundsAt(ctx.store, key), drafting);
    return { call: { purpose: "clarify", prompt, responseSchema: flowClarifyJsonSchema(step.mode === "auto") as Record<string, unknown>, maxOutputTokens: FLOW_CLARIFY_MAX_OUTPUT_TOKENS } };
  },
  collect(ctx, raw) {
    const step = clarifyStep(ctx.step);
    const store = ctx.store;
    const key = roundsKey(ctx.run, step.id, ctx.key.seq);
    const round = latestRoundAt(store, key);
    if (round === null || round.state !== "drafting") throw new Error(`orca: clarify ${step.id}#${ctx.key.seq} has no round drafting`);
    const rounds = readRoundsAt(store, key);
    // Task 8 deferral (d): the round keeps a record of each of its calls, as a requirement round does (callOf).
    const withCall = (outcome: "valid" | "invalid", reason: string | null): RoundBody["calls"] => {
      const call = callRecordOf(store, callRunOf(ctx), outcome, reason);
      return call === null ? round.calls : [...round.calls, call];
    };
    const invalid = (reason: string) => {
      const exhausted = round.retries >= MAX_AUTO_RETRIES;
      const calls = withCall("invalid", reason);
      writeRoundAt(store, key, exhausted ? { ...round, calls, state: "failed", reasonCode: "clarify-output-invalid", lastInvalidReason: reason } : { ...round, calls, retries: round.retries + 1, lastInvalidReason: reason });
      return { invalid: reason } as const;
    };
    // §10.2 level 2: the zero-round claim is read on its own, then the rest goes to the shared classifier.
    let zero: { understanding: string } | null = null;
    let rest = raw;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && ("zeroRound" in raw || "understanding" in raw)) {
      const { zeroRound, understanding, ...others } = raw as Record<string, unknown>;
      rest = others;
      if (zeroRound === true) {
        if (typeof understanding !== "string" || understanding.trim() === "") return invalid("zero-round-without-understanding");
        zero = { understanding };
      } else if (zeroRound !== undefined && zeroRound !== false) return invalid("schema:zeroRound:must be a boolean");
    }
    const earlierQuestionIds = rounds.filter((r) => r.roundNo < round.roundNo).flatMap((r) => r.result?.questions.map((q) => q.id) ?? []);
    const classified = classifyClarifyOutput(rest, { roundNo: round.roundNo, requirementId: ctx.run.row.id.replace(/^fr-/, ""), earlierQuestionIds, classification: effectiveClass(rounds) });
    if (!classified.ok) return invalid(classified.reason);
    const result = classified.result;
    if (zero !== null) {
      const cls = result.classification;
      // Code decides: only under mode auto, only in round 1, only small + clear, and with nothing asked.
      if (step.mode !== "auto" || round.roundNo !== 1 || cls === undefined || cls.scope !== "small" || cls.clarity !== "clear" || result.questions.length > 0) {
        return invalid(`zero-round-not-allowed: zeroRound is accepted only in round 1 of a mode auto step judged small and clear with no questions (judged ${cls?.scope ?? "?"}/${cls?.clarity ?? "?"})`);
      }
      const at = new Date(ctx.now()).toISOString();
      writeRoundAt(store, key, { ...round, calls: withCall("valid", null), state: "answered", result, answers: [], glossaryDecisions: [], adrDecisions: [], answeredAt: at, closedByConsensus: true, lastInvalidReason: null });
      const chain = chainRounds(readRoundsAt(store, key));
      return {
        done: {
          record: documentOf(step, chain, { openBranches: result.openBranches, openQuestions: [], zeroRound: true, understanding: zero.understanding }),
          decisions: [{ grade: "minor", by: "orca-auto", body: { kind: "clarify-zero-round", understanding: zero.understanding, classification: cls } }],
        },
      };
    }
    writeRoundAt(store, key, { ...round, calls: withCall("valid", null), state: "awaiting-answers", result, lastInvalidReason: null });
    return { waiting: { ask: { kind: "clarify-round", roundNo: round.roundNo } } };
  },
  callFailed(ctx, failure) {
    const key = roundsKey(ctx.run, ctx.step.id, ctx.key.seq);
    const round = latestRoundAt(ctx.store, key);
    const call = callRecordOf(ctx.store, callRunOf(ctx), "failed", failure);
    if (round !== null && round.state === "drafting" && call !== null) writeRoundAt(ctx.store, key, { ...round, calls: [...round.calls, call] });
  },
  projection: (record) => {
    const doc = record as { statement: string; acceptanceCriteria: Array<{ id: string; text: string }>; notClarified?: boolean };
    return [doc.statement, ...doc.acceptanceCriteria.map((c) => `- ${c.id}: ${c.text}`), ...(doc.notClarified === true ? ["(not clarified)"] : [])].join("\n");
  },
};

function waitingClarify(deps: FlowDeps, target: { flowRunId: string; stepKey: string }): { run: LoadedRun; step: ClarifyStep; execution: ExecutionRow; key: RoundsKey } {
  const run = loadRun(deps.store, target.flowRunId);
  const step = stepOf(run, target.stepKey);
  if (step.kind !== "clarify") throw new FlowRefusal("flow-step-not-found", `${target.stepKey} is not a clarify step`);
  const execution = listExecutions(deps.store, target.flowRunId).filter((e) => e.stepKey === target.stepKey).at(-1);
  if (execution === undefined || execution.state !== "needs-person") throw new FlowRefusal("flow-ask-closed", target.stepKey);
  return { run, step, execution, key: roundsKey(run, step.id, execution.seq) };
}

/** A person answers the round awaiting answers; the next round is drafted unless the frontier is empty or the cap is reached. */
export async function answerFlowClarify(deps: FlowDeps, target: { flowRunId: string; stepKey: string }, payload: {
  roundNo: number; answers: Array<{ id: string; kind: "recommended" } | { id: string; kind: "text"; text: string }>;
  glossaryDecisions: Array<{ id: string; accept: boolean }>; adrDecisions: Array<{ id: string; accept: boolean }>;
}, by: string, via: string): Promise<void> {
  const { run, execution, key } = waitingClarify(deps, target);
  const round = latestRoundAt(deps.store, key);
  if (round === null || round.state !== "awaiting-answers" || round.roundNo !== payload.roundNo) throw new FlowRefusal("flow-ask-closed", `round ${payload.roundNo}`);
  const questions = new Map(round.result!.questions.map((q) => [q.id, q]));
  const ids = payload.answers.map((a) => a.id);
  if (new Set(ids).size !== ids.length || ids.length !== questions.size || ids.some((id) => !questions.has(id))) throw new FlowRefusal("flow-answer-invalid", "answer every question of the round once");
  const answers = payload.answers.map((a) => ({ id: a.id, kind: a.kind, text: a.kind === "text" ? a.text : questions.get(a.id)!.recommendedAnswer }));
  writeRoundAt(deps.store, key, { ...round, state: "answered", answers, glossaryDecisions: payload.glossaryDecisions, adrDecisions: payload.adrDecisions, answeredAt: new Date(deps.now()).toISOString(), by, via });
  await advanceChain(deps, run, target, execution, key, round, "needs-person");
}

/**
 * After a round on the chain was answered (or revised): the next round is drafted -- one clarify call -- unless the
 * frontier is empty or the chain is at the cap; then the step waits for the person to agree with it as it stands.
 */
async function advanceChain(deps: FlowDeps, run: LoadedRun, target: { flowRunId: string; stepKey: string }, execution: ExecutionRow, key: RoundsKey, answered: RoundBody, from: ExecutionState): Promise<void> {
  const rounds = readRoundsAt(deps.store, key);
  if (stopsHere(rounds, answered)) {
    // Clarification stops as today: the person reaches consensus (or, later, grants one more round). T18 acceptance:
    // stopping silently left the answered round's ask on show, so the step now says it waits for the person to agree.
    const cause = answered.result!.frontierEmpty ? "nothing-left-to-ask" : "round-cap";
    const why = cause === "round-cap" ? `the cap is ${roundCap(rounds)} rounds` : "the clarifier has nothing left to ask";
    const needsYou = {
      reason: CLARIFY_AWAITING_CONSENSUS, roundNo: answered.roundNo, cause,
      text: `Round ${answered.roundNo} is answered and no further round is drafted (${why}). The brief waits for you to agree with it as it stands: orca flow answer ${target.flowRunId} ${target.stepKey} --consensus`,
    };
    deps.store.transaction(() => finishExecution(deps.store, execution, from, "needs-person", deps.now(), { body: { ...(execution.body as ExecutionBody), needsYou } }));
    return;
  }
  writeRoundAt(deps.store, key, newRound(Math.max(...rounds.map((r) => r.roundNo)) + 1));
  const body: ExecutionBody = { ...(execution.body as ExecutionBody), retries: 0, retryReason: null };
  delete body.ask;
  const next = { ...execution, body };
  await applyOutcome(deps, run, next, from, await CLARIFY_KIND.start(contextFor(deps, run, next)));
}

/** No further round after `answered`: the frontier is empty or the chain is at the cap. */
const stopsHere = (rounds: readonly RoundBody[], answered: RoundBody): boolean =>
  answered.result!.frontierEmpty || activeChain(rounds).chain.length >= roundCap(rounds);

/** Gaps spec §9: a refusal of the shared revision check, under the flow's names. */
function refused(refusal: string, roundNo: number): FlowRefusal {
  if (refusal === "round-not-revisable") return new FlowRefusal(ROUND_NOT_REVISABLE, `round ${roundNo} is not an answered round on the active chain`);
  if (refusal === "revision-unchanged") return new FlowRefusal("revision-unchanged", `round ${roundNo}`);
  if (refusal === "exclude") return new FlowRefusal("flow-message-invalid:exclude", "exclude names only rounds this revision leaves off the chain");
  return new FlowRefusal(`flow-answer-invalid:${refusal}`, `cover exactly round ${roundNo}'s ids`);
}

export const ROUND_NOT_REVISABLE = "flow-round-not-revisable";

/**
 * Gaps spec §9: the clarify execution an `edit` at a round revises -- the newest while it waits on the person (in
 * progress), else the active one once done. A newer execution that waits keeps a done one from being revised beside it.
 */
function revisionTarget(deps: FlowDeps, run: LoadedRun, stepKey: string): { execution: ExecutionRow; inProgress: boolean } {
  const step = run.template.steps.find((s) => s.id === stepKey);
  if (step?.kind !== "clarify") throw new FlowRefusal(ROUND_NOT_REVISABLE, `${stepKey} is not a clarify step`);
  const executions = listExecutions(deps.store, run.row.id).filter((e) => e.stepKey === stepKey);
  const newest = executions.at(-1);
  if (newest?.state === "needs-person") return { execution: newest, inProgress: true };
  const active = executions.find((e) => e.seq === getHead(deps.store, run.row.id, stepKey));
  if (active?.state === "done" && newest?.state !== "running" && newest?.state !== "queued") return { execution: active, inProgress: false };
  throw new FlowRefusal(ROUND_NOT_REVISABLE, `${stepKey} has no clarify execution waiting on the person or done`);
}

/** Gaps spec §9: what can be told when the message arrives (the boundary checks again): null, or the refusal code. */
export function roundRevisionRefusal(deps: FlowDeps, run: LoadedRun, stepKey: string, payload: RevisionPayload): string | null {
  const steps = listExecutions(deps.store, run.row.id).filter((e) => e.stepKey === stepKey);
  // A round is being drafted: what the chain will be is known only at the boundary.
  if (steps.at(-1)?.state === "running" || steps.at(-1)?.state === "queued") return null;
  try {
    const { execution, inProgress } = revisionTarget(deps, run, stepKey);
    const rounds = readRoundsAt(deps.store, roundsKey(run, stepKey, execution.seq));
    // As reviseFlowRound checks it: the execution's rows in progress, the chain a new execution would copy once done.
    const revision = reviseRound(inProgress ? rounds : chainRounds(rounds), payload, { at: new Date(0).toISOString(), by: "check" });
    return "refusal" in revision ? refused(revision.refusal, payload.roundNo).code : null;
  } catch (error) {
    if (error instanceof FlowRefusal) return error.code;
    throw error;
  }
}

/**
 * Gaps spec §9 (F §10.3 on the flow host): revise round k of a clarify step, at a boundary. Nothing is overwritten.
 * - In progress (the newest execution waits on the person): row n+1 `{revises: k}` is appended to its rounds and the chain
 *   re-advances there (at most one clarify call).
 * - Done: execution seq+1 of the step takes a copy of the active execution's chain (new rows) plus the revision row and
 *   re-advances there. The step's active output stays the old document until that execution reaches consensus
 *   (`flowClarifyConsensus` moves the head and makes the plan).
 */
export async function reviseFlowRound(deps: FlowDeps, run: LoadedRun, stepKey: string, payload: RevisionPayload, by: string, via: string, messageSeq: number): Promise<void> {
  const { execution, inProgress } = revisionTarget(deps, run, stepKey);
  const target = { flowRunId: run.row.id, stepKey };
  const who = { at: new Date(deps.now()).toISOString(), by, via };
  if (inProgress) {
    const key = roundsKey(run, stepKey, execution.seq);
    const revision = reviseRound(readRoundsAt(deps.store, key), payload, who);
    if ("refusal" in revision) throw refused(revision.refusal, payload.roundNo);
    deps.store.transaction(() => writeRoundAt(deps.store, key, revision.row));
    const body = { ...(execution.body as ExecutionBody) };
    delete body.ask;
    delete (body as { needsYou?: unknown }).needsYou;
    await advanceChain(deps, run, target, { ...execution, body }, key, revision.row, "needs-person");
    return;
  }
  const copied = chainRounds(readRoundsAt(deps.store, roundsKey(run, stepKey, execution.seq)));
  const revision = reviseRound(copied, payload, who);
  if ("refusal" in revision) throw refused(revision.refusal, payload.roundNo);
  const seq = Math.max(...listExecutions(deps.store, run.row.id).filter((e) => e.stepKey === stepKey).map((e) => e.seq)) + 1;
  const key = roundsKey(run, stepKey, seq);
  const stops = stopsHere([...copied, revision.row], revision.row);
  deps.store.transaction(() => {
    appendQueued(deps, run, stepKey, seq, ["revise"], { revision: { message: messageSeq, of: execution.seq, roundNo: payload.roundNo } }, by, via, deps.now());
    for (const row of copied) writeRoundAt(deps.store, key, row);
    writeRoundAt(deps.store, key, revision.row);
    if (!stops) writeRoundAt(deps.store, key, newRound(revision.row.roundNo + 1));
  });
  // It starts as any queued execution does (review Minor 2): its basis and inputs recorded, a standing defer's hold, the
  // effect gate and the compose guard -- then the clarify kind drafts the next round, or waits for consensus.
  await startQueued(deps, run, listExecutions(deps.store, run.row.id).find((e) => e.stepKey === stepKey && e.seq === seq)!);
  const started = listExecutions(deps.store, run.row.id).find((e) => e.stepKey === stepKey && e.seq === seq)!;
  if (stops && started.state === "needs-person") await advanceChain(deps, run, target, started, key, revision.row, "needs-person");
}

/**
 * The person agrees (§10.2 level 3 mid-way stop included): unanswered questions are recorded open; the flow host's
 * consensus completes the step with the document. The requirement host's consensus (a split draft) is never involved.
 */
export async function flowClarifyConsensus(deps: FlowDeps, target: { flowRunId: string; stepKey: string }, by: string, via: string): Promise<void> {
  const { run, step, execution, key } = waitingClarify(deps, target);
  const round = latestRoundAt(deps.store, key);
  if (round === null || (round.state !== "awaiting-answers" && round.state !== "answered")) throw new FlowRefusal("flow-ask-closed", "no round to agree on");
  const at = new Date(deps.now()).toISOString();
  let openQuestions: string[] = [];
  if (round.state === "awaiting-answers") {
    openQuestions = round.result!.questions.map((q) => q.id);
    writeRoundAt(deps.store, key, { ...round, state: "answered", closedByConsensus: true, answers: [], glossaryDecisions: [], adrDecisions: [], answeredAt: at, by, via });
  }
  let document: unknown = null;
  const host = flowClarifyHost(deps.store, run, step, execution.seq, (doc) => { document = doc; });
  host.onConsensus({ roundNo: round.roundNo, at, openBranches: round.result?.openBranches ?? [], openQuestions, tag: `consensus-${execution.seq}` });
  const body: ExecutionBody = { ...(execution.body as ExecutionBody) };
  delete body.ask;
  delete (body as { needsYou?: unknown }).needsYou;
  await applyOutcome(deps, run, { ...execution, body }, "needs-person", { done: { record: document } });
  // Gaps spec §9: a revision's execution became the active output only now; the ordinary plan re-plans what follows.
  if (body.revision !== undefined) await makePlan(deps, run.row.id, { by, via, trigger: "edit", edits: [step.id] });
}
