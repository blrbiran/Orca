/**
 * Gaps spec §6 (plan Task 4, G5): the person's step marks -- `skip`, `defer`, `fill` -- derived by pure functions from the
 * applied `command` messages (append-only, Rule 13; `flow_runs.body` caches nothing). A repeated `skip`/`defer` replaces
 * the mark (newest wins, which is also how a defer's `effects` choices change later); `fill` removes it.
 *
 * - A marked step is settled whatever its basis and never a blocker; the planner never lists it (§6.2).
 * - Its active output is suppressed (§6.2): compositions and prompt pointers skip it while the mark stands, and after a
 *   `fill` until the step has run again -- the old output never comes back by itself.
 * - A deferred step holds the `external`/`irreversible` effect steps after it in template order, except its
 *   `parallelWith` sibling and those the person said `proceed` for in the standing defer (§6.3).
 */
import type { MessageRow as FlowMessageRow } from "./store.js";
import type { FlowTemplate } from "./template/schema.js";

export type MarkKind = "skip" | "defer";
export type Mark = { kind: MarkKind; messageSeq: number; effects: Record<string, "proceed" | "wait"> };
export const MARK_COMMANDS: ReadonlySet<string> = new Set(["skip", "defer", "fill"]);
/** §6.1: `clarify` (consensus, or the run's `clarify: skip`) and `ask` (answer it, or its default applies) are not marked. */
export const MARKABLE_KINDS: ReadonlySet<string> = new Set(["work", "draft", "check", "review"]);

/** The standing mark of every marked step, from the applied skip/defer/fill messages in order. */
export function marksOf(messages: readonly FlowMessageRow[]): Map<string, Mark> {
  const out = new Map<string, Mark>();
  for (const m of [...messages].sort((a, b) => a.seq - b.seq)) {
    if (m.kind !== "command" || m.state !== "applied") continue;
    const body = m.body as { command?: unknown; target?: { stepKey?: unknown }; effects?: unknown };
    if (typeof body.command !== "string" || !MARK_COMMANDS.has(body.command) || typeof body.target?.stepKey !== "string") continue;
    const stepKey = body.target.stepKey;
    if (body.command === "fill") { out.delete(stepKey); continue; }
    const effects: Record<string, "proceed" | "wait"> = {};
    if (typeof body.effects === "object" && body.effects !== null && !Array.isArray(body.effects)) {
      for (const [key, choice] of Object.entries(body.effects)) if (choice === "proceed" || choice === "wait") effects[key] = choice;
    }
    out.set(stepKey, { kind: body.command as MarkKind, messageSeq: m.seq, effects });
  }
  return out;
}

type Step = FlowTemplate["steps"][number];
const parallel = (a: Step, b: Step): boolean => a.parallelWith === b.id || b.parallelWith === a.id;
const HELD_CLASSES: ReadonlySet<string> = new Set(["external", "irreversible"]);

const isHoldable = (template: Pick<FlowTemplate, "effects">, step: Step): boolean =>
  step.kind === "work" && step.effect !== undefined && HELD_CLASSES.has(String(template.effects?.[step.effect]?.class));

/** §6.3: the effect steps a defer of `deferredKey` would hold -- the only keys its `effects` choices may name. */
export function holdableAfter(template: Pick<FlowTemplate, "steps" | "effects">, deferredKey: string): string[] {
  const index = template.steps.findIndex((s) => s.id === deferredKey);
  const deferred = template.steps[index];
  if (deferred === undefined) return [];
  return template.steps.slice(index + 1).filter((s) => isHoldable(template, s) && !parallel(s, deferred)).map((s) => s.id);
}

/** The deferred steps holding `stepKey` (empty: it is not held). */
export function heldBy(template: Pick<FlowTemplate, "steps" | "effects">, marks: ReadonlyMap<string, Mark>, stepKey: string): string[] {
  const index = template.steps.findIndex((s) => s.id === stepKey);
  const step = template.steps[index];
  if (step === undefined || marks.has(stepKey) || !isHoldable(template, step)) return [];
  return template.steps.slice(0, index).filter((s) => {
    const mark = marks.get(s.id);
    return mark?.kind === "defer" && !parallel(s, step) && mark.effects[stepKey] !== "proceed";
  }).map((s) => s.id);
}

/** §6.3: the effect steps a standing defer holds. */
export function heldEffectSteps(template: Pick<FlowTemplate, "steps" | "effects">, marks: ReadonlyMap<string, Mark>): Set<string> {
  return new Set(template.steps.filter((s) => heldBy(template, marks, s.id).length > 0).map((s) => s.id));
}

/** The journal as this module reads it: an execution's step, number, state and body. */
export interface MarkedExecution { stepKey: string; seq: number; state: string; body: unknown }

/**
 * §6.2: the steps whose active output no composition or pointer may show -- every marked step, and a step filled since
 * that has not run (or been carried forward by the person's plan) after its newest mark execution.
 */
export function suppressedSteps(marks: ReadonlyMap<string, Mark>, executions: readonly MarkedExecution[]): Set<string> {
  const out = new Set(marks.keys());
  const markSeq = new Map<string, number>();
  for (const e of executions) {
    if (e.state === "skipped" && (e.body as { mark?: unknown } | null)?.mark !== undefined) markSeq.set(e.stepKey, Math.max(markSeq.get(e.stepKey) ?? 0, e.seq));
  }
  for (const [stepKey, seq] of markSeq) {
    const ranSince = executions.some((e) => e.stepKey === stepKey && e.seq > seq
      && (e.state === "done" || (e.state === "skipped" && (e.body as { carriedForward?: unknown } | null)?.carriedForward !== undefined)));
    if (!ranSince) out.add(stepKey);
  }
  return out;
}

/** §6.2: the code-owned pointer line a later step's prompt gets for a marked step. */
export function markPointer(stepKey: string, mark: Mark): string {
  return mark.kind === "skip"
    ? `\`${stepKey}\`: skipped by the person — its output is not available; proceed without it`
    : `\`${stepKey}\`: deferred by the person (to be filled later) — its output is not available yet; proceed without it`;
}
