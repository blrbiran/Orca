/**
 * Flow engine spec §8 (H15, P3; plan Task 11): the person's message stream. Every message is stored -- deduped by its
 * request id, a malformed one stored `rejected` with the reason -- and taken at a step boundary only: while any step of
 * the run is running nothing is consumed, so a message never interrupts a running step (R §3).
 *
 * - `feedback` on a step (or one of its executions) becomes the plan's `feedback` reason and the text of that step's
 *   revision prompt (rerun.ts plans the rest). Run-level feedback needs triage over `hints.owns`, which is not built yet:
 *   it is stored rejected, named, rather than guessed at.
 * - `edit` makes the person's value the step's new active output (by = the person): record fields over the active
 *   record, or files committed onto the active workspace output; the edited step is not re-run, later steps are planned.
 * - `command`: `pause`, `resume`, `stop`, `retry` (a failed step), `rewind` (rewind.ts), `repin {version}`. A command
 *   that does not hold at its boundary is stored `rejected` with the reason; `budget` is the human-only `flow-pool` verb's.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { writeCanonicalRecord } from "../control/snapshot.js";
import type { ControlStore } from "../control/store.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { outputHashOfCommit, outputHashOfRecord } from "./journal/fingerprint.js";
import {
  advanceRun, advanceWorkspace, appendQueued, FlowRefusal, latestByStep, loadRun, recordOfExecution, stepOf, vaultOf, writeRecord, type FlowDeps,
} from "./kernel.js";
import type { ExecutionBody, LoadedRun } from "./kinds/registry.js";
import { makePlan } from "./rerun.js";
import { applyRewind, reapplyEdits } from "./rewind.js";
import {
  appendExecution, appendMessage, getHead, listExecutions, listMessages, setFlowRunState, setFlowRunTemplate, setHead, setMessageState,
  type ExecutionRow, type MessageRow,
} from "./store.js";
import { isInsidePath } from "./template/checklist.js";
import { loadBuiltin } from "./template/load.js";
import { changesBetween } from "./vault/copyBack.js";
import { vaultGit, type Vault } from "./vault/vault.js";

export type MessageTarget =
  | { kind: "run" }
  | { kind: "step"; stepKey: string }
  | { kind: "execution"; stepKey: string; seq: number }
  | { kind: "round"; stepKey: string; roundNo: number }
  | { kind: "effect"; recordId: string };
export interface FlowMessageInput { kind: "feedback" | "edit" | "command"; target: MessageTarget; body: Record<string, unknown>; by: string; via: string; requestId: string }
export interface AcceptResult { state: MessageRow["state"]; reason: string | null; seq: number; deduped: boolean }

const COMMANDS = ["pause", "resume", "stop", "retry", "rewind", "repin"] as const;
const stepKeyOf = (target: MessageTarget): string | null => ("stepKey" in target ? target.stepKey : null);

/** What can be told at once, before any boundary: the shape and that the target exists. */
function shapeRefusal(store: ControlStore, run: LoadedRun, input: FlowMessageInput): string | null {
  const target = input.target;
  if (target.kind === "round") return "flow-message-target-missing";
  if (target.kind === "effect") {
    if (store.db.prepare("SELECT 1 FROM effect_records WHERE id=? AND flow_run_id=?").get(target.recordId, run.row.id) === undefined) return "flow-message-target-missing";
  }
  const stepKey = stepKeyOf(target);
  if (stepKey !== null && !run.template.steps.some((s) => s.id === stepKey)) return "flow-message-target-missing";
  if (target.kind === "execution" && !listExecutions(store, run.row.id).some((e) => e.stepKey === target.stepKey && e.seq === target.seq)) return "flow-message-target-missing";
  if (input.kind === "feedback") {
    if (typeof input.body.text !== "string" || input.body.text.trim() === "") return "flow-message-invalid:text";
    if (stepKey === null) return "flow-message-target-missing:run-feedback-triage-not-built";
  }
  if (input.kind === "edit") {
    if (stepKey === null) return "flow-message-target-missing";
    const record = input.body.record, files = input.body.files;
    const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
    if ((record === undefined) === (files === undefined)) return "flow-message-invalid:edit needs record or files";
    if (record !== undefined && !isObject(record)) return "flow-message-invalid:record";
    if (files !== undefined && (!isObject(files) || Object.entries(files as object).some(([path, text]) => !isInsidePath(path) || typeof text !== "string"))) return "flow-message-invalid:files";
  }
  if (input.kind === "command") {
    const command = input.body.command;
    if (command === "budget") return "flow-command-budget:the pool is raised by flow-pool (human-only)";
    if (!COMMANDS.includes(command as never)) return `flow-command-unknown:${String(command)}`;
    if (command === "retry" && stepKey === null) return "flow-message-target-missing";
  }
  return null;
}

