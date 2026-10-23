/**
 * Flow engine spec §14.1-§14.2 (plan Task 15): the flow reads -- `flows` (every run), `flows/:id` (one run: its steps
 * with the active and newest execution, open asks and confirm cards, plans, effect records, decisions) and
 * `flows/:id/journal` (every execution and message). Plain JSON of what the store holds; the Web run page (Task 16) and
 * `orca flow show|list|journal` read them.
 */
import { activeChain } from "../control/clarifyChain.js";
import { latestRoundAt, readRoundsAt } from "../control/requirementRecords.js";
import type { RoundBody } from "../control/requirementSchemas.js";
import type { ControlStore } from "../control/store.js";
import type { ToolRulesReport } from "../control/toolRules.js";
import { FlowRefusal, latestByStep, loadRun, openAsks, recordOfExecution } from "./kernel.js";
import { heldBy, holdableAfter, marksOf } from "./marks.js";
import { whenParams } from "./template/checklist.js";
import { waitingIntakes } from "./feedback/intake.js";
import { executionSpend, intakeSpend, planSpend, sumSpend, type Spend } from "./spend.js";
import { FEEDBACK_KEY, getFlowRun, listEffects, listExecutions, listHeads, listIntakes, listMessages, listPlans, type ExecutionRow } from "./store.js";

/**
 * One execution as the run page shows it (Task 16): its state, why it ran, its output, red flags and -- for a `work`
 * step -- ccloop's tool-rule report as ccloop gave it (§16.2), plus what it waits on (`ask`, `needsYou`) and what the
 * agent reported (`reported`: candidates, an effect's remote id).
 */
export interface FlowExecutionViewV1 {
  seq: number; state: string; reasons: unknown[]; planNo: number | null; childGroupId: string | null; by: string; via: string;
  flags: string[]; failure: string | null;
  output: { kind: "commit" | "artifact" | "none"; ref: string | null; hash: string | null } | null;
  toolRules: ToolRulesReport | null; ask: unknown; needsYou: unknown; reported: unknown; warnings: string[]; effectRecordId: string | null;
  /** Gaps spec §10: the tool-reported tokens of its calls and child group; never an allocation. */
  spend: Spend;
}

/** Task 16: the run list (`orca flow list`, the kanban's flow cards); paired with the Web's copy (webParity). */
export interface FlowListV1 {
  schema: "orca-flow-list-v1";
  runs: Array<{ flowRunId: string; groupId: string; templateRef: string; state: string; poolTokens: number; poolDrawn: number; projectId: string | null; dir: string | null; needsYou: number }>;
}

export function readFlowList(store: ControlStore): FlowListV1 {
  const rows = store.db.prepare("SELECT id FROM flow_runs ORDER BY rowid").all() as Array<{ id: string }>;
  return {
    schema: "orca-flow-list-v1",
    runs: rows.map(({ id }) => {
      const row = getFlowRun(store, String(id))!;
      const body = row.body as { projectId?: string | null; dir?: string | null };
      return {
        flowRunId: row.id, groupId: row.groupId, templateRef: row.templateRef, state: row.state, poolTokens: row.poolTokens, poolDrawn: row.poolDrawn,
        // Task 16: the kanban card's project scope (a run's settings layer) and its folder.
        projectId: body.projectId ?? null, dir: body.dir ?? null,
        // Steps whose newest execution waits on the person (an ask, a confirm card, a question, an exhausted pool, an
        // effect a deferral holds), plus each deferred step: owed, "fill when ready" (gaps spec §6.2). A skip owes nothing.
        needsYou: [...latestByStep(listExecutions(store, row.id)).values()].filter((e) => e.state === "needs-person" || e.state === "parked").length
          + [...marksOf(listMessages(store, row.id)).values()].filter((m) => m.kind === "defer").length
          // Gaps spec §4.2: a feedback intake waiting on the person (a location to pick, a clarify round to answer).
          + waitingIntakes(store, row.id),
      };
    }),
  };
}

