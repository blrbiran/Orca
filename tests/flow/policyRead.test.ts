import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orchestrationRevision, readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { getFlowRun, listPlans } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { readFlowSettings } from "../../src/flow/settings.js";
import { applySetFlowLocks, applySetFlowSettings } from "../../src/flow/settingsCommands.js";
import { FLOW_LOCKABLE_PATHS, FLOW_SETTING_FIELDS, flowsLayerSchema } from "../../src/flow/settingsSchema.js";

/**
 * Flow engine spec §11.2, §21 C18: the flow settings, written by a person one layer at a time and read field by field
 * with `{value, source, lockedBy}` (what Web and `--json` render). Locks live only in the global layer and only tighten:
 * a looser project write is refused naming the lock, and a looser project value written before the lock is ignored
 * while it stands. `irreversible: apply-flag` is refused from every channel in phase 1 (it needs the person token).
 */
const withStore = async (fn: (store: ControlStore) => void | Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "flow-policy-"));
  const store = await openControlStore({ stateDir: join(root, "s") });
  try { await fn(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
};
const deps = (store: ControlStore) => ({ store, knownRepository: (repoId: string) => repoId === "repo" });
let n = 0;
const REPO = { kind: "repository", repoId: "repo" } as const, GLOBAL = { kind: "orchestration" } as const;
const raw = (store: ControlStore, verb: string, target: typeof REPO | typeof GLOBAL, payload: unknown) => ({
  schema: "orca-raw-command-v1", commandId: `flow-cmd-${++n}`, actorId: "owner", verb, target, payload,
  expectedRevision: target.kind === "orchestration" ? orchestrationRevision(store) : readRepositorySettingsBody(store, target.repoId)?.revision ?? 0,
}) as never;
const codeOf = (body: unknown): string => ((body as { error?: { code: string } }).error?.code ?? "accepted");
const messageOf = (body: unknown): string => ((body as { error?: { message: string } }).error?.message ?? "");
const settings = (store: ControlStore, target: typeof REPO | typeof GLOBAL, set: unknown, clear: string[] = []) => applySetFlowSettings(deps(store), raw(store, "set-flow-settings", target, { set, clear }));
const locks = (store: ControlStore, target: typeof REPO | typeof GLOBAL, value: string[]) => applySetFlowLocks(deps(store), raw(store, "set-flow-locks", target, { locks: value }));

describe("flow settings read (C18)", () => {
  it("every field carries {value, source, lockedBy}: built-in, then global, then project", () => withStore((store) => {
    const fresh = readFlowSettings(store, "repo");
    expect(fresh).toEqual({
      effects: {
        local: { value: "apply-flag", source: "builtin", lockedBy: null }, cost: { value: "apply-flag", source: "builtin", lockedBy: null },
        external: { value: "apply-flag", source: "builtin", lockedBy: null }, irreversible: { value: "confirm", source: "builtin", lockedBy: null },
      },
      rerunReview: { value: "auto", source: "builtin", lockedBy: null },
      rerunAskTimeoutSeconds: { value: 300, source: "builtin", lockedBy: null },
      roles: { value: {}, source: "builtin", lockedBy: null },
      allowedSkillSources: { value: null, source: "builtin", lockedBy: null },
      budgets: { tokensPerRun: { value: 2_000_000, source: "builtin", lockedBy: null } },
      paramDefaults: {},
      locks: [],
    });
    expect(codeOf(settings(store, GLOBAL, { effects: { cost: "stage-only" }, rerunReview: "review", rerunAskTimeoutSeconds: 120, budgets: { tokensPerRun: 900_000 } }))).toBe("accepted");
    expect(codeOf(settings(store, REPO, { effects: { cost: "confirm" }, rerunAskTimeoutSeconds: 600 }))).toBe("accepted");
    const read = readFlowSettings(store, "repo");
    expect(read.effects.cost).toEqual({ value: "confirm", source: "project", lockedBy: null });
    expect(read.rerunReview).toEqual({ value: "review", source: "global", lockedBy: null });
    expect(read.rerunAskTimeoutSeconds).toEqual({ value: 600, source: "project", lockedBy: null });
    expect(readFlowSettings(store, null).rerunAskTimeoutSeconds).toEqual({ value: 120, source: "global", lockedBy: null });
    expect(read.budgets.tokensPerRun).toEqual({ value: 900_000, source: "global", lockedBy: null });
    expect(readFlowSettings(store, null).effects.cost).toEqual({ value: "stage-only", source: "global", lockedBy: null });
    // Clearing the project's field lets the global one apply again.
    expect(codeOf(settings(store, REPO, {}, ["effects.cost", "rerunAskTimeoutSeconds"]))).toBe("accepted");
    expect(readFlowSettings(store, "repo").effects.cost.source).toBe("global");
    expect(readFlowSettings(store, "repo").rerunAskTimeoutSeconds).toEqual({ value: 120, source: "global", lockedBy: null });
    expect(readRepositorySettingsBody(store, "repo")).not.toHaveProperty("flows");
  }));
});

describe("flow settings writes and locks (C18)", () => {
  it("a lock set globally refuses a looser project value naming the lock, accepts a tighter one", () => withStore((store) => {
    expect(codeOf(settings(store, GLOBAL, { effects: { external: "confirm" }, budgets: { tokensPerRun: 500_000 } }))).toBe("accepted");
    expect(codeOf(locks(store, GLOBAL, ["effects.external", "budgets.tokensPerRun"]))).toBe("accepted");
    const looser = settings(store, REPO, { effects: { external: "apply-flag" } });
    expect([codeOf(looser), messageOf(looser)]).toEqual(["flow-setting-locked", "flow-setting-locked:effects.external"]);
    const bigger = settings(store, REPO, { budgets: { tokensPerRun: 500_001 } });
    expect([codeOf(bigger), messageOf(bigger)]).toEqual(["flow-setting-locked", "flow-setting-locked:budgets.tokensPerRun"]);
    expect(codeOf(settings(store, REPO, { effects: { external: "stage-only" }, budgets: { tokensPerRun: 100 } }))).toBe("accepted");
    expect(readFlowSettings(store, "repo").effects.external).toEqual({ value: "stage-only", source: "project", lockedBy: "global" });
    // The global layer is not bound by its own lock.
    expect(codeOf(settings(store, GLOBAL, { effects: { external: "apply-flag" } }))).toBe("accepted");
  }));

  it("a looser project value written before the lock is ignored while it stands, and applies after unlock", () => withStore((store) => {
    expect(codeOf(settings(store, REPO, { effects: { cost: "apply-flag" } }))).toBe("accepted");
    expect(codeOf(settings(store, GLOBAL, { effects: { cost: "confirm" } }))).toBe("accepted");
    expect(codeOf(locks(store, GLOBAL, ["effects.cost"]))).toBe("accepted");
    expect(readFlowSettings(store, "repo").effects.cost).toEqual({ value: "confirm", source: "global", lockedBy: "global", overriddenByLock: "apply-flag" });
    expect(codeOf(locks(store, GLOBAL, []))).toBe("accepted");
    expect(readFlowSettings(store, "repo").effects.cost).toEqual({ value: "apply-flag", source: "project", lockedBy: null });
  }));

  it("a project-layer lock write is refused; locks live only in the global layer", () => withStore((store) => {
    expect(codeOf(locks(store, REPO, ["effects.cost"]))).toBe("control-target-not-allowed");
    expect(() => settings(store, REPO, { locks: ["effects.cost"] })).toThrow();
    expect(readRepositorySettingsBody(store, "repo")).toBeNull();
    expect(readOrchestrationSettings(store)).not.toHaveProperty("flows");
  }));

  it("irreversible apply-flag is refused from every layer in phase 1 (it needs the person token)", () => withStore((store) => {
    expect(codeOf(settings(store, REPO, { effects: { irreversible: "apply-flag" } }))).toBe("flow-setting-needs-person-token");
    expect(codeOf(settings(store, GLOBAL, { effects: { irreversible: "apply-flag" } }))).toBe("flow-setting-needs-person-token");
    expect(codeOf(settings(store, GLOBAL, { effects: { irreversible: "stage-only" } }))).toBe("accepted");
    // A value stored some other way still never resolves to apply-flag (resolveLevel's backstop, policyResolution.test.ts).
    store.transaction(() => writeRepositorySettingsBody(store, "repo", { workspaceMode: "worktree", revision: 1, flows: { effects: { irreversible: "apply-flag" } } }));
    expect(readFlowSettings(store, "repo").effects.irreversible.value).toBe("apply-flag");
  }));

  it("an unchanged write is a no-op; a repository the panel does not know is refused", () => withStore((store) => {
    expect(codeOf(settings(store, REPO, { rerunReview: "auto" }))).toBe("accepted");
    expect(codeOf(settings(store, REPO, { rerunReview: "auto" }))).toBe("no-op-command");
    expect(codeOf(applySetFlowSettings(deps(store), raw(store, "set-flow-settings", { kind: "repository", repoId: "elsewhere" } as never, { set: { rerunReview: "auto" }, clear: [] })))).toBe("control-target-not-allowed");
  }));
});

describe("the kernel reads the flow settings (§6.3, §7.4, §12.3)", () => {
  const TPL = { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nbudget: {tokensPerRun: 3000000}\nroles:\n  writer: {tier: high}\nsteps:\n  - {id: a, kind: draft, role: writer, prompt: a.md}\n  - {id: b, kind: draft, prompt: b.md}\n", assets: { "a.md": "a\n", "b.md": "b\n" } };
  const global = (store: ControlStore, flows: Record<string, unknown>) => store.transaction(() => writeOrchestrationSettings(store, { maxRunningGroups: 3, flows }, orchestrationRevision(store) + 1));

  it("the run pool is the configured tokensPerRun over the template's suggestion; roles come from the layers", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const first = await w.start({ templateRef: "builtin/t" });
      expect(getFlowRun(w.store, first.flowRunId)!.poolTokens).toBe(3_000_000);
      global(w.store, { budgets: { tokensPerRun: 777_000 }, roles: { writer: { agent: "codex" } } });
      const second = await w.start({ templateRef: "builtin/t" });
      expect(getFlowRun(w.store, second.flowRunId)!.poolTokens).toBe(777_000);
      expect((getFlowRun(w.store, second.flowRunId)!.body as { roles: Record<string, unknown> }).roles.writer).toEqual({ agent: "codex", model: "gpt", source: "global" });
    } finally { await w.dispose(); }
  });

  it("rerunReview auto runs a person's plan with the proposal at once; each model skip nobody ticked is a minor decision (gaps §5.2)", async () => {
    const w = await flowWorld({ t: TPL }); try {
      global(w.store, { rerunReview: "auto" });
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, { content: "A1" });
      await w.answer(1, { content: "B1" });
      await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "a" }, body: { text: "x" }, by: "ann", via: "cli:test", requestId: "r1" });
      await w.answer(w.calls.length - 1, { skips: [{ stepKey: "b", reason: "b is fine" }] });
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "running", chosen: { steps: ["a"] } });
      expect(w.calls.at(-1)).toMatchObject({ purpose: "flow-draft", key: { stepKey: "a", seq: 2 } });
      expect(w.store.db.prepare("SELECT grade, step_key AS stepKey, body FROM flow_decisions").all().map((r) => ({ ...r, body: JSON.parse(String(r.body)) })))
        .toEqual([{ grade: "minor", stepKey: "b", body: { kind: "rerun-skip", planNo: 1, reason: "b is fine", source: "rerun-proposal" } }]);
    } finally { await w.dispose(); }
  });
});

describe("flows.rerunAskTimeoutSeconds (gaps §5.3)", () => {
  it("is an integer 30-86400 and not lockable (not a security field)", () => {
    for (const ok of [30, 300, 86_400]) expect(flowsLayerSchema.safeParse({ rerunAskTimeoutSeconds: ok }).success).toBe(true);
    for (const bad of [29, 86_401, 300.5, "300"]) expect(flowsLayerSchema.safeParse({ rerunAskTimeoutSeconds: bad }).success).toBe(false);
    expect((FLOW_LOCKABLE_PATHS as readonly string[]).includes("rerunAskTimeoutSeconds")).toBe(false);
    expect((FLOW_SETTING_FIELDS as readonly string[]).includes("rerunAskTimeoutSeconds")).toBe(true);
  });
});
