/**
 * Flow engine spec §9 (H24-H26, H29, H35; plan Task 12, C13): effect-classed steps. The template classes a step as a
 * whole (`effect:` names a kind of `effects:`, which names its class); the settings say at which level each class runs
 * (settings.ts resolveLevel, with provenance); the kernel gates the step on it before it starts:
 *
 * - `apply-flag`: the step runs; its record is `confirmed` by orca-auto, then `applied` (flagged red for review) or
 *   `failed` (`effect-failed`); nobody waits.
 * - `confirm`: a confirm card -- the record `staged` and the execution `needs-person` with the card as its ask -- parks
 *   only this step and the steps after it in order (a `parallelWith` sibling goes on); the person's confirm runs it.
 * - `stage-only`: the step does not run; its record is `staged` with what it ran on and the policy; the flow goes on
 *   without it. Enacting it later runs the step then; discarding closes it. A record whose `ranOn` no longer matches is
 *   not enacted: a new record is made (the old one is not edited) and the person is shown the difference.
 *
 * The record id is printed into the step's prompt (the idempotency key and `--confirmed-by-orca`, §9.6). Records are
 * immutable except `state` forward; who confirmed, enacted or discarded is a `command` message (by, via).
 */
import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../control/canonicalJson.js";
import type { ControlStore } from "../control/store.js";
import { FlowRefusal, loadRun, ranOnInputsOf, resumeExecution, stepOf, type FlowDeps } from "./kernel.js";
import type { ExecutionBody, LoadedRun } from "./kinds/registry.js";
import { flowLayers, resolveLevel, type ResolvedLevel } from "./settings.js";
import type { FlowEffectClass } from "./settingsSchema.js";
import { appendMessage, finishExecution, getEffect, listExecutions, listHeads, putEffect, setEffectState, type EffectRow, type ExecutionRow } from "./store.js";
import type { FlowStep } from "./template/schema.js";

export const EFFECT_APPLIED = "effect-applied";
export const EFFECT_FAILED = "effect-failed";

/** The step's effect kind and class; null for an unclassed step. */
export function effectOf(run: LoadedRun, step: FlowStep): { kind: string; cls: FlowEffectClass } | null {
  if (step.kind !== "work" || step.effect === undefined) return null;
  const cls = run.template.effects?.[step.effect]?.class;
  // `human-only` never reaches a run: the checklist refuses it in a flow (§9.1).
  return cls === undefined || cls === "human-only" ? null : { kind: step.effect, cls };
}

/** What the record is about: the inputs the step would run on (its `ranOn`, §6.4). */
const payloadHashOf = (store: ControlStore, run: LoadedRun, stepKey: string): string => sha256Canonical({ effect: "ranOn", inputs: ranOnInputsOf(store, run, stepKey) });

function newRecord(store: ControlStore, run: LoadedRun, execution: ExecutionRow, effect: { kind: string; cls: FlowEffectClass }, level: ResolvedLevel, state: "staged" | "confirmed", at: number): EffectRow {
  const row: EffectRow = {
    id: `eff-${randomUUID()}`, flowRunId: run.row.id, stepKey: execution.stepKey, seq: execution.seq, effectKind: effect.kind, class: effect.cls,
    level: level.value, policy: level, state, payloadHash: payloadHashOf(store, run, execution.stepKey), remoteRef: null, by: "orca-auto", via: "orca",
    createdAt: at, updatedAt: at,
  };
  putEffect(store, row);
  return row;
}

/** A code-built summary of what the step would act on: the earlier steps' active outputs. */
function summaryOf(store: ControlStore, run: LoadedRun, stepKey: string): string[] {
  const heads = listHeads(store, run.row.id);
  const all = listExecutions(store, run.row.id);
  const index = run.template.steps.findIndex((s) => s.id === stepKey);
  return run.template.steps.slice(0, index).flatMap((s) => {
    const active = all.find((e) => e.stepKey === s.id && e.seq === heads[s.id]);
    return active === undefined ? [] : [`${s.id}#${active.seq}: ${active.outputKind ?? "none"} ${active.outputRef ?? ""}`.trim()];
  });
}

export type EffectGate = { run: string } | { waiting: { ask: unknown; recordId: string } } | { staged: string };

/**
 * Before an effect-classed step starts (in the caller's transaction): resolve its level and write its record. `run`
 * carries the record id the step runs with; `waiting` is the confirm card; `staged` means the step does not run now.
 */