function executionView(store: ControlStore, execution: ExecutionRow): FlowExecutionViewV1 {
  const body = execution.body as Record<string, unknown>;
  const record = (body.record ?? null) as { toolRules?: ToolRulesReport | null } | null;
  return {
    seq: execution.seq, state: execution.state, reasons: execution.reasons, planNo: execution.planNo, childGroupId: execution.childGroupId, by: execution.by, via: execution.via,
    flags: (body.flags as string[] | undefined) ?? [], failure: (body.failure as string | undefined) ?? null,
    output: execution.outputKind === null ? null : { kind: execution.outputKind, ref: execution.outputRef, hash: execution.outputHash },
    toolRules: record?.toolRules ?? null, ask: body.ask ?? null, needsYou: body.needsYou ?? null, reported: body.reported ?? null,
    warnings: (body.warnings as string[] | undefined) ?? [], effectRecordId: typeof body.effectRecordId === "string" ? body.effectRecordId : null,
    spend: executionSpend(store, execution),
  };
}

/** A failed `work` execution keeps its tool-rule report in its artifact record (kernel.ts applyOutcome). */
function withArtifactRules(store: ControlStore, execution: ExecutionRow, view: FlowExecutionViewV1): FlowExecutionViewV1 {
  if (view.toolRules !== null || execution.outputKind !== "artifact") return view;
  const record = recordOfExecution(store, execution) as { toolRules?: ToolRulesReport | null } | null;
  return { ...view, toolRules: record?.toolRules ?? null };
}

