import { canonicalBytes } from "../control/canonicalJson.js";
import type { ControlStore } from "../control/store.js";

/**
 * Flow engine spec §6.1: typed access to the flow journal tables (schema 17). Executions and messages are append-only,
 * an execution's and an effect's state move forward only, and the step head moves by compare-and-swap on `active_seq`.
 * Callers run these inside the store's transaction; nothing here decides what a flow does (the kernel does, Task 8+).
 */

/** Thrown when a write would break one of the journal's rules; `code` names which. */
export class FlowStoreError extends Error {
  constructor(public readonly code: "flow-execution-backwards" | "flow-execution-stale" | "flow-head-stale" | "flow-effect-backwards" | "flow-effect-stale", detail: string) {
    super(`${code}:${detail}`);
    this.name = "FlowStoreError";
  }
}

const json = (value: unknown): string => canonicalBytes(value).toString("utf8");

export interface FlowRunRow {
  id: string; groupId: string; templateRef: string; templateSha256: string; workspace: unknown; vaultId: string | null; paramsSha256: string;
  poolTokens: number; poolDrawn: number; state: string; revision: number; body: unknown;
}

export function insertFlowRun(store: ControlStore, row: FlowRunRow): void {
  store.db.prepare(`INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,vault_id,params_sha256,pool_tokens,pool_drawn,state,revision,body)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.groupId, row.templateRef, row.templateSha256, json(row.workspace), row.vaultId, row.paramsSha256,
    row.poolTokens, row.poolDrawn, row.state, row.revision, json(row.body));
}

export function getFlowRun(store: ControlStore, id: string): FlowRunRow | null {
  const row = store.db.prepare("SELECT * FROM flow_runs WHERE id=?").get(id);
  if (!row) return null;
  return {
    id: String(row.id), groupId: String(row.group_id), templateRef: String(row.template_ref), templateSha256: String(row.template_sha256),
    workspace: JSON.parse(String(row.workspace)), vaultId: row.vault_id === null ? null : String(row.vault_id), paramsSha256: String(row.params_sha256),
    poolTokens: Number(row.pool_tokens), poolDrawn: Number(row.pool_drawn), state: String(row.state), revision: Number(row.revision), body: JSON.parse(String(row.body)),
  };
}

export type ExecutionState = "queued" | "running" | "done" | "failed" | "skipped" | "needs-person" | "parked" | "staged";
export interface ExecutionKey { flowRunId: string; stepKey: string; seq: number }
export interface ExecutionRow extends ExecutionKey {
  kind: string; kindVersion: number; state: ExecutionState; definitionHash: string; baseCommit: string | null; ranOn: string | null;
  fingerprint: string | null; outputKind: "commit" | "artifact" | "none" | null; outputRef: string | null; outputHash: string | null;
  readSetHash: string | null; reasons: unknown[]; planNo: number | null; childGroupId: string | null; by: string; via: string;
  createdAt: number; updatedAt: number; body: unknown;
}

/** Append-only: a second row with the same (run, step, seq) is refused by the primary key. */
export function appendExecution(store: ControlStore, row: ExecutionRow): void {
  store.db.prepare(`INSERT INTO step_executions(flow_run_id,step_key,seq,kind,kind_version,state,definition_hash,base_commit,ran_on,fingerprint,
    output_kind,output_ref,output_hash,read_set_hash,reasons,plan_no,child_group_id,"by",via,created_at,updated_at,body) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.flowRunId, row.stepKey, row.seq, row.kind, row.kindVersion, row.state, row.definitionHash, row.baseCommit, row.ranOn, row.fingerprint,
      row.outputKind, row.outputRef, row.outputHash, row.readSetHash, json(row.reasons), row.planNo, row.childGroupId, row.by, row.via,
      row.createdAt, row.updatedAt, json(row.body));
}

export function getExecutionState(store: ControlStore, key: ExecutionKey): ExecutionState | null {
  const row = store.db.prepare("SELECT state FROM step_executions WHERE flow_run_id=? AND step_key=? AND seq=?").get(key.flowRunId, key.stepKey, key.seq);
  return row ? String(row.state) as ExecutionState : null;
}

/**
 * Spec §6.1 "state moves forward only": nothing returns to `queued`; `running` ends or waits (`needs-person`, `parked`,
 * `staged`); a waiting execution resumes or ends; `done`, `failed` and `skipped` are final.
 */