/** §8.1: store the message, then take it if the run is at a boundary. */
export async function acceptMessage(deps: FlowDeps, flowRunId: string, input: FlowMessageInput): Promise<AcceptResult> {
  const run = loadRun(deps.store, flowRunId);
  const refusal = run.row.state === "stopped" ? "flow-run-stopped" : shapeRefusal(deps.store, run, input);
  const at = deps.now();
  const { row, deduped } = deps.store.transaction(() => appendMessage(deps.store, {
    flowRunId, requestId: input.requestId, kind: input.kind, target: input.target.kind, body: { ...input.body, target: input.target },
    by: input.by, via: input.via, state: refusal === null ? "accepted" : "rejected", reason: refusal, at,
  }));
  if (!deduped && refusal === null) {
    await consumeAtBoundary(deps, flowRunId);
    await advanceRun(deps, flowRunId);
  }
  const stored = listMessages(deps.store, flowRunId).find((m) => m.seq === row.seq)!;
  return { state: stored.state, reason: stored.reason, seq: stored.seq, deduped };
}

/**
 * §8.2: at a boundary (no execution of the run is running) take every accepted message in order. Feedback and edits
 * (and a repin, a rewind) then make one plan. True when anything was taken.
 */
export async function consumeAtBoundary(deps: FlowDeps, flowRunId: string): Promise<boolean> {
  if (listExecutions(deps.store, flowRunId).some((e) => e.state === "running")) return false;
  // §8.3: edits a rewind queued again wait for their step's next output, then apply (or turn into feedback, taken below).
  let moved = await reapplyEdits(deps, loadRun(deps.store, flowRunId));
  const feedback: Record<string, string[]> = {};
  const edits: string[] = [];
  let plan: { by: string; via: string; trigger: string } | null = null;
  // A rewind queues messages again; they are taken in the same round, so one plan carries everything.
  for (;;) {
    const pending = listMessages(deps.store, flowRunId).filter((m) => m.state === "accepted" && (m.body as { reapply?: unknown }).reapply === undefined);
    if (pending.length === 0) break;
    moved = true;
    for (const message of pending) {
      const target = (message.body as { target: MessageTarget }).target;
      try {
        if (message.kind === "feedback") {
          const key = stepKeyOf(target)!;
          feedback[key] = [...(feedback[key] ?? []), String((message.body as { text: string }).text)];
          plan = { by: message.by, via: message.via, trigger: "feedback" };
        } else if (message.kind === "edit") {
          await applyEdit(deps, loadRun(deps.store, flowRunId), message, target);
          edits.push(stepKeyOf(target)!);
          plan = { by: message.by, via: message.via, trigger: "edit" };
        } else {
          const replan = await applyCommand(deps, loadRun(deps.store, flowRunId), message, target);
          if (replan !== null) plan = { by: message.by, via: message.via, trigger: replan };
        }
        deps.store.transaction(() => setMessageState(deps.store, flowRunId, message.seq, "accepted", "applied"));
      } catch (error) {
        if (!(error instanceof FlowRefusal)) throw error;
        deps.store.transaction(() => setMessageState(deps.store, flowRunId, message.seq, "accepted", "rejected", error.code));
      }
    }
  }
  if (plan !== null) await makePlan(deps, flowRunId, { ...plan, feedback, edits });
  return moved;
}

