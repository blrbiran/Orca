/**
 * Flow engine spec §14.1-§14.2 (plan Task 15): the flow reads -- `flows` (every run), `flows/:id` (one run: its steps
 * with the active and newest execution, open asks and confirm cards, plans, effect records, decisions) and
 * `flows/:id/journal` (every execution and message). Plain JSON of what the store holds; the Web run page (Task 16) and
 * `orca flow show|list|journal` read them.
 */
import type { ControlStore } from "../control/store.js";
import { FlowRefusal, latestByStep, loadRun, openAsks } from "./kernel.js";
import { getFlowRun, listEffects, listExecutions, listHeads, listMessages, listPlans } from "./store.js";

export function readFlowList(store: ControlStore): unknown {
  const rows = store.db.prepare("SELECT id FROM flow_runs ORDER BY rowid").all() as Array<{ id: string }>;
  return {
    schema: "orca-flow-list-v1",
    runs: rows.map(({ id }) => {
      const row = getFlowRun(store, String(id))!;
      return { flowRunId: row.id, groupId: row.groupId, templateRef: row.templateRef, state: row.state, poolTokens: row.poolTokens, poolDrawn: row.poolDrawn };
    }),
  };
}

export function readFlowRun(store: ControlStore, flowRunId: string): unknown {
  const run = loadRun(store, flowRunId);
  const executions = listExecutions(store, flowRunId);
  const latest = latestByStep(executions);
  const heads = listHeads(store, flowRunId);
  const decisions = store.db.prepare(`SELECT seq, grade, step_key AS stepKey, body, "by" FROM flow_decisions WHERE flow_run_id=? ORDER BY seq`).all(flowRunId)
    .map((d) => ({ ...d, body: JSON.parse(String(d.body)) as unknown }));
  return {
    schema: "orca-flow-run-view-v1",
    flowRunId: run.row.id, groupId: run.row.groupId, templateRef: run.body.templateRef, state: run.row.state, params: run.params,
    poolTokens: run.row.poolTokens, poolDrawn: run.row.poolDrawn, by: run.body.by, via: run.body.via, dir: run.body.dir,
    steps: run.template.steps.map((step) => {
      const newest = latest.get(step.id);
      return {
        stepKey: step.id, kind: step.kind, head: heads[step.id] ?? null,
        latest: newest === undefined ? null : {
          seq: newest.seq, state: newest.state, reasons: newest.reasons, planNo: newest.planNo, childGroupId: newest.childGroupId, by: newest.by, via: newest.via,
          flags: (newest.body as { flags?: string[] }).flags ?? [], failure: (newest.body as { failure?: string }).failure ?? null,
        },
      };
    }),
    openAsks: openAsks(store, flowRunId),
    plans: listPlans(store, flowRunId),
    effects: listEffects(store, flowRunId),
    decisions,
  };
}

export function readFlowJournal(store: ControlStore, flowRunId: string): unknown {
  if (getFlowRun(store, flowRunId) === null) throw new FlowRefusal("flow-run-not-found", flowRunId);
  return { schema: "orca-flow-journal-v1", flowRunId, executions: listExecutions(store, flowRunId), messages: listMessages(store, flowRunId) };
}
