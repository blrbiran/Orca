import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { estimatorSlotFor, importControlPlan } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { controlPlanSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { FIXTURE_AGENT_ID, seedPreferences } from "./fixtures/agents.js";
import { FIXTURE_AGENT, profileSnapshot, webFixture } from "./fixtures/web.js";

// Agent selection spec §6.2 (plan layers), §6.4 (the estimator slot is frozen at import, and a failure degrades
// the estimate rather than refusing the import), §12 C5 (the estimate run's configHash is the frozen estimator
// selection's, never the profile hash), W6-20 (a panel write replaces a whole layer). Controller ruling R7
// (W5-M16, a registered deviation from spec §6.3): plan files carry no estimatorAgent, and the import-time
// estimator slot is resolved from the importing operator's two layers only; a group estimator layer comes from
// the panel and takes effect on re-estimate.

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const group = (h: Fixture, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body));
const work = (h: Fixture, taskId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const planBase = { targetRepo: "/abs/repo", ccloopBin: "/abs/ccloop", runsDir: "/abs/runs", workBranch: "orca/w", policy: "local-merge", ledgerMode: "out-of-repo" };
const task = { taskId: "a", contract: "/abs/a.json", dependsOn: [] };
/** What the fixture port answers for `partial` (web.ts): requested fields echoed, the rest from FIXTURE_AGENT. */
const answered = (partial: object) => ({
  selection: { ...FIXTURE_AGENT, ...partial }, configHash: sha256Canonical({}), timeoutMs: 120_000, killGraceMs: 5_000,
  capabilities: profileSnapshot().profile.capabilities,
});
/** A port whose `resolveAgent` is `resolveAgent` and whose other methods are never reached. */
const portWith = (resolveAgent: ExecutionPort["resolveAgent"]): ExecutionPort => {
  const unused = async (): Promise<never> => { throw new Error("unused"); };
  return { resolveAgent, listAgents: unused, readEvidence: unused, accept: unused, inspect: unused, requestHandoff: unused, collect: unused };
};
const importG2 = (h: Fixture) => h.rawCommand("import-g2", 0, "import-plan", { kind: "group", groupId: "g2" }, { groupId: "g2", repoId: "repo", planId: "plan" }) as never;

describe("the plan file carries agent layers (spec §6.2, R7)", () => {
  it("accepts group worker and reconcile layers and a task layer, and refuses an unknown selection field", () => {
    const accepted = loadPlan({ ...planBase, agent: { agent: "claude" }, reconcileAgent: { contextWindow: 1_000_000 },
      tasks: [{ ...task, agent: { agent: "codex", model: "gpt-6-sol" } }] }, "main");
    expect(accepted).toEqual({ plan: expect.objectContaining({ agent: { agent: "claude" }, reconcileAgent: { contextWindow: 1_000_000 },
      tasks: [{ ...task, agent: { agent: "codex", model: "gpt-6-sol" } }] }) });
    expect(loadPlan({ ...planBase, tasks: [{ ...task, agent: { agent: "codex", sandbox: "x" } }] }, "main")).toMatchObject({ rejections: [{ code: "malformed" }] });
  });

  it("refuses a plan that names an estimator selection, in the file and in the normalized plan (R7)", async () => {
    expect(loadPlan({ ...planBase, estimatorAgent: { agent: "codex" }, tasks: [task] }, "main")).toMatchObject({ rejections: [{ code: "malformed" }] });
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { model: "task-model" } }], { planAgents: { agent: { model: "group-model" }, reconcileAgent: { agent: "other" } } }); try {
      const plan = readArchivedPlan(h.store, "g").plan;
      // The plan's own layers are part of the archived (hashed) plan ...
      expect(plan).toMatchObject({ agent: { model: "group-model" }, reconcileAgent: { agent: "other" }, tasks: [{ taskId: "a", agent: { model: "task-model" } }] });
      expect(controlPlanSchema.safeParse(plan).success).toBe(true);
      // ... and an estimator layer is not one of them.
      expect(controlPlanSchema.safeParse({ ...plan, estimatorAgent: { agent: "codex" } }).success).toBe(false);
    } finally { await h.dispose(); }
  });
});