/** A command at its boundary; returns the plan trigger it causes, if any. */
async function applyCommand(deps: FlowDeps, run: LoadedRun, message: MessageRow, target: MessageTarget): Promise<string | null> {
  const body = message.body as Record<string, unknown>;
  const state = run.row.state;
  const move = (from: string[], to: string): void => {
    if (!from.includes(state)) throw new FlowRefusal(`flow-run-not-${from.join("-or-")}`, state);
    deps.store.transaction(() => setFlowRunState(deps.store, run.row.id, state, to));
  };
  switch (body.command) {
    case "pause": move(["running"], "paused"); return null;
    case "resume": move(["paused"], "running"); return null;
    case "stop": move(["running", "paused", "done"], "stopped"); return null;
    case "retry": {
      const stepKey = stepKeyOf(target)!;
      const latest = latestByStep(listExecutions(deps.store, run.row.id)).get(stepKey);
      if (latest?.state !== "failed") throw new FlowRefusal("flow-step-not-failed", stepKey);
      deps.store.transaction(() => appendQueued(deps, run, stepKey, latest.seq + 1, ["retry"], {}, message.by, message.via, deps.now()));
      return null;
    }
    case "repin": return repin(deps, run, body.version);
    case "rewind": return applyRewind(deps, run, message);
    default: throw new FlowRefusal("flow-command-unknown", String(body.command));
  }
}

/** §8.1 `repin {version}`: the run moves to that version of its template; steps whose definition changed are candidates. */
async function repin(deps: FlowDeps, run: LoadedRun, version: unknown): Promise<string> {
  const id = /^builtin\/([a-z0-9][a-z0-9-]*)/.exec(run.body.templateRef)?.[1];
  if (id === undefined || typeof version !== "number") throw new FlowRefusal("flow-template-invalid", "repin needs a built-in template and a version");
  let loaded: ReturnType<typeof loadBuiltin>;
  try { loaded = loadBuiltin(id, deps.builtinRoot); } catch (error) { throw new FlowRefusal("flow-template-invalid", (error as Error).message); }
  if (loaded.template.version !== version) throw new FlowRefusal("flow-template-invalid", `builtin/${id} is at version ${String(loaded.template.version)}, not ${version}`);
  const paths = new Set<string>();
  for (const step of loaded.template.steps) {
    if ("prompt" in step && step.prompt !== undefined) paths.add(step.prompt);
    if (step.kind === "clarify" && step.background !== undefined) paths.add(step.background);
    if (step.kind === "review" && step.rubric !== undefined) paths.add(step.rubric);
  }
  const stored = { template: loaded.template, assets: Object.fromEntries([...paths].sort().map((rel) => [rel, loaded.assets.read(rel)])) };
  const hash = sha256Canonical(stored);
  deps.store.transaction(() => {
    writeCanonicalRecord(deps.store, run.row.groupId, hash, canonicalBytes(stored).toString("utf8"));
    setFlowRunTemplate(deps.store, run.row.id, hash, { ...run.body, templateRef: `builtin/${id}@${version}` });
  });
  return "repin";
}