const EXECUTION_FORWARD: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ["running", "skipped", "needs-person", "parked", "staged", "failed"],
  running: ["done", "failed", "needs-person", "parked", "staged"],
  "needs-person": ["running", "done", "failed", "skipped"],
  parked: ["running", "done", "failed", "skipped"],
  staged: ["running", "done", "failed", "skipped"],
  done: [], failed: [], skipped: [],
};

/** Compare-and-set: `from` must be the stored state (else stale) and `to` a forward move from it (else refused). */
export function setExecutionState(store: ControlStore, key: ExecutionKey, from: ExecutionState, to: ExecutionState, at: number): void {
  if (!EXECUTION_FORWARD[from].includes(to)) throw new FlowStoreError("flow-execution-backwards", `${key.stepKey}#${key.seq}:${from}->${to}`);
  const changed = store.db.prepare("UPDATE step_executions SET state=?, updated_at=? WHERE flow_run_id=? AND step_key=? AND seq=? AND state=?")
    .run(to, at, key.flowRunId, key.stepKey, key.seq, from).changes;
  if (changed !== 1) throw new FlowStoreError("flow-execution-stale", `${key.stepKey}#${key.seq}:${from}`);
}

export function getHead(store: ControlStore, flowRunId: string, stepKey: string): number | null {
  const row = store.db.prepare("SELECT active_seq FROM step_heads WHERE flow_run_id=? AND step_key=?").get(flowRunId, stepKey);
  return row ? Number(row.active_seq) : null;
}

/** The one mutable pointer, moved by CAS: `expected` is the active seq the caller read (null: no head yet). */
export function setHead(store: ControlStore, flowRunId: string, stepKey: string, expected: number | null, next: number): void {
  const changed = expected === null
    ? store.db.prepare("INSERT INTO step_heads(flow_run_id,step_key,active_seq) VALUES (?,?,?) ON CONFLICT(flow_run_id,step_key) DO NOTHING").run(flowRunId, stepKey, next).changes
    : store.db.prepare("UPDATE step_heads SET active_seq=? WHERE flow_run_id=? AND step_key=? AND active_seq=?").run(next, flowRunId, stepKey, expected).changes;
  if (changed !== 1) throw new FlowStoreError("flow-head-stale", `${stepKey}:${expected ?? "none"}`);
}

export interface MessageInput {
  flowRunId: string; requestId: string; kind: string; target: "run" | "step" | "execution" | "round" | "effect"; body: unknown;
  by: string; via: string; state: "accepted" | "applied" | "rejected" | "excluded"; reason: string | null; at: number;
}
export interface MessageRow extends MessageInput { seq: number }

const messageOf = (row: Record<string, unknown>): MessageRow => ({
  flowRunId: String(row.flow_run_id), seq: Number(row.seq), requestId: String(row.request_id), kind: String(row.kind), target: String(row.target) as MessageRow["target"],
  body: JSON.parse(String(row.body)), by: String(row.by), via: String(row.via), state: String(row.state) as MessageRow["state"],
  reason: row.reason === null ? null : String(row.reason), at: Number(row.at),
});

