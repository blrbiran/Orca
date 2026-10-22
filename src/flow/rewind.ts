/**
 * Flow engine spec §8.3 (R §3, Temporal reset; plan Task 11, C11): a rewind moves the active pointer of one step -- to an
 * older execution, or to "not run" -- and keeps what the person said afterwards. Code decides all of it; no model chooses
 * what is re-applied.
 *
 * - The rewound point is when `toStep` moved past `toSeq` (the creation of its next execution; for "not run", its first).
 *   The person's feedback and edits stored after it (and before the rewind) are re-applied unless excluded; an excluded
 *   one is marked `excluded` and is not.
 * - Feedback is queued again on its step (the plan the rewind makes carries it into that step's revision prompt).
 * - An edit waits for its step's next execution, then is applied again as a three-way patch on that output: record fields
 *   one by one (a text field by `git merge-file`), files by `git merge-file`. A step that does not run again keeps the edit
 *   as its output. An edit that no longer applies becomes feedback on that step ("the person had made this edit: ...")
 *   and the execution it would not apply to is flagged red `edit-no-longer-applies`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, type MessageTarget } from "./messages.js";
import { FlowRefusal, recordOfExecution, stepOf, vaultOf, type FlowDeps } from "./kernel.js";
import { openPlan } from "./rerun.js";
import { reuseIntake } from "./feedback/intake.js";
import type { ExecutionBody, LoadedRun } from "./kinds/registry.js";
import { appendMessage, clearHead, finishExecution, getHead, listExecutions, listMessages, setHead, setMessageState, type ExecutionRow, type MessageRow } from "./store.js";
import { vaultGitBytes, type Vault } from "./vault/vault.js";

export const EDIT_NO_LONGER_APPLIES = "edit-no-longer-applies";

interface RewindBody { command: "rewind"; toStep?: unknown; toSeq?: unknown; exclude?: unknown }
/** What a re-queued edit carries: the original message and the person's edit execution (made onto `onto`). */
export interface Reapply { from: number; stepKey: string; editSeq: number; onto: number }

/** The command at its boundary; returns the plan trigger. */
export async function applyRewind(deps: FlowDeps, run: LoadedRun, message: MessageRow): Promise<string> {
  const body = message.body as RewindBody;
  if (typeof body.toStep !== "string") throw new FlowRefusal("flow-step-not-found", "rewind needs toStep");
  const toStep = body.toStep;
  stepOf(run, toStep);
  const toSeq = body.toSeq === undefined ? null : body.toSeq;
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((n): n is number => typeof n === "number") : [];
  const executions = listExecutions(deps.store, run.row.id);
  const ofStep = executions.filter((e) => e.stepKey === toStep);
  if (toSeq !== null && (typeof toSeq !== "number" || ofStep.find((e) => e.seq === toSeq)?.state !== "done")) throw new FlowRefusal("flow-step-not-found", `${toStep}#${String(toSeq)} is no done execution`);
  const head = getHead(deps.store, run.row.id, toStep);
  // The rewound point: when the step moved past `toSeq` (for "not run": when it first ran).
  const past = ofStep.filter((e) => toSeq === null || e.seq > toSeq).map((e) => e.createdAt);
  const point = past.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...past);
  const later = listMessages(deps.store, run.row.id).filter((m) => m.seq < message.seq && m.at >= point && m.by !== "orca-auto"
    && (m.kind === "feedback" || m.kind === "edit") && m.state === "applied" && (m.body as { reapply?: unknown }).reapply === undefined);
  deps.store.transaction(() => {
    if (toSeq === null) { if (head !== null) clearHead(deps.store, run.row.id, toStep, head); }
    else if (head !== toSeq) setHead(deps.store, run.row.id, toStep, head, toSeq);
    for (const m of later) {
      if (exclude.includes(m.seq)) { setMessageState(deps.store, run.row.id, m.seq, "applied", "excluded", `excluded by rewind ${message.seq}`); continue; }
      const target = (m.body as { target: MessageTarget }).target;
      const requestId = `rewind:${message.seq}:${m.seq}`;
      if (m.kind === "feedback") {
        const requeued = appendMessage(deps.store, { flowRunId: run.row.id, requestId, kind: "feedback", target: target.kind as MessageRow["target"], body: { ...(m.body as object), reappliedFrom: m.seq }, by: m.by, via: m.via, state: "accepted", reason: null, at: deps.now() });
        // Gaps spec §4.2: a feedback that had an intake reuses it -- located anchors (re-verified at the boundary), targets,
        // restated text -- and makes no new triage or clarify call.
        if (!requeued.deduped) reuseIntake(deps.store, run.row.id, m.seq, requeued.row.seq, deps.now());
        continue;
      }
      // The newest execution of that edit (a re-applied edit keeps the original message's number).
      const edit = executions.filter((e) => (e.body as { edit?: { message?: number } }).edit?.message === m.seq).at(-1);
      if (edit === undefined) continue;
      const reapply: Reapply = { from: m.seq, stepKey: edit.stepKey, editSeq: edit.seq, onto: Number((edit.body as { edit: { onto: number } }).edit.onto) };
      appendMessage(deps.store, { flowRunId: run.row.id, requestId, kind: "edit", target: target.kind as MessageRow["target"], body: { ...(m.body as object), reapply }, by: m.by, via: m.via, state: "accepted", reason: null, at: deps.now() });
    }
  });
  return "rewind";
}

// ------------------------------------------------------------------------------------------------- three-way re-apply