describe("import freezes the estimator slot from the operator's layers (spec §6.4, R7)", () => {
  it("resolves operator default < per-agent < operator estimator, ignores the plan's layers, and freezes ccloop's answer", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { agent: "other", model: "task-model" } }], {
      preferences: { defaultAgent: FIXTURE_AGENT_ID, perAgent: { [FIXTURE_AGENT_ID]: { model: "per-agent-model" } }, estimator: { contextWindow: 1_000_000 } },
      planAgents: { agent: { agent: "other", model: "group-worker-model" }, reconcileAgent: { model: "plan-reconcile-model" } },
    }); try {
      const partial = { agent: FIXTURE_AGENT_ID, model: "per-agent-model", contextWindow: 1_000_000 };
      expect(h.asked).toEqual([partial]);
      const expected = { ...answered(partial), partial, provenance: { agent: "operator", model: "operator-agent", contextWindow: "operator-estimator" } };
      expect(group(h).estimatorSlot).toEqual(expected);
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "queued", estimatorSlot: expected });
      // W6-20: the plan's layers become the group's and the task's override layers, verbatim.
      expect(group(h).agentOverrides).toEqual({ worker: { agent: "other", model: "group-worker-model" }, reconcile: { model: "plan-reconcile-model" } });
      expect(group(h).reconcileSlot).toBeNull();
      expect(work(h, "a").agentOverride).toEqual({ agent: "other", model: "task-model" });
    } finally { await h.dispose(); }
  });

  it("still imports when no operator layer names an agent -- a plan's worker agent does not count -- degrading the estimate by name", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { preferences: null, planAgents: { agent: { agent: FIXTURE_AGENT_ID } } }); try {
      expect(h.imported.result).toMatchObject({ kind: "imported", estimateState: "blocked-capability", estimateReasonCode: "agent-selection-rejected:estimator:agent-unselected" });
      expect(h.asked).toEqual([]);
      expect(group(h).estimatorSlot).toBeNull();
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "blocked-capability", estimatorSlot: null, request: null });
      expect(h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("degrades the estimate with ccloop's own refusal code", async () => {
    const h = await webFixture(); try {
      const refusing = createExecutionProfileRouter([resolveProfile(profileSnapshot(), portWith(async () => { throw new ControlError("agent-installation-missing"); }))]);
      const prepared = await estimatorSlotFor({ store: h.store, profileRouter: refusing }, "human", {}, refusing.list()[0]!);
      expect(prepared.outcome).toEqual({ kind: "rejected", partial: { agent: FIXTURE_AGENT_ID }, code: "agent-installation-missing" });
      const second = importControlPlan({ ...h.deps, estimatorSlot: prepared.outcome, estimatorObservation: () => prepared.observation }, importG2(h));
      expect(second).toMatchObject({ result: { estimateState: "blocked-capability", estimateReasonCode: "agent-selection-rejected:estimator:agent-installation-missing" } });
      expect(group(h, "g2").estimatorSlot).toBeNull();
    } finally { await h.dispose(); }
  });

  it("refuses to freeze an answer that does not echo what was asked (spec §4.6 M5)", async () => {
    const h = await webFixture(); try {
      const drifting = createExecutionProfileRouter([resolveProfile(profileSnapshot(), portWith(async (partial) => ({ ...answered(partial), selection: { ...FIXTURE_AGENT, ...partial, agent: "someone-else" } })))]);
      const prepared = await estimatorSlotFor({ store: h.store, profileRouter: drifting }, "human", {}, drifting.list()[0]!);
      expect(prepared.outcome).toEqual({ kind: "rejected", partial: { agent: FIXTURE_AGENT_ID }, code: "agent-selection-invalid" });
      expect(prepared.observation).toMatchObject({ probeFailureCode: "agent-selection-invalid", resolution: null });
    } finally { await h.dispose(); }
  });

  it("refuses an import whose operator layers changed after the estimator slot was resolved", async () => {
    const h = await webFixture(); try {
      seedPreferences(h.store, "human", { defaultAgent: "other", perAgent: {} }, 1);
      const stale = importControlPlan({ ...h.deps, estimatorObservation: () => ({ profile: h.frozen, observed: h.frozen.snapshot.profile.capabilities, probeFailureCode: null }) }, importG2(h));
      expect(stale).toMatchObject({ error: { code: "plan-version-conflict" } });
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g2'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("gives the estimate run the frozen estimator configHash and selection, never the profile hash (spec §12 C5)", async () => {
    const h = await webFixture(); try {
      const slot = group(h).estimatorSlot;
      const run = await new WebControlService(h.deps).claimEstimate("g", h.estimateId);
      expect(run).toMatchObject({ configHash: slot.configHash, agent: slot.selection, agentProvenance: slot.provenance, killGraceMs: slot.killGraceMs, timeoutMs: slot.timeoutMs });
      expect(run!.configHash).not.toBe(h.frozen.profileHash);
      // Spec §6.4 last paragraph: the claim's capability probe is of the frozen selection itself.
      expect(h.asked.at(-1)).toEqual(slot.selection);
    } finally { await h.dispose(); }
  });

  it("never claims an estimate that froze no estimator selection (spec §12 C5)", async () => {
    const h = await webFixture(); try {
      const row = h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!;
      h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?")
        .run(canonicalBytes({ ...JSON.parse(String(row.body)), estimatorSlot: null }).toString("utf8"), h.estimateId);
      await expect(new WebControlService(h.deps).claimEstimate("g", h.estimateId)).rejects.toThrow("recovery-blocked:estimator-slot-missing");
      expect(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("reads a selection-refused estimate only when it froze neither a slot nor a request", async () => {
    const h = await webFixture(); try {
      const queued = JSON.parse(String(h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.body));
      const store = (body: object) => h.store.db.prepare("UPDATE estimates SET state='blocked-capability',body=? WHERE group_id='g' AND id=?")
        .run(canonicalBytes({ ...queued, state: "blocked-capability", reasonCode: "agent-selection-rejected:estimator:agent-installation-missing", ...body }).toString("utf8"), h.estimateId);
      store({ request: null, requestHash: null, estimatorSlot: null });
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "blocked-capability", estimatorSlot: null });
      store({ request: null, requestHash: null });
      expect(() => readEstimateRecord(h.store, "g", h.estimateId)).toThrow("recovery-blocked");
      store({ estimatorSlot: null });
      expect(() => readEstimateRecord(h.store, "g", h.estimateId)).toThrow("recovery-blocked");
    } finally { await h.dispose(); }
  });

  it("shows an estimate run only while it carries its estimate's frozen selection (spec §12 C5)", async () => {
    const h = await webFixture(); try {
      const run = await new WebControlService(h.deps).claimEstimate("g", h.estimateId);
      expect(readControlGroup(h.store, "epoch", "g").runs.map((view) => view.runId)).toEqual([run!.runId]);
      const tamper = (patch: object) => h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, ...patch }), run!.runId);
      tamper({ agent: { ...FIXTURE_AGENT, model: "another-model" } });
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow(`recovery-blocked:run-estimate-agent:${run!.runId}`);
      tamper({ configHash: h.frozen.profileHash });
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow(`recovery-blocked:run-estimate-agent:${run!.runId}`);
    } finally { await h.dispose(); }
  });

  it("re-estimates with the group's estimator layer as it is now, set from the panel (spec §6.4, R7)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { preferences: null }); try {
      const service = new WebControlService(h.deps);
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
      const set = await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "estimator" }, partial: { model: "panel-estimator" } }));
      expect(set).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      const created = await service.createEstimate(h.command("estimate", { proposalVersion: 2, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(created.result.estimateState).toBe("queued");
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).estimatorSlot).toMatchObject({
        selection: { agent: FIXTURE_AGENT_ID, model: "panel-estimator", contextWindow: "agent-default" },
        provenance: { agent: "operator", model: "group-estimator", contextWindow: "descriptor" },
      });
      // The group's import-time slot records that import only.
      expect(group(h).estimatorSlot).toBeNull();
    } finally { await h.dispose(); }
  });
});