/** Spec §8.1: deduped by `request_id` -- a second message with the same id returns the stored row and writes nothing. */
export function appendMessage(store: ControlStore, input: MessageInput): { row: MessageRow; deduped: boolean } {
  const existing = store.db.prepare("SELECT * FROM flow_messages WHERE flow_run_id=? AND request_id=?").get(input.flowRunId, input.requestId);
  if (existing) return { row: messageOf(existing), deduped: true };
  const seq = Number(store.db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS next FROM flow_messages WHERE flow_run_id=?").get(input.flowRunId)!.next);
  store.db.prepare(`INSERT INTO flow_messages(flow_run_id,seq,request_id,kind,target,body,"by",via,state,reason,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.flowRunId, seq, input.requestId, input.kind, input.target, json(input.body), input.by, input.via, input.state, input.reason, input.at);
  return { row: { ...input, seq }, deduped: false };
}

export interface PlanRow {
  flowRunId: string; planNo: number; state: "proposed" | "chosen" | "running" | "done" | "abandoned";
  candidates: unknown; proposal: unknown | null; chosen: unknown | null; by: string; via: string;
}

export function putPlan(store: ControlStore, plan: PlanRow): void {
  store.db.prepare(`INSERT INTO rerun_plans(flow_run_id,plan_no,state,candidates,proposal,chosen,"by",via) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(flow_run_id,plan_no) DO UPDATE SET state=excluded.state, candidates=excluded.candidates, proposal=excluded.proposal,
    chosen=excluded.chosen, "by"=excluded."by", via=excluded.via`)
    .run(plan.flowRunId, plan.planNo, plan.state, json(plan.candidates), plan.proposal === null ? null : json(plan.proposal),
      plan.chosen === null ? null : json(plan.chosen), plan.by, plan.via);
}

export type EffectState = "staged" | "confirmed" | "applied" | "discarded" | "failed";
export interface EffectRow {
  id: string; flowRunId: string; stepKey: string; seq: number; effectKind: string; class: string; level: string; policy: unknown;
  state: EffectState; payloadHash: string; remoteRef: string | null; by: string; via: string; createdAt: number; updatedAt: number;
}

export function putEffect(store: ControlStore, row: EffectRow): void {
  store.db.prepare(`INSERT INTO effect_records(id,flow_run_id,step_key,seq,effect_kind,class,level,policy,state,payload_hash,remote_ref,"by",via,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.flowRunId, row.stepKey, row.seq, row.effectKind, row.class, row.level, json(row.policy),
    row.state, row.payloadHash, row.remoteRef, row.by, row.via, row.createdAt, row.updatedAt);
}

/** Spec §6.1 "immutable except `state` forward": staged → confirmed → applied; discard or failure ends it. */
const EFFECT_FORWARD: Record<EffectState, readonly EffectState[]> = {
  staged: ["confirmed", "discarded", "failed"],
  confirmed: ["applied", "discarded", "failed"],
  applied: [], discarded: [], failed: [],
};

export function setEffectState(store: ControlStore, id: string, from: EffectState, to: EffectState, at: number, remoteRef?: string): void {
  if (!EFFECT_FORWARD[from].includes(to)) throw new FlowStoreError("flow-effect-backwards", `${id}:${from}->${to}`);
  const changed = store.db.prepare("UPDATE effect_records SET state=?, updated_at=?, remote_ref=COALESCE(?, remote_ref) WHERE id=? AND state=?")
    .run(to, at, remoteRef ?? null, id, from).changes;
  if (changed !== 1) throw new FlowStoreError("flow-effect-stale", `${id}:${from}`);
}

/** Spec §6.2: a `dir` run's decisions, numbered per run; returns the seq written. */
export function appendFlowDecision(store: ControlStore, row: { flowRunId: string; grade: "major" | "minor"; stepKey: string; body: unknown; by: string }): number {
  const seq = Number(store.db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS next FROM flow_decisions WHERE flow_run_id=?").get(row.flowRunId)!.next);
  store.db.prepare(`INSERT INTO flow_decisions(flow_run_id,seq,grade,step_key,body,"by") VALUES (?,?,?,?,?,?)`).run(row.flowRunId, seq, row.grade, row.stepKey, json(row.body), row.by);
  return seq;
}

/** Spec §11.3: the template index, upserted by (layer, id, version) -- built-ins are seeded this way on every start. */
export function upsertTemplateIndex(store: ControlStore, row: { layer: string; id: string; version: number; sha256: string; path: string; publishedBy: string; publishedAt: number }): void {
  store.db.prepare(`INSERT INTO flow_templates(layer,id,version,sha256,path,published_by,published_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(layer,id,version) DO UPDATE SET sha256=excluded.sha256, path=excluded.path, published_by=excluded.published_by, published_at=excluded.published_at`)
    .run(row.layer, row.id, row.version, row.sha256, row.path, row.publishedBy, row.publishedAt);
}

const executionOf = (row: Record<string, unknown>): ExecutionRow => ({
  flowRunId: String(row.flow_run_id), stepKey: String(row.step_key), seq: Number(row.seq), kind: String(row.kind), kindVersion: Number(row.kind_version),
  state: String(row.state) as ExecutionState, definitionHash: String(row.definition_hash), baseCommit: row.base_commit === null ? null : String(row.base_commit),
  ranOn: row.ran_on === null ? null : String(row.ran_on), fingerprint: row.fingerprint === null ? null : String(row.fingerprint),
  outputKind: row.output_kind === null ? null : String(row.output_kind) as ExecutionRow["outputKind"], outputRef: row.output_ref === null ? null : String(row.output_ref),
  outputHash: row.output_hash === null ? null : String(row.output_hash), readSetHash: row.read_set_hash === null ? null : String(row.read_set_hash),
  reasons: JSON.parse(String(row.reasons)) as unknown[], planNo: row.plan_no === null ? null : Number(row.plan_no),
  childGroupId: row.child_group_id === null ? null : String(row.child_group_id), by: String(row.by), via: String(row.via),
  createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), body: JSON.parse(String(row.body)),
});

/** Every execution of a run, by step then seq. */
export function listExecutions(store: ControlStore, flowRunId: string): ExecutionRow[] {
  return store.db.prepare("SELECT * FROM step_executions WHERE flow_run_id=? ORDER BY step_key, seq").all(flowRunId).map(executionOf);
}

/**
 * Plan Task 8: an execution moves forward (as setExecutionState) and, in the same write, may take its output -- set once,
 * never replaced -- and a new body (the kernel's own bookkeeping: retries, the prompt sent, the ask it opened).
 */
export function finishExecution(store: ControlStore, key: ExecutionKey, from: ExecutionState, to: ExecutionState, at: number,
  change: { output?: { kind: "commit" | "artifact" | "none"; ref: string | null; hash: string | null }; body?: unknown; baseCommit?: string; childGroupId?: string } = {}): void {
  if (from !== to) setExecutionState(store, key, from, to, at);
  else if (store.db.prepare("UPDATE step_executions SET updated_at=? WHERE flow_run_id=? AND step_key=? AND seq=? AND state=?").run(at, key.flowRunId, key.stepKey, key.seq, from).changes !== 1) {
    throw new FlowStoreError("flow-execution-stale", `${key.stepKey}#${key.seq}:${from}`);
  }
  if (change.output !== undefined) {
    const changed = store.db.prepare("UPDATE step_executions SET output_kind=?, output_ref=?, output_hash=? WHERE flow_run_id=? AND step_key=? AND seq=? AND output_kind IS NULL")
      .run(change.output.kind, change.output.ref, change.output.hash, key.flowRunId, key.stepKey, key.seq).changes;
    if (changed !== 1) throw new FlowStoreError("flow-execution-stale", `${key.stepKey}#${key.seq}:output-set`);
  }
  if (change.baseCommit !== undefined) store.db.prepare("UPDATE step_executions SET base_commit=? WHERE flow_run_id=? AND step_key=? AND seq=? AND base_commit IS NULL").run(change.baseCommit, key.flowRunId, key.stepKey, key.seq);
  // §6.2: a work execution's child group is named once; a second name for it is refused.
  if (change.childGroupId !== undefined && store.db.prepare("UPDATE step_executions SET child_group_id=? WHERE flow_run_id=? AND step_key=? AND seq=? AND (child_group_id IS NULL OR child_group_id=?)")
    .run(change.childGroupId, key.flowRunId, key.stepKey, key.seq, change.childGroupId).changes !== 1) throw new FlowStoreError("flow-execution-stale", `${key.stepKey}#${key.seq}:child`);
  if (change.body !== undefined) store.db.prepare("UPDATE step_executions SET body=? WHERE flow_run_id=? AND step_key=? AND seq=?").run(json(change.body), key.flowRunId, key.stepKey, key.seq);
}

export function listHeads(store: ControlStore, flowRunId: string): Record<string, number> {
  return Object.fromEntries(store.db.prepare("SELECT step_key, active_seq FROM step_heads WHERE flow_run_id=?").all(flowRunId).map((row) => [String(row.step_key), Number(row.active_seq)]));
}

export function listMessages(store: ControlStore, flowRunId: string): MessageRow[] {
  return store.db.prepare("SELECT * FROM flow_messages WHERE flow_run_id=? ORDER BY seq").all(flowRunId).map(messageOf);
}

export function listFlowRunIds(store: ControlStore, state: string): string[] {
  return store.db.prepare("SELECT id FROM flow_runs WHERE state=? ORDER BY id").all(state).map((row) => String(row.id));
}

export function setFlowRunState(store: ControlStore, id: string, from: string, to: string): void {
  if (store.db.prepare("UPDATE flow_runs SET state=?, revision=revision+1 WHERE id=? AND state=?").run(to, id, from).changes !== 1) throw new FlowStoreError("flow-execution-stale", `run ${id}:${from}`);
}
