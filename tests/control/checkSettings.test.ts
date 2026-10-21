import { describe, expect, it } from "vitest";
import { validateTrigger } from "../../src/control/checks/trigger.js";
import { ControlError } from "../../src/control/errors.js";

/**
 * Checks spec 2026-10-22 §2.2: a trigger written into settings is validated by code on write. The bounds keep a person's
 * edit from building a trigger that fires on every pump tick (a paid review each time) or that nobody can read.
 */
const code = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) { return error instanceof ControlError ? error.code : `not-a-control-error:${String(error)}`; }
};
const clause = { any: [{ kind: "queue-idle" }] };

describe("trigger validation", () => {
  it("accepts the bounds' edges", () => {
    expect(code(() => validateTrigger({ all: [clause, clause, clause, clause] }))).toBeNull();
    expect(code(() => validateTrigger({ all: [{ any: Array.from({ length: 6 }, () => ({ kind: "queue-idle" })) }] }))).toBeNull();
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "landed-groups", min: 1 }, { kind: "landed-groups", min: 50 }] }] }))).toBeNull();
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "since-last", ms: 600_000 }] }] }))).toBeNull();
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "schedule", cron: "5 * * * *" }] }] }))).toBeNull();
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "overlapping-files", minGroups: 2 }, { kind: "conflict-reconciled" }] }] }))).toBeNull();
  });

  it.each([
    ["no clause", { all: [] }],
    ["5 clauses", { all: [clause, clause, clause, clause, clause] }],
    ["an empty clause", { all: [{ any: [] }] }],
    ["7 conditions", { all: [{ any: Array.from({ length: 7 }, () => ({ kind: "queue-idle" })) }] }],
    ["landed-groups min 51", { all: [{ any: [{ kind: "landed-groups", min: 51 }] }] }],
    ["landed-groups min 0", { all: [{ any: [{ kind: "landed-groups", min: 0 }] }] }],
    ["since-last under 10 minutes", { all: [{ any: [{ kind: "since-last", ms: 599_999 }] }] }],
    ["overlapping-files minGroups 1", { all: [{ any: [{ kind: "overlapping-files", minGroups: 1 }] }] }],
    ["an unknown condition kind", { all: [{ any: [{ kind: "always" }] }] }],
    ["an unknown field on a condition", { all: [{ any: [{ kind: "queue-idle", extra: 1 }] }] }],
    ["an unknown field on the trigger", { all: [clause], any: [] }],
    ["an unparsable cron", { all: [{ any: [{ kind: "schedule", cron: "every monday" }] }] }],
  ])("refuses %s as control-argument-invalid", (_name, trigger) => {
    expect(code(() => validateTrigger(trigger))).toBe("control-argument-invalid");
  });

  it("refuses a schedule firing more often than hourly as check-schedule-too-frequent", () => {
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "schedule", cron: "* * * * *" }] }] }))).toBe("check-schedule-too-frequent");
    expect(code(() => validateTrigger({ all: [{ any: [{ kind: "queue-idle" }] }, { any: [{ kind: "schedule", cron: "0,30 9 * * *" }] }] }))).toBe("check-schedule-too-frequent");
  });
});