describe("proposal-set-agent (spec §6.2, W6-20)", () => {
  it("replaces a group or task layer, advances the proposal version, and returns the proposal to editable", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { agent: "other", model: "plan-task-model" } }]); try {
      const service = new WebControlService(h.deps);
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: { agent: "other" } })))
        .toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      expect(group(h).agentOverrides).toEqual({ worker: { agent: "other" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 2, scope: { kind: "task", taskId: "a" }, partial: { model: "panel-task-model" } })))
        .toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 3 } });
      // W6-20 (registered deviation from spec §6.2's field merge): the panel's value replaces the plan's whole task layer.
      expect(work(h, "a").agentOverride).toEqual({ model: "panel-task-model" });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body))).toMatchObject({ proposalVersion: 3, state: "editable" });
      expect(group(h).proposal).toMatchObject({ proposalVersion: 3, state: "editable" });
    } finally { await h.dispose(); }
  });

  it("clears a layer with null, and refuses a stale base, an unknown task and a no-op", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { model: "plan-task-model" } }], { planAgents: { reconcileAgent: { agent: "other" } } }); try {
      const service = new WebControlService(h.deps);
      expect(group(h).agentOverrides).toEqual({ reconcile: { agent: "other" } });
      await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "reconcile" }, partial: null }));
      expect(group(h).agentOverrides).toEqual({});
      await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 2, scope: { kind: "task", taskId: "a" }, partial: null }));
      expect(work(h, "a").agentOverride).toBeNull();
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "task", taskId: "a" }, partial: { model: "x" } })))
        .toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 3, scope: { kind: "task", taskId: "missing" }, partial: { model: "x" } })))
        .toMatchObject({ error: { code: "work-not-found" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 3, scope: { kind: "task", taskId: "a" }, partial: null })))
        .toMatchObject({ error: { code: "no-op-command" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 3, scope: { kind: "group", slot: "reconcile" }, partial: null })))
        .toMatchObject({ error: { code: "no-op-command" } });
      expect(canonicalBytes(work(h, "a").agentOverride).toString("utf8")).toBe("null");
    } finally { await h.dispose(); }
  });
});

describe("a model the operator names is opaque to Orca (spec §3 I2)", () => {
  it("passes an operator estimator agent through and labels what ccloop filled as the descriptor's", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { preferences: { perAgent: {}, estimator: { agent: FIXTURE_AGENT_ID } } }); try {
      expect(group(h).estimatorSlot.selection).toEqual(FIXTURE_AGENT);
      expect(group(h).estimatorSlot.partial).toEqual({ agent: FIXTURE_AGENT_ID });
      expect(group(h).estimatorSlot.provenance).toEqual({ agent: "operator-estimator", model: "descriptor", contextWindow: "descriptor" });
    } finally { await h.dispose(); }
  });
});