/** Files written onto `onto` as one commit (the person's edit). */
export async function commitFiles(vault: Vault, onto: string, files: Record<string, string>, message: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-flow-edit-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    await vaultGit(vault, ["read-tree", onto], { env });
    for (const [path, text] of Object.entries(files)) {
      const blob = (await vaultGit(vault, ["hash-object", "-w", "--stdin"], { input: text })).trim();
      await vaultGit(vault, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    }
    const tree = (await vaultGit(vault, ["write-tree"], { env })).trim();
    return (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", onto, "-m", message])).trim();
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/**
 * §8.1 edit: the person's value becomes a new execution of the step, done, by the person, and its head. It ran on what
 * the edited output ran on (same definition, same inputs); for files its change is taken against the step's own parent
 * (the composition replaces the step's output with it, §5.3), and the folder gets it by copy-back.
 */
export async function applyEdit(deps: FlowDeps, run: LoadedRun, message: Pick<MessageRow, "seq" | "by" | "via" | "body">, target: MessageTarget, onto?: ExecutionRow): Promise<ExecutionRow> {
  const stepKey = stepKeyOf(target)!;
  stepOf(run, stepKey);
  const all = listExecutions(deps.store, run.row.id);
  const headSeq = getHead(deps.store, run.row.id, stepKey);
  const active = onto ?? all.find((e) => e.stepKey === stepKey && e.seq === headSeq);
  if (active === undefined || active.state !== "done") throw new FlowRefusal("flow-message-target-missing", `${stepKey} has no active output to edit`);
  const seq = Math.max(...all.filter((e) => e.stepKey === stepKey).map((e) => e.seq)) + 1;
  const body = message.body as { record?: Record<string, unknown>; files?: Record<string, string> };
  const activeBody = active.body as ExecutionBody;
  const at = deps.now();
  const common = {
    flowRunId: run.row.id, stepKey, seq, kind: active.kind, kindVersion: active.kindVersion, state: "done" as const, definitionHash: active.definitionHash,
    ranOn: active.ranOn, fingerprint: active.fingerprint, readSetHash: null, reasons: ["edit"], planNo: null, childGroupId: null,
    by: message.by, via: message.via, createdAt: at, updatedAt: at,
  };
  const editBody = { basis: activeBody.basis, ranOnInputs: activeBody.ranOnInputs, retries: 0, retryReason: null, feedback: [], edit: { message: message.seq, onto: active.seq } };
  let row: ExecutionRow;
  if (body.record !== undefined) {
    if (active.outputKind !== "artifact") throw new FlowRefusal("flow-message-invalid", `${stepKey}'s output is not a record`);
    const record = { ...(recordOfExecution(deps.store, active) as Record<string, unknown>), ...body.record };
    row = deps.store.transaction(() => {
      const hash = writeRecord(deps.store, run.row.groupId, record);
      const inserted: ExecutionRow = { ...common, baseCommit: active.baseCommit, outputKind: "artifact", outputRef: hash, outputHash: outputHashOfRecord(hash), body: { ...editBody, fields: body.record } };
      appendExecution(deps.store, inserted);
      setHead(deps.store, run.row.id, stepKey, headSeq, seq);
      return inserted;
    });
    return row;
  }
  const vault = vaultOf(run);
  if (active.outputKind !== "commit" || vault === null) throw new FlowRefusal("flow-message-invalid", `${stepKey}'s output is not a workspace commit`);
  const parent = String(activeBody.parent ?? active.baseCommit);
  const commit = await commitFiles(vault, active.outputRef!, body.files!, `orca: person edit of ${stepKey} by ${message.by}`);
  const changes = await changesBetween(vault, parent, commit);
  row = deps.store.transaction(() => {
    const inserted: ExecutionRow = {
      ...common, baseCommit: active.baseCommit, outputKind: "commit", outputRef: commit,
      outputHash: outputHashOfCommit(changes.map((c) => ({ path: c.path, blob: c.newBlob }))), body: { ...editBody, parent, files: Object.keys(body.files!).sort() },
    };
    appendExecution(deps.store, inserted);
    setHead(deps.store, run.row.id, stepKey, headSeq, seq);
    return inserted;
  });
  await advanceWorkspace(deps, run, vault, { flowRunId: run.row.id, stepKey, seq });
  return row;
}
