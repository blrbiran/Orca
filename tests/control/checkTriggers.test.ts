import { describe, expect, it } from "vitest";
import { BUILTIN_TRIGGERS, evaluateTrigger, type RangeFacts, type Trigger } from "../../src/control/checks/trigger.js";

/**
 * Checks spec 2026-10-22 §2.2 / §3: a trigger is an AND of clauses, each an OR of closed conditions, evaluated by code
 * (Rule 5) over facts code gathered about the range. The two built-in triggers are the human's rulings: the integration
 * check keeps today's rule (≥ 2 landed AND (idle OR 6 h)); the model review runs only on (conflict OR overlap) AND a week
 * since the last start ("默认开，只在触发条件满足时跑", "默认一周吧").
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const facts = (over: Partial<RangeFacts>): RangeFacts => ({
  landed: 0, conflictReconciled: false, overlapGroups: 0, queueIdle: false, msSinceLastStart: 0, scheduleDue: () => false, ...over,
});

describe("built-in triggers (pure)", () => {
  const integration = BUILTIN_TRIGGERS["integration-check"];
  const review = BUILTIN_TRIGGERS["model-review"];

  it("states the built-in values verbatim (spec §3)", () => {
    expect(integration).toEqual({ all: [{ any: [{ kind: "landed-groups", min: 2 }] }, { any: [{ kind: "queue-idle" }, { kind: "since-last", ms: 21_600_000 }] }] });
    expect(review).toEqual({ all: [{ any: [{ kind: "conflict-reconciled" }, { kind: "overlapping-files", minGroups: 2 }] }, { any: [{ kind: "since-last", ms: 604_800_000 }] }] });
  });

  it("integration default: fires on (2 landed, idle) and (2 landed, 6 h); not on 1 landed; not on (2, running, 5 h)", () => {
    expect(evaluateTrigger(integration, facts({ landed: 2, queueIdle: true, msSinceLastStart: HOUR }))).toBe(true);
    expect(evaluateTrigger(integration, facts({ landed: 2, queueIdle: false, msSinceLastStart: 6 * HOUR }))).toBe(true);
    expect(evaluateTrigger(integration, facts({ landed: 1, queueIdle: true, msSinceLastStart: 7 * HOUR }))).toBe(false);
    expect(evaluateTrigger(integration, facts({ landed: 2, queueIdle: false, msSinceLastStart: 5 * HOUR }))).toBe(false);
  });

  it("since-last holds when the check never started (no last start to count from)", () => {
    expect(evaluateTrigger(integration, facts({ landed: 2, queueIdle: false, msSinceLastStart: null }))).toBe(true);
  });

  it("model-review default: fires on (conflict, 7 d) and (overlap 2, 7 d); not (overlap, 6 d); not (3 landed, neither)", () => {
    expect(evaluateTrigger(review, facts({ landed: 2, conflictReconciled: true, msSinceLastStart: 7 * DAY }))).toBe(true);
    expect(evaluateTrigger(review, facts({ landed: 2, overlapGroups: 2, msSinceLastStart: 7 * DAY }))).toBe(true);
    expect(evaluateTrigger(review, facts({ landed: 2, overlapGroups: 2, msSinceLastStart: 6 * DAY }))).toBe(false);
    expect(evaluateTrigger(review, facts({ landed: 3, queueIdle: true, msSinceLastStart: 30 * DAY }))).toBe(false);
  });

  it("a schedule condition asks the caller whether its own cron has a due slot", () => {
    const schedule: Trigger = { all: [{ any: [{ kind: "schedule", cron: "0 9 * * 1" }] }] };
    expect(evaluateTrigger(schedule, facts({ scheduleDue: (cron) => cron === "0 9 * * 1" }))).toBe(true);
    expect(evaluateTrigger(schedule, facts({ scheduleDue: () => false }))).toBe(false);
  });

  it("is an AND of ORs, not an OR of ANDs", () => {
    // Clause 1 holds only by its first condition, clause 2 only by its second: AND-of-OR ⇒ true; OR-of-AND ⇒ false.
    const t: Trigger = { all: [{ any: [{ kind: "queue-idle" }, { kind: "landed-groups", min: 5 }] }, { any: [{ kind: "conflict-reconciled" }, { kind: "landed-groups", min: 1 }] }] };
    expect(evaluateTrigger(t, facts({ queueIdle: true, landed: 1 }))).toBe(true);
    // One clause false ⇒ false even though the other holds by both conditions.
    const u: Trigger = { all: [{ any: [{ kind: "queue-idle" }] }, { any: [{ kind: "conflict-reconciled" }] }] };
    expect(evaluateTrigger(u, facts({ queueIdle: true }))).toBe(false);
  });
});
