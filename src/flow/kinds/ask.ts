/**
 * Flow engine spec §4.2 `ask` and §4.4 (plan Task 9): a typed form a person answers. Candidates come only from an
 * earlier step's reported `flow.candidates.<name>` (`candidatesFrom`, §4.3 rule 4) or from the `flow-ask` single call --
 * never from parsing a file; free text is always offered. Policies (§8.2): `confirm-before` (the default) parks this
 * step and the ones after it until answered; `review-after` lets later steps run on the default and still takes an
 * answer. An unattended run takes the default and records one minor decision. The answer -- the default by
 * `orca-auto`, or a person's -- is written into the workspace by code through `writeTo` (src/flow/writeTo.ts) as an
 * execution of this step whose `by` is who answered; a person's answer is an `edit` (§8.1).
 */
import { z } from "zod";
import { appendQueued, FlowRefusal, loadRun, recordOfExecution, stepOf, type FlowDeps } from "../kernel.js";
import { appendMessage, listExecutions, type ExecutionRow } from "../store.js";
import { isInsidePath } from "../template/checklist.js";
import type { FlowStep } from "../template/schema.js";
import { expandVars } from "../template/vars.js";
import type { ParamValue } from "../template/when.js";
import { writeAnswer } from "../writeTo.js";
import type { ExecutionBody, KindContext, KindDefinition, KindOutcome } from "./registry.js";

type AskStep = Extract<FlowStep, { kind: "ask" }>;
const askStep = (step: FlowStep): AskStep => {
  if (step.kind !== "ask") throw new Error("orca: ask kind on a non-ask step");
  return step;
};

const candidatesSchema = z.object({ items: z.array(z.string().min(1)).min(1).max(3), recommended: z.number().int().min(0) }).strict()
  .refine((c) => c.recommended < c.items.length, { message: "recommended must index items" });
const askOutputSchema = z.object({ candidates: z.record(candidatesSchema) }).strict();
export const ASK_JSON_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["candidates"],
  properties: { candidates: { type: "object", additionalProperties: { type: "object", additionalProperties: false, required: ["items", "recommended"],
    properties: { items: { type: "array", items: { type: "string" } }, recommended: { type: "integer" } } } } },
});

type Candidates = Record<string, { items: string[]; recommended: number }>;

/** Write the values (the first form field's value goes to `writeTo`); the outcome is the ask execution's output. */
async function writeValues(ctx: KindContext, step: AskStep, values: Record<string, ParamValue>, extra: { decisions?: Array<{ grade: "minor"; by: string; body: unknown }>; open?: boolean }): Promise<KindOutcome> {
  const record = { values, ...(extra.open === true ? { open: true } : {}) };
  const decisions = extra.decisions === undefined ? {} : { decisions: extra.decisions };
  if (step.writeTo === undefined) return { done: { record, ...decisions } };
  const field = Object.keys(step.form)[0]!;
  const value = values[field];
  const file = expandVars(step.writeTo.file, { params: ctx.run.params, runId: ctx.run.row.id, workspace: ".", skillDirs: {} }, "prompt");
  const composition = isInsidePath(file) && value !== undefined ? await ctx.composition() : null;
  const target = "frontmatter" in step.writeTo ? { file, frontmatter: step.writeTo.frontmatter } : { file, json: step.writeTo.json };
  const written = composition === null ? { flag: "writeTo-missing" as const } : await writeAnswer(composition.vault, composition.commit, target, value!, ctx.execution.by);
  if ("flag" in written) return { failed: { reason: written.flag, record, flags: [written.flag] } };
  if ("unchanged" in written) return { done: { record: { ...record, unchanged: true }, ...decisions } };
  return { done: { record, commit: { commit: written.commit, parent: composition!.commit }, ...decisions } };
}

/** With the candidates known: the default, then the policy decides whether anyone waits. */
async function resolve(ctx: KindContext, step: AskStep, candidates: Candidates): Promise<KindOutcome> {
  const defaults: Record<string, ParamValue> = {};
  for (const [field, spec] of Object.entries(step.form)) {
    const offered = candidates[field];
    const value = offered !== undefined ? offered.items[offered.recommended] : spec.default;
    if (value !== undefined) defaults[field] = value;
  }
  const ask = {
    kind: "ask", form: step.form,
    candidates: Object.fromEntries(Object.entries(candidates).filter(([field]) => field in step.form).map(([field, c]) => [field, c.items])),
    defaults, freeText: true,
  };
  const complete = Object.keys(step.form).every((field) => field in defaults);
  if (complete && ctx.run.body.unattended) {
    return writeValues(ctx, step, defaults, { decisions: [{ grade: "minor", by: "orca-auto", body: { kind: "ask-default", stepKey: step.id, values: defaults } }] });
  }
  if (complete && step.policy === "review-after") return writeValues(ctx, step, defaults, { open: true });
  return { waiting: { ask } };
}

