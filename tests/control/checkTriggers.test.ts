import { describe, expect, it } from "vitest";
import { prepareRange, rangeFacts } from "../../src/control/checks/pass.js";
import { BUILTIN_TRIGGERS, evaluateTrigger, type RangeFacts, type Trigger } from "../../src/control/checks/trigger.js";
import { gitChild } from "../../src/control/integrationGit.js";
import { checksWorld, g, SYSTEM_MARK } from "./fixtures/checksWorld.js";

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

/**
 * Checks spec §2.3, criterion 2 (store cases): what counts as "landed in the range". System-generated groups (every
 * `systemDebug` mark) never make a range due nor a side of an overlap -- the one intended change to the integration
 * check -- and `keep`-delivery groups are out of scope (human, Q1). Only an inter-group conflict flag counts as
 * `conflict-reconciled`; a `reconcile` flag is a conflict inside one group's landing.
 */
describe("range facts from the store", () => {
  const facts = async (w: Awaited<ReturnType<typeof checksWorld>>) => {
    const prepared = await prepareRange(w.h.store, gitChild, w.repo, "repo", "integration-check", "main", w.now());
    if (prepared.kind !== "range") return { prepared: prepared.kind };
    const f = rangeFacts(w.h.store, "repo", prepared.range.groups, prepared.state, w.now());
    return { groups: prepared.range.groups.map((group) => group.groupId), landed: f.landed, overlapGroups: f.overlapGroups, conflictReconciled: f.conflictReconciled };
  };
  /** The first evaluation: W := the target head (the check itself stays off here). */
  const init = async (w: Awaited<ReturnType<typeof checksWorld>>) => expect((await prepareRange(w.h.store, gitChild, w.repo, "repo", "integration-check", "main", w.now())).kind).toBe("initialised");

  it("a ladder fix group plus one ordinary group ⇒ one landed group, so the integration default does not fire", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      await w.commitLand("fix", { "a.txt": "2\n" }, { systemDebug: SYSTEM_MARK("ladder") });
      expect(await facts(w)).toEqual({ groups: ["g1"], landed: 1, overlapGroups: 1, conflictReconciled: false });
      expect((await w.pass()).started).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it.each(["ladder", "integration-check", "criteria-review"] as const)("a %s system group with overlapping files neither counts nor overlaps", async (kind) => {
    const w = await checksWorld(); try {
      await init(w);
      await w.commitLand("g1", { "shared.ts": "1\n" });
      await w.commitLand("sys", { "shared.ts": "2\n" }, { systemDebug: SYSTEM_MARK(kind) });
      await w.commitLand("g2", { "other.ts": "3\n" });
      expect(await facts(w)).toMatchObject({ groups: ["g1", "g2"], landed: 2, overlapGroups: 1 });
    } finally { await w.h.dispose(); }
  });

  it("two ordinary groups changing one path overlap (fast-forward and merge landings); groups before W are not compared", async () => {
    const w = await checksWorld(); try {
      await w.commitLand("before", { "shared.ts": "0\n" });
      await init(w); // W after `before`
      await w.mergeLand("g1", { "shared.ts": "1\n", "x.ts": "x\n" });
      expect(await facts(w)).toMatchObject({ groups: ["g1"], overlapGroups: 1 });
      await w.commitLand("g2", { "shared.ts": "2\n" });
      expect(await facts(w)).toMatchObject({ groups: ["g1", "g2"], overlapGroups: 2 });
    } finally { await w.h.dispose(); }
  });

  it("a keep or push-branch group never counts (only groups Orca merged into a local target, human Q1)", async () => {
    const w = await checksWorld(); try {
      await init(w);
      await w.commitLand("g1", { "a.txt": "1\n" });
      g(w.repo, "commit", "-q", "--allow-empty", "-m", "kept");
      w.land("kept", g(w.repo, "rev-parse", "main"), {}, "keep");
      g(w.repo, "commit", "-q", "--allow-empty", "-m", "pushed");
      w.land("pushed", g(w.repo, "rev-parse", "main"), {}, "push-branch");
      expect(await facts(w)).toMatchObject({ groups: ["g1"], landed: 1 });
    } finally { await w.h.dispose(); }
  });

  it("an integration-conflict flag on a range group is conflict-reconciled; a reconcile flag is not", async () => {
    const w = await checksWorld(); try {
      await init(w);
      await w.commitLand("g1", { "a.txt": "1\n" });
      w.flag("g1", "reconcile");
      expect(await facts(w)).toMatchObject({ landed: 1, conflictReconciled: false });
      w.flag("g1", "integration-conflict");
      expect(await facts(w)).toMatchObject({ conflictReconciled: true });
    } finally { await w.h.dispose(); }
  });

  it("queue-idle: a running system group holds no slot for the trigger; a running ordinary group does (§2.3)", async () => {
    const w = await checksWorld(); try {
      await init(w);
      await w.commitLand("g1", { "a.txt": "1\n" });
      const queueIdle = async () => {
        const prepared = await prepareRange(w.h.store, gitChild, w.repo, "repo", "integration-check", "main", w.now());
        if (prepared.kind !== "range") throw new Error(prepared.kind);
        return rangeFacts(w.h.store, "repo", prepared.range.groups, prepared.state, w.now()).queueIdle;
      };
      expect(await queueIdle()).toBe(true);
      w.h.importDeferred("sys");
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='sys'").run(JSON.stringify({ ...w.groupBody("sys"), status: "running", systemDebug: SYSTEM_MARK("ladder") }));
      expect(await queueIdle()).toBe(true);
      w.h.importDeferred("busy");
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='busy'").run(JSON.stringify({ ...w.groupBody("busy"), status: "running" }));
      expect(await queueIdle()).toBe(false);
    } finally { await w.h.dispose(); }
  });

  it("an empty range never fires, whatever the trigger says (the implied 'range non-empty')", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true", trigger: { all: [{ any: [{ kind: "queue-idle" }] }] } } });
      await w.pass();
      g(w.repo, "commit", "-q", "--allow-empty", "-m", "a person's own commit");
      expect(await facts(w)).toEqual({ groups: [], landed: 0, overlapGroups: 0, conflictReconciled: false });
      expect((await w.pass()).started).toEqual([]);
    } finally { await w.h.dispose(); }
  });
});