export function gateEffect(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow, step: FlowStep): EffectGate | null {
  const effect = effectOf(run, step);
  if (effect === null) return null;
  const { project, global } = flowLayers(deps.store, run.body.projectId);
  const level = resolveLevel(effect.cls, "recommendedLevel" in step ? step : {}, project, global);
  const at = deps.now();
  if (level.value === "apply-flag") return { run: newRecord(deps.store, run, execution, effect, level, "confirmed", at).id };
  const record = newRecord(deps.store, run, execution, effect, level, "staged", at);
  if (level.value === "stage-only") return { staged: record.id };
  return { waiting: { recordId: record.id, ask: {
    kind: "effect-confirm", recordId: record.id, stepKey: step.id, effectKind: effect.kind, class: effect.cls, policy: level,
    summary: summaryOf(deps.store, run, step.id),
  } } };
}

/** §9.2: how the step ended moves its record: applied (flagged for review, with the remote id it reported) or failed. */
export function settleEffect(store: ControlStore, body: ExecutionBody, outcome: "done" | "failed", remoteId: string | null, at: number): string[] {
  const id = typeof body.effectRecordId === "string" ? body.effectRecordId : null;
  const record = id === null ? null : getEffect(store, id);
  if (record === null || record.state !== "confirmed") return [];
  setEffectState(store, record.id, "confirmed", outcome === "done" ? "applied" : "failed", at, remoteId ?? undefined);
  return [outcome === "done" ? EFFECT_APPLIED : EFFECT_FAILED];
}

function openRecord(store: ControlStore, recordId: string): { record: EffectRow; execution: ExecutionRow } {
  const record = getEffect(store, recordId);
  if (record === null) throw new FlowRefusal("flow-message-target-missing", recordId);
  if (record.state === "confirmed") throw new FlowRefusal("flow-effect-not-staged", recordId);
  if (record.state !== "staged") throw new FlowRefusal("flow-effect-closed", `${recordId} is ${record.state}`);
  const execution = listExecutions(store, record.flowRunId).find((e) => e.stepKey === record.stepKey && e.seq === record.seq);
  // A record the step no longer runs with (a newer one replaced it, or the step moved on) is closed.
  if (execution === undefined || (execution.body as ExecutionBody).effectRecordId !== record.id || (execution.state !== "staged" && execution.state !== "needs-person")) {
    throw new FlowRefusal("flow-effect-closed", `${recordId} is no longer the step's record`);
  }
  return { record, execution };
}

const commandMessage = (store: ControlStore, record: EffectRow, command: string, by: string, via: string, at: number, extra: Record<string, unknown> = {}) =>
  appendMessage(store, {
    flowRunId: record.flowRunId, requestId: `effect:${command}:${record.id}`, kind: "command", target: "effect",
    body: { command, recordId: record.id, stepKey: record.stepKey, ...extra }, by, via, state: "applied", reason: null, at,
  });

export type EnactResult = { state: "running"; recordId: string } | { state: "restaged"; recordId: string; replaces: string; before: string; after: string };

/**
 * `orca flow effect confirm|enact <record>` (human-only): a confirm card's or a staged record's step runs now. A staged
 * record whose inputs moved since it was staged is not enacted: a new record is staged in its place and returned.
 */
export async function enactEffect(deps: FlowDeps, recordId: string, by: string, via: string, command: "confirm" | "enact" = "enact"): Promise<EnactResult> {
  const { record, execution } = openRecord(deps.store, recordId);
  const run = loadRun(deps.store, record.flowRunId);
  const step = stepOf(run, record.stepKey);
  const at = deps.now();
  const now = payloadHashOf(deps.store, run, record.stepKey);
  if (now !== record.payloadHash) {
    const effect = effectOf(run, step)!;
    const replaced = deps.store.transaction(() => {
      const next = newRecord(deps.store, run, execution, effect, record.policy as ResolvedLevel, "staged", at);
      finishExecution(deps.store, execution, execution.state, execution.state, at, { body: { ...(execution.body as ExecutionBody), effectRecordId: next.id } });
      commandMessage(deps.store, record, `${command}-restaged`, by, via, at, { replacedBy: next.id });
      return next;
    });
    return { state: "restaged", recordId: replaced.id, replaces: record.id, before: record.payloadHash, after: now };
  }
  deps.store.transaction(() => {
    setEffectState(deps.store, record.id, "staged", "confirmed", at);
    commandMessage(deps.store, record, command, by, via, at);
  });
  await resumeExecution(deps, run, execution);
  return { state: "running", recordId: record.id };
}

/** `orca flow effect discard <record>` (human-only): the record closes and the step does not run. */
export function discardEffect(deps: FlowDeps, recordId: string, by: string, via: string): void {
  const { record, execution } = openRecord(deps.store, recordId);
  const at = deps.now();
  deps.store.transaction(() => {
    setEffectState(deps.store, record.id, "staged", "discarded", at);
    finishExecution(deps.store, execution, execution.state, "skipped", at, { body: { ...(execution.body as ExecutionBody), effectDiscarded: record.id } });
    commandMessage(deps.store, record, "discard", by, via, at);
  });
}