export const ASK_KIND: KindDefinition = {
  kind: "ask", kindVersion: 1, interactive: true,
  async start(ctx) {
    const step = askStep(ctx.step);
    // A person's answer (answerAsk queued it): write it, nothing else.
    const answer = (ctx.body as { answerValues?: Record<string, ParamValue> }).answerValues;
    if (answer !== undefined) return writeValues(ctx, step, answer, {});
    if (step.candidatesFrom !== undefined) {
      const from = ctx.executions().filter((e) => e.stepKey === step.candidatesFrom!.step && e.state === "done").at(-1);
      const reported = (from?.body as { reported?: { candidates?: Candidates } } | undefined)?.reported?.candidates?.[step.candidatesFrom.name];
      return resolve(ctx, step, reported === undefined ? {} : { [Object.keys(step.form)[0]!]: reported });
    }
    const fields = Object.entries(step.form).map(([field, spec]) => `- ${field} (${spec.type}${spec.options === undefined ? "" : `: ${spec.options.join(", ")}`})`);
    const instruction = [
      ...(step.prompt === undefined ? [] : [ctx.asset(step.prompt).trimEnd()]),
      `Propose candidates for a person to choose from: for each field below, at most three, and the index of the one you recommend.\n${fields.join("\n")}`,
    ].join("\n\n");
    return { call: { purpose: "flow-ask", prompt: ctx.prompt({ instruction, acceptance: [] }), responseSchema: ASK_JSON_SCHEMA, maxOutputTokens: 4_000 } };
  },
  async collect(ctx, raw) {
    const step = askStep(ctx.step);
    const parsed = askOutputSchema.safeParse(raw);
    if (!parsed.success) return { invalid: `schema:${parsed.error.issues[0]?.path.join(".") ?? ""}:${parsed.error.issues[0]?.message ?? "invalid"}` };
    return resolve(ctx, step, parsed.data.candidates);
  },
  projection: (record) => Object.entries((record as { values: Record<string, unknown> }).values).map(([k, v]) => `${k}: ${String(v)}`).join("\n"),
};

function recordOf(deps: FlowDeps, execution: ExecutionRow): { values?: Record<string, ParamValue>; open?: boolean } | null {
  if (execution.outputKind === "commit") return (execution.body as { record?: { values: Record<string, ParamValue>; open?: boolean } }).record ?? null;
  return recordOfExecution(deps.store, execution) as { values?: Record<string, ParamValue>; open?: boolean } | null;
}

function checkValues(step: AskStep, values: Record<string, ParamValue>): void {
  for (const [field, value] of Object.entries(values)) {
    const spec = step.form[field];
    const ok = spec !== undefined && (spec.type === "bool" ? typeof value === "boolean" : spec.type === "int" ? Number.isInteger(value)
      : spec.type === "enum" ? spec.options!.includes(String(value)) : spec.type === "path" ? typeof value === "string" && isInsidePath(value) && !value.includes("'")
      : spec.type === "slug" ? typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value) : typeof value === "string" && value.length > 0);
    if (!ok) throw new FlowRefusal("flow-answer-invalid", field);
  }
  for (const [field, spec] of Object.entries(step.form)) if (spec.required !== false && !(field in values)) throw new FlowRefusal("flow-answer-invalid", `${field} missing`);
}

/**
 * A person answers an open ask (`flow answer`, human-only, §14.2): a `command` message, then a new execution of the
 * step by the answerer that writes the answer. An answer equal to what a `review-after` default already wrote changes
 * nothing. Anything else is `flow-ask-closed`.
 */
export async function answerAsk(deps: FlowDeps, target: { flowRunId: string; stepKey: string }, values: Record<string, ParamValue>, by: string, via: string): Promise<void> {
  const run = loadRun(deps.store, target.flowRunId);
  const step = stepOf(run, target.stepKey);
  if (step.kind !== "ask") throw new FlowRefusal("flow-step-not-found", `${target.stepKey} is not an ask step`);
  const latest = listExecutions(deps.store, target.flowRunId).filter((e) => e.stepKey === target.stepKey).at(-1);
  if (latest === undefined) throw new FlowRefusal("flow-ask-closed", target.stepKey);
  const waiting = latest.state === "needs-person" && ((latest.body as ExecutionBody).ask as { kind?: string } | undefined)?.kind === "ask";
  const record = latest.state === "done" ? recordOf(deps, latest) : null;
  if (!waiting && record?.open !== true) throw new FlowRefusal("flow-ask-closed", target.stepKey);
  checkValues(step, values);
  const at = deps.now();
  const unchanged = record !== null && JSON.stringify(record.values) === JSON.stringify(values);
  deps.store.transaction(() => {
    appendMessage(deps.store, {
      flowRunId: run.row.id, requestId: `answer:${target.stepKey}:${latest.seq}:${at}`, kind: "command", target: "step",
      body: { command: "answer", stepKey: target.stepKey, seq: latest.seq, values }, by, via, state: "applied", reason: unchanged ? "unchanged" : null, at,
    });
    if (!unchanged) appendQueued(deps, run, target.stepKey, latest.seq + 1, ["edit"], { answerValues: values }, by, via, at);
  });
}
