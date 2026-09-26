import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { handoffGraceMsOf, HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { readConfirmedReconcileSlot, readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart, scheduleStart } from "../../src/control/webDispatch.js";
import { executionProfileSnapshotSchema, executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { FIXTURE_AGENT_ID, FIXTURE_OTHER_AGENT_ID, fixtureResolveAgent, seedPreferences } from "./fixtures/agents.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Agent selection spec §6.4 (confirm freezes; §12 C4 selectionsHash; §12 C3 gates use the frozen selection),
// §6.5 (profile v2, capabilities per (profile, selection)), §6.6 (grace from the frozen killGraceMs), §6.2
// (plan configHash removed), W6-1/W6-2/W6-9/W6-16, W5-M12. §12 I13: a criterion that proves "the frozen value was
// used" compares what the port RECEIVED with what ccloop ANSWERED before confirmation -- never a value read back
// from the store the code under test also wrote.

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const work = (h: Fixture, taskId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const groupBody = (h: Fixture) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const resolved = (resolution: Awaited<ReturnType<typeof resolveGroupSelections>>, key: string) => {
  const slot = resolution.slots.find((entry) => entry.key === key)!;
  if (slot.outcome.kind !== "resolved") throw new Error(`${key} rejected: ${slot.outcome.code}`);
  return slot.outcome.frozen;
};

describe("resolveGroupSelections (W6-1, spec §6.3/§6.4 step 1)", () => {
  it("resolves every task's worker slot and the group's reconcile slot, sorted by key, asking ccloop once per distinct partial", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT_ID } }]); try {
      h.resolveAgent.mockClear();
      const resolution = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      expect(resolution.slots.map((slot) => [slot.key, slot.slot, slot.taskId])).toEqual([["reconcile", "reconcile", null], ["task:a", "worker", "a"], ["task:b", "worker", "b"]]);
      // task a and the reconcile slot resolve to the same partial: one call answers both.
      expect(h.resolveAgent.mock.calls.map(([partial]) => partial)).toEqual([{ agent: FIXTURE_AGENT_ID }, { agent: FIXTURE_OTHER_AGENT_ID }]);
      expect(resolved(resolution, "task:b").provenance).toEqual({ agent: "task", model: "descriptor", contextWindow: "descriptor" });
      expect(resolution.taskOverrides).toEqual({ a: null, b: { agent: FIXTURE_OTHER_AGENT_ID } });
      expect(resolution.selectionsHash).toBe(sha256Canonical(Object.fromEntries(resolution.slots.map((slot) => {
        const frozen = resolved(resolution, slot.key);
        return [slot.key, { partial: frozen.partial, selection: frozen.selection, configHash: frozen.configHash }];
      }))));
    } finally { await h.dispose(); }
  });

  it("reports a refused slot by ccloop's code and has no selectionsHash then (W6-11)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: "no-such-agent" } }]); try {
      const resolution = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      expect(resolution.slots.find((slot) => slot.key === "task:b")!.outcome).toEqual({ kind: "rejected", code: "agent-installation-missing" });
      expect(resolution.selectionsHash).toBeNull();
    } finally { await h.dispose(); }
  });

  it("reads the layers of the operator it is asked for (W6-16)", async () => {
    const h = await webFixture(); try {
      seedPreferences(h.store, "other-operator", { defaultAgent: FIXTURE_OTHER_AGENT_ID, perAgent: {} });
      const mine = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      const theirs = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "other-operator");
      expect([resolved(mine, "task:a").selection.agent, resolved(theirs, "task:a").selection.agent]).toEqual([FIXTURE_AGENT_ID, FIXTURE_OTHER_AGENT_ID]);
    } finally { await h.dispose(); }
  });
});