export function readFlowRun(store: ControlStore, flowRunId: string): unknown {
  const run = loadRun(store, flowRunId);
  const executions = listExecutions(store, flowRunId);
  const latest = latestByStep(executions);
  const heads = listHeads(store, flowRunId);
  const plans = listPlans(store, flowRunId).map((plan) => ({ ...plan, spend: planSpend(store, plan) }));
  // Gaps spec §4, §10: each feedback intake -- what the person sent, where it was located (hits to pick from), which steps
  // take it, its waiting clarify round (answered with `flow-answer {feedback}`) -- and its single calls' spend.
  const intakes = listIntakes(store, flowRunId).map((intake) => {
    const { text, stepKey, anchors, results, ambiguousFiles, targets, restated, flags, planNo, asIs, attachments } = intake.body;
    const round = intake.state === "clarifying" ? latestRoundAt(store, { groupId: run.row.groupId, stepKey: FEEDBACK_KEY, execSeq: intake.messageSeq }) : null;
    const clarify = round?.state === "awaiting-answers" && round.result !== null && round.result !== undefined
      ? { roundNo: round.roundNo, questions: round.result.questions.map((q) => ({ id: q.id, question: q.question, recommendedAnswer: q.recommendedAnswer })) } : null;
    return { messageSeq: intake.messageSeq, state: intake.state, text, stepKey, anchors, results, ambiguousFiles, targets, restated, flags, planNo, asIs, attachments, clarify, spend: intakeSpend(store, intake) };
  });
  // Gaps spec §6: each step's standing mark (skip / defer, with a defer's effect choices) and the deferred steps holding it.
  const marks = marksOf(listMessages(store, flowRunId));
  const views = new Map(executions.map((e) => [`${e.stepKey}#${e.seq}`, withArtifactRules(store, e, executionView(store, e))]));
  const viewOf = (e: ExecutionRow) => views.get(`${e.stepKey}#${e.seq}`)!;
  const decisions = store.db.prepare(`SELECT seq, grade, step_key AS stepKey, body, "by" FROM flow_decisions WHERE flow_run_id=? ORDER BY seq`).all(flowRunId)
    .map((d) => ({ ...d, body: JSON.parse(String(d.body)) as unknown }));
  return {
    schema: "orca-flow-run-view-v1",
    flowRunId: run.row.id, groupId: run.row.groupId, templateRef: run.body.templateRef, state: run.row.state, params: run.params,
    poolTokens: run.row.poolTokens, poolDrawn: run.row.poolDrawn, by: run.body.by, via: run.body.via, dir: run.body.dir,
    // Why nothing moves, when a kernel pass keeps failing (kernel.recordRunError); null once a pass succeeds.
    lastError: (run.body as { lastError?: { message: string; at: number } }).lastError ?? null,
    template: { id: run.template.id, version: run.template.version ?? null, title: run.template.title ?? null },
    steps: run.template.steps.map((step) => {
      const newest = latest.get(step.id);
      const roundsOf = (execSeq: number) => clarifyOf(readRoundsAt(store, { groupId: run.row.groupId, stepKey: step.id, execSeq }));
      const mine = executions.filter((e) => e.stepKey === step.id);
      const effect = "effect" in step && typeof step.effect === "string" ? { kind: step.effect, class: run.template.effects?.[step.effect]?.class ?? null } : null;
      return {
        stepKey: step.id, kind: step.kind, head: heads[step.id] ?? null,
        mark: marks.get(step.id) ?? null, heldBy: heldBy(run.template, marks, step.id),
        executor: "executor" in step ? step.executor ?? null : null, parallelWith: step.parallelWith ?? null, effect,
        latest: newest === undefined ? null : viewOf(newest),
        executions: mine.map(viewOf),
        spend: sumSpend(mine.map((e) => viewOf(e).spend)),
        // §10.3, gaps spec §9: a clarify step's rounds of its active (head) execution -- the newest when none is active yet
        // -- and the active chain over them. A newer execution still at work on a revision (§9: after a done step was
        // revised, or a rewind) is `clarifyRevision`, its rounds and chain, so the page shows the active rounds as the
        // output and the revision as waiting, never the one in place of the other.
        clarify: step.kind !== "clarify" || newest === undefined ? null : roundsOf(heads[step.id] ?? newest.seq),
        clarifyRevision: step.kind !== "clarify" || newest === undefined || heads[step.id] === undefined || heads[step.id] === newest.seq
          || !REVISING.has(newest.state) ? null : { seq: newest.seq, state: newest.state, ...roundsOf(newest.seq) },
        // Gaps spec §6.3: the external/irreversible effect steps a defer of this step would hold (the defer dialog's rows).
        deferHolds: holdableAfter(run.template, step.id),
        // Gaps spec §8.4: the params this step's `when` reads, with their types ("set <param> instead").
        whenParams: step.when === undefined ? [] : [...new Set(whenParams(step.when))].map((id) => ({ id, type: run.template.params?.[id]?.type ?? null })),
      };
    }),
    openAsks: openAsks(store, flowRunId),
    plans,
    intakes,
    // Gaps spec §10: every execution, intake and plan of the run; tool-reported tokens only.
    spend: sumSpend([...executions.map((e) => viewOf(e).spend), ...intakes.map((i) => i.spend), ...plans.map((p) => p.spend)]),
    effects: listEffects(store, flowRunId),
    decisions,
  };
}

/** An execution of a clarify step still working on its rounds (a revision in progress). */
const REVISING: ReadonlySet<string> = new Set(["queued", "running", "needs-person", "parked"]);

function clarifyOf(rounds: RoundBody[]): { rounds: RoundBody[]; chain: number[] } {
  return { rounds, chain: activeChain(rounds.map((r) => ({ roundNo: r.roundNo, ...(r.revises === undefined ? {} : { revises: r.revises }) }))).chain };
}

export function readFlowJournal(store: ControlStore, flowRunId: string): unknown {
  if (getFlowRun(store, flowRunId) === null) throw new FlowRefusal("flow-run-not-found", flowRunId);
  return { schema: "orca-flow-journal-v1", flowRunId, executions: listExecutions(store, flowRunId), messages: listMessages(store, flowRunId) };
}
