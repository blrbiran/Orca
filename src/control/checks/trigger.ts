import { z } from "zod";
import { ControlError } from "../errors.js";
import { cronTooFrequent, parseCron, validateSchedule } from "./cron.js";

/**
 * Checks spec 2026-10-22 §2.2: a trigger is `{all: Clause[]}`, a clause `{any: Condition[]}`, over a closed condition
 * set. Code evaluates it (Rule 5) over facts the check pass gathers (Task 5); the implied "range non-empty" and "no run
 * in flight" are the caller's, never a condition. Conditions are JSON objects discriminated on `kind`.
 */
export const MIN_SINCE_LAST_MS = 10 * 60 * 1000;

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("landed-groups"), min: z.number().int().min(1).max(50) }).strict(),
  z.object({ kind: z.literal("conflict-reconciled") }).strict(),
  z.object({ kind: z.literal("overlapping-files"), minGroups: z.number().int().min(2).max(50) }).strict(),
  z.object({ kind: z.literal("queue-idle") }).strict(),
  z.object({ kind: z.literal("since-last"), ms: z.number().int().min(MIN_SINCE_LAST_MS).max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ kind: z.literal("schedule"), cron: z.string().min(1).max(200) }).strict(),
]);
export const triggerSchema = z.object({
  all: z.array(z.object({ any: z.array(conditionSchema).min(1).max(6) }).strict()).min(1).max(4),
}).strict();
export type Condition = z.infer<typeof conditionSchema>;
export type Trigger = z.infer<typeof triggerSchema>;

/**
 * The write-time check: the schema's bounds, then every `schedule` cron parses and fires at most hourly and, given the
 * zone its slots are read in, that zone exists (`check-time-zone-invalid`, not Intl's RangeError at the next tick).
 */
export function validateTrigger(value: unknown, timeZone?: string): Trigger {
  const parsed = triggerSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ControlError("control-argument-invalid", `trigger ${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
  }
  for (const clause of parsed.data.all) for (const condition of clause.any) {
    if (condition.kind !== "schedule") continue;
    if (timeZone !== undefined) validateSchedule(condition.cron, timeZone);
    else if (cronTooFrequent(parseCron(condition.cron))) throw new ControlError("check-schedule-too-frequent", condition.cron);
  }
  return parsed.data;
}

export interface RangeFacts {
  /** Groups landed in the range (system groups excluded, spec §2.3). */
  landed: number;
  /** A group landed in the range carries an `integration-conflict` flag (a `reconcile` flag never counts). */
  conflictReconciled: boolean;
  /** The largest number of range groups that changed one same path. */
  overlapGroups: number;
  /** No group of the project holds a running slot. */
  queueIdle: boolean;
  /** Since the last run start of this (project, kind, target); null when none started yet. */
  msSinceLastStart: number | null;
  /** Whether a slot of this cron is due for the scheduled check being evaluated. */
  scheduleDue: (cron: string) => boolean;
}

function holds(condition: Condition, f: RangeFacts): boolean {
  switch (condition.kind) {
    case "landed-groups": return f.landed >= condition.min;
    case "conflict-reconciled": return f.conflictReconciled;
    case "overlapping-files": return f.overlapGroups >= condition.minGroups;
    case "queue-idle": return f.queueIdle;
    case "since-last": return f.msSinceLastStart === null || f.msSinceLastStart >= condition.ms;
    case "schedule": return f.scheduleDue(condition.cron);
  }
}

/** AND over clauses of OR over each clause's conditions. */
export const evaluateTrigger = (t: Trigger, f: RangeFacts): boolean => t.all.every((clause) => clause.any.some((condition) => holds(condition, f)));

/** Spec §3, verbatim. */
export const BUILTIN_TRIGGERS: { readonly "integration-check": Trigger; readonly "model-review": Trigger } = {
  "integration-check": { all: [{ any: [{ kind: "landed-groups", min: 2 }] }, { any: [{ kind: "queue-idle" }, { kind: "since-last", ms: 21_600_000 }] }] },
  "model-review": { all: [{ any: [{ kind: "conflict-reconciled" }, { kind: "overlapping-files", minGroups: 2 }] }, { any: [{ kind: "since-last", ms: 604_800_000 }] }] },
};