describe("confirm freezes the selection the operator saw (spec §6.4, §12 C4)", () => {
  it("rejects the whole confirmation when any slot fails, naming the task and ccloop's code, and freezes nothing", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: "no-such-agent" } }]); try {
      const result = await new WebControlService(h.deps).confirm(h.command("confirm", { ...(await h.confirmPayload()), selectionsHash: "0".repeat(64) }));
      expect(result).toMatchObject({ error: { code: "agent-selection-rejected", message: "agent-selection-rejected:b:agent-installation-missing" } });
      expect([work(h, "a").configHash, work(h, "b").configHash, work(h, "a").agent]).toEqual([null, null, undefined]);
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });

  it("refuses a confirmation whose previewed selectionsHash no longer matches (preferences changed after the preview)", async () => {
    const h = await webFixture(); try {
      const payload = await h.confirmPayload();
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_AGENT_ID, perAgent: { [FIXTURE_AGENT_ID]: { model: "changed" } } }, 1);
      expect(await new WebControlService(h.deps).confirm(h.command("confirm", payload))).toMatchObject({ error: { code: "agent-selection-changed" } });
      expect(work(h, "a").configHash).toBeNull();
    } finally { await h.dispose(); }
  });

  it("re-checks the layers inside the transaction: a change while ccloop answers is refused even with a fresh hash", async () => {
    const h = await webFixture(); try {
      const payload = await h.confirmPayload();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const answer = h.resolveAgent.getMockImplementation()!;
      h.resolveAgent.mockImplementation(async (partial) => { await gate; return answer(partial); });
      const pending = new WebControlService(h.deps).confirm(h.command("confirm", payload));
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_OTHER_AGENT_ID, perAgent: {} }, 1);
      release();
      expect(await pending).toMatchObject({ error: { code: "agent-selection-changed" } });
      expect(work(h, "a").configHash).toBeNull();
    } finally { await h.dispose(); }
  });

  it("freezes ccloop's answer onto every work item, the group's reconcile slot and execution snapshot v2", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT_ID, model: "b-model" } }]); try {
      const preview = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const b = resolved(preview, "task:b");
      const expectedB = { agent: b.selection, agentProvenance: b.provenance, configHash: b.configHash, timeoutMs: b.timeoutMs, killGraceMs: b.killGraceMs, agentCapabilities: profileSnapshot().profile.capabilities };
      expect(work(h, "b")).toMatchObject(expectedB);
      expect(groupBody(h).reconcileSlot).toEqual(resolved(preview, "reconcile"));
      const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash)));
      expect(snapshot.schema).toBe("orca-execution-snapshot-v2");
      expect(snapshot.agents.tasks.find((task) => task.taskId === "b")).toEqual({ taskId: "b", ...expectedB });
      expect(readConfirmedTaskExecution(h.store, "g", "b").agent).toEqual(expectedB);
      expect(readConfirmedReconcileSlot(h.store, "g")).toEqual(resolved(preview, "reconcile"));
      expect(readControlGroup(h.store, "epoch-test", "g").workItems.find((item) => item.taskId === "b"))
        .toMatchObject({ configHash: b.configHash, agent: b.selection, agentProvenance: b.provenance });
    } finally { await h.dispose(); }
  });

  it("freezes each task's capabilities as the worker profile's declaration intersected with ccloop's answer for that task", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT_ID } }]); try {
      const answer = h.resolveAgent.getMockImplementation()!;
      h.resolveAgent.mockImplementation(async (partial) => {
        const base = await answer(partial);
        return partial.agent === FIXTURE_OTHER_AGENT_ID ? { ...base, capabilities: { ...base.capabilities, contextWindowTokens: 200_000 } } : base;
      });
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", { ...(await h.confirmPayload()), contextPolicy: { handoffAtContextTokens: 100_000 } }));
      if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
      expect([work(h, "a").agentCapabilities.contextWindowTokens, work(h, "b").agentCapabilities.contextWindowTokens]).toEqual([1_000_000, 200_000]);
    } finally { await h.dispose(); }
  });

  it("treats the snapshot as authority: a frozen field edited after confirmation is refused by execution and the read model", async () => {
    const h = await webFixture(); try {
      await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      const edited = { ...work(h, "a"), agent: { agent: FIXTURE_OTHER_AGENT_ID, model: "x", contextWindow: "agent-default" } };
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(edited));
      expect(() => readConfirmedTaskExecution(h.store, "g", "a")).toThrow("recovery-blocked");
      expect(() => readControlGroup(h.store, "epoch-test", "g")).toThrow("work-item-agent:a");
    } finally { await h.dispose(); }
  });

  it("treats the snapshot as authority for the group's reconcile slot too", async () => {
    const h = await webFixture(); try {
      await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      const body = groupBody(h);
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, reconcileSlot: { ...body.reconcileSlot, killGraceMs: 1 } }));
      expect(() => readConfirmedReconcileSlot(h.store, "g")).toThrow("recovery-blocked");
      expect(() => readControlGroup(h.store, "epoch-test", "g")).toThrow("execution-snapshot-agents");
    } finally { await h.dispose(); }
  });

  it("shows a draft work item with no configHash and no selection (spec §6.2, §12 I3)", async () => {
    const h = await webFixture(); try {
      expect(readControlGroup(h.store, "epoch-test", "g").workItems[0]).toMatchObject({ configHash: null, agent: null, agentProvenance: null });
      expect(readArchivedPlan(h.store, "g").plan.tasks[0]).not.toHaveProperty("configHash");
    } finally { await h.dispose(); }
  });

  it("drops every frozen selection when a confirmed proposal is reopened", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      const edited = service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion,
        operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 1234, provenance: "human" }] }));
      if ("error" in edited) throw new Error(JSON.stringify(edited));
      expect(work(h, "a")).toMatchObject({ configHash: null });
      for (const key of ["agent", "agentProvenance", "timeoutMs", "killGraceMs", "agentCapabilities"]) expect(work(h, "a")).not.toHaveProperty(key);
      expect(groupBody(h).reconcileSlot).toBeNull();
      expect(readControlGroup(h.store, "epoch-test", "g").workItems[0]).toMatchObject({ configHash: null, agent: null, agentProvenance: null });
    } finally { await h.dispose(); }
  });
});