async function gitMergeFile(ours: string, base: string, theirs: string): Promise<{ clean: boolean; text: string }> {
  const dir = await mkdtemp(join(tmpdir(), "orca-flow-merge-"));
  try {
    const [o, b, t] = ["ours", "base", "theirs"].map((n) => join(dir, n)) as [string, string, string];
    await Promise.all([writeFile(o, ours), writeFile(b, base), writeFile(t, theirs)]);
    return await new Promise<{ clean: boolean; text: string }>((resolve, reject) => {
      execFile("/usr/bin/git", ["merge-file", "-p", "-q", o, b, t], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
        const code = (error as { code?: unknown } | null)?.code;
        // merge-file exits with the number of conflicts (0: clean); anything else is git failing.
        if (error !== null && (typeof code !== "number" || code < 0)) { reject(error); return; }
        resolve({ clean: error === null, text: stdout });
      });
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Record fields one by one: the person's field wins where the re-run left it as it was; text fields merge by lines. */
async function mergeRecord(base: Record<string, unknown>, ours: Record<string, unknown>, theirs: Record<string, unknown>, fields: readonly string[]): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const [b, o, t] = [base[field], ours[field], theirs[field]];
    if (same(o, t) || same(o, b)) continue;
    if (same(t, b)) { out[field] = o; continue; }
    if (typeof b !== "string" || typeof o !== "string" || typeof t !== "string") return null;
    const merged = await gitMergeFile(o, b, t);
    if (!merged.clean) return null;
    out[field] = merged.text;
  }
  return out;
}

async function fileAt(vault: Vault, commit: string, path: string): Promise<string> {
  try { return (await vaultGitBytes(vault, ["cat-file", "blob", `${commit}:${path}`])).toString("utf8"); } catch { return ""; }
}

/** Files by `git merge-file`, each path the person edited. */
async function mergeFiles(vault: Vault, base: string, ours: string, theirs: string, paths: readonly string[]): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const merged = await gitMergeFile(await fileAt(vault, ours, path), await fileAt(vault, base, path), await fileAt(vault, theirs, path));
    if (!merged.clean) return null;
    out[path] = merged.text;
  }
  return out;
}

async function threeWay(deps: FlowDeps, run: LoadedRun, onto: ExecutionRow, edit: ExecutionRow, rerun: ExecutionRow): Promise<{ record: Record<string, unknown> } | { files: Record<string, string> } | null> {
  if (edit.outputKind === "artifact") {
    const fields = Object.keys((edit.body as { fields?: Record<string, unknown> }).fields ?? {});
    const read = (e: ExecutionRow) => recordOfExecution(deps.store, e) as Record<string, unknown>;
    const record = await mergeRecord(read(onto), read(edit), read(rerun), fields);
    return record === null ? null : { record };
  }
  const vault = vaultOf(run);
  if (vault === null || rerun.outputKind !== "commit") return null;
  const files = await mergeFiles(vault, onto.outputRef!, edit.outputRef!, rerun.outputRef!, (edit.body as { files?: string[] }).files ?? []);
  return files === null ? null : { files };
}

/**
 * At a boundary: each re-queued edit whose step has run again since the person's edit is applied again (or turned into
 * feedback); one whose step still holds the edit as its output is done. True when anything moved.
 */
export async function reapplyEdits(deps: FlowDeps, run: LoadedRun): Promise<boolean> {
  let moved = false;
  for (const message of listMessages(deps.store, run.row.id).filter((m) => m.state === "accepted" && m.kind === "edit" && (m.body as { reapply?: unknown }).reapply !== undefined)) {
    const reapply = (message.body as { reapply: Reapply }).reapply;
    const executions = listExecutions(deps.store, run.row.id).filter((e) => e.stepKey === reapply.stepKey);
    const head = getHead(deps.store, run.row.id, reapply.stepKey);
    const newer = executions.filter((e) => e.seq > reapply.editSeq);
    const rerun = newer.find((e) => e.seq === head && e.state === "done");
    if (rerun === undefined) {
      // The step was not run again (the plan skipped it, or no plan is left to run it): the edit stays its output.
      const kept = head === reapply.editSeq && (newer.some((e) => e.state === "skipped") || openPlan(deps.store, run.row.id) === null);
      if (kept) { deps.store.transaction(() => setMessageState(deps.store, run.row.id, message.seq, "accepted", "applied", "edit-still-active")); moved = true; }
      continue;
    }
    const onto = executions.find((e) => e.seq === reapply.onto)!;
    const edit = executions.find((e) => e.seq === reapply.editSeq)!;
    const merged = await threeWay(deps, run, onto, edit, rerun);
    const target: MessageTarget = { kind: "step", stepKey: reapply.stepKey };
    if (merged !== null) {
      await applyEdit(deps, run, { seq: reapply.from, by: message.by, via: message.via, body: merged }, target, rerun);
      deps.store.transaction(() => setMessageState(deps.store, run.row.id, message.seq, "accepted", "applied"));
    } else {
      const shown = JSON.stringify((message.body as { record?: unknown; files?: unknown }).record ?? (message.body as { files?: unknown }).files);
      deps.store.transaction(() => {
        const body = rerun.body as ExecutionBody;
        finishExecution(deps.store, rerun, "done", "done", deps.now(), { body: { ...body, flags: [...new Set([...(body.flags ?? []), EDIT_NO_LONGER_APPLIES])] } });
        appendMessage(deps.store, {
          flowRunId: run.row.id, requestId: `${EDIT_NO_LONGER_APPLIES}:${message.seq}`, kind: "feedback", target: "step",
          body: { target, text: `The person had made this edit, which no longer applies to the new output: ${shown}`, fromEdit: reapply.from },
          by: message.by, via: message.via, state: "accepted", reason: null, at: deps.now(),
        });
        setMessageState(deps.store, run.row.id, message.seq, "accepted", "applied", EDIT_NO_LONGER_APPLIES);
      });
    }
    moved = true;
  }
  return moved;
}