describe("after confirmation the frozen selection is the one used (spec §9 criterion 8, §12 C3/I13)", () => {
  it("probes and claims with the frozen selection even after the operator switches default agent", async () => {
    const h = await webFixture(); try {
      const preview = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      const frozen = resolved(preview, "task:a");
      const service = new WebControlService(h.deps);
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_OTHER_AGENT_ID, perAgent: {} }, 1);
      h.resolveAgent.mockClear();
      const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
      expect(await scheduleStart(deps, h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const delivered = await deliverScheduledStart(deps, "g");
      if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
      expect(h.resolveAgent.mock.calls.length).toBeGreaterThan(0);
      for (const [partial] of h.resolveAgent.mock.calls) expect(partial).toEqual(frozen.selection);
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(delivered.runId)!.body));
      expect({ agent: run.agent, configHash: run.configHash, killGraceMs: run.killGraceMs, agentProvenance: run.agentProvenance })
        .toEqual({ agent: frozen.selection, configHash: frozen.configHash, killGraceMs: frozen.killGraceMs, agentProvenance: frozen.provenance });
    } finally { await h.dispose(); }
  });

  it("blocks the whole group's start when any one task's frozen selection probes degraded (W5-M12)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT_ID } }]); try {
      await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      const answer = h.resolveAgent.getMockImplementation()!;
      h.resolveAgent.mockImplementation(async (partial) => {
        const base = await answer(partial);
        return partial.agent === FIXTURE_OTHER_AGENT_ID ? { ...base, capabilities: { ...base.capabilities, handoffControl: "phase-end" as const } } : base;
      });
      const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
      expect(await scheduleStart(deps, h.command("start", {}))).toMatchObject({ error: { code: "control-capability-unsupported" } });
      expect(h.resolveAgent.mock.calls.map(([partial]) => partial.agent)).toContain(FIXTURE_OTHER_AGENT_ID);
    } finally { await h.dispose(); }
  });
});

describe("profile v2 (spec §6.5)", () => {
  it("refuses a v1 snapshot and any adapter identity field", () => {
    const v2 = profileSnapshot();
    expect(executionProfileSnapshotSchema.safeParse(v2).success).toBe(true);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, schema: "orca-execution-profile-snapshot-v1" }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, profile: { ...v2.profile, adapter: "codex" } }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, resolved: { ...v2.resolved, adapterImplementationHash: "d".repeat(64) } }).success).toBe(false);
  });

  it("intersects the declared capabilities with the answer for the probed selection, per selection", async () => {
    const declared = profileSnapshot().profile.capabilities;
    const resolveAgent = fixtureResolveAgent(() => declared);
    const answer = resolveAgent.getMockImplementation()!;
    resolveAgent.mockImplementation(async (partial) => {
      const base = await answer(partial);
      return partial.agent === FIXTURE_OTHER_AGENT_ID ? { ...base, capabilities: { ...base.capabilities, handoffControl: "phase-end" as const } } : base;
    });
    const unused = async (): Promise<never> => { throw new Error("unused"); };
    const profile = resolveProfile(profileSnapshot(), { resolveAgent, listAgents: unused, readEvidence: unused, accept: unused, inspect: unused, requestHandoff: unused, collect: unused });
    const router = createExecutionProfileRouter([profile]);
    expect((await router.probe(router.list()[0]!, { agent: FIXTURE_AGENT_ID })).observed.handoffControl).toBe("durable");
    expect((await router.probe(router.list()[0]!, { agent: FIXTURE_OTHER_AGENT_ID })).observed.handoffControl).toBe("phase-end");
  });
});

describe("plan files and grace (spec §6.2, §6.6)", () => {
  it("refuses a plan task that still carries configHash", () => {
    const base = { targetRepo: "/abs/repo", ccloopBin: "/abs/ccloop", runsDir: "/abs/runs", workBranch: "orca/w", policy: "local-merge", ledgerMode: "out-of-repo" };
    expect(loadPlan({ ...base, tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], targetVersion: 1 }] }, "main")).toHaveProperty("plan");
    expect(loadPlan({ ...base, tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], targetVersion: 1, configHash: "a".repeat(64) }] }, "main"))
      .toMatchObject({ rejections: [{ code: "malformed" }] });
  });

  it("judges a handoff's grace by the run's frozen killGraceMs plus the fixed extra", () => {
    expect(handoffGraceMsOf({ killGraceMs: 7_000 })).toBe(7_000 + HANDOFF_EXTRA_GRACE_MS);
    for (const killGraceMs of [undefined, -1, 1.5, "5000", null]) expect(handoffGraceMsOf({ killGraceMs })).toBe(HANDOFF_EXTRA_GRACE_MS);
  });

  it("keeps the canonical identity of what it froze (the snapshot hash is over canonical bytes)", async () => {
    const h = await webFixture(); try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const record = readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash);
      expect(canonicalBytes(JSON.parse(record)).toString("utf8")).toBe(record);
    } finally { await h.dispose(); }
  });
});
