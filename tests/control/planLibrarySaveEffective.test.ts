import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupSelectionPartials, resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ControlError } from "../../src/control/errors.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { readVersion } from "../../src/control/planLibrary/store.js";
import { importControlPlanAsync, type ImportCommand } from "../../src/control/planImport.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { FIXTURE_AGENT_ID } from "./fixtures/agents.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Issue #154 (session 3cfc2e73; scheduled-flows spec 2026-10-24, Correction of that session): `plan save --group` used
// to write the archived plan -- the recipe and labels as imported -- so a library entry silently held a loop task's
// pre-amendment goal and a task's pre-override labels, and every re-import or schedule fire ran the old task. The saved
// document is now the group as it runs: amended recipes and the labels in effect.
const LOOP = { plan: "standard", goal: "loop goal", successCondition: "loop done", targetPaths: ["src/**"], checks: ["true"] };
const PERSON = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
type SavedTask = { taskId: string; labels?: string[]; loop?: { inputs: { goal: string } } };

async function world() {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", dependsOn: ["a"], loop: LOOP, labels: ["feature"] }]);
  const repo = join(f.root, "repo");
  const deps = { store: f.store, resolveRepository: (repoId: string) => { if (repoId !== "repo") throw new ControlError("control-target-not-allowed"); return repo; } };
  const save = (commandId: string): SavedTask[] => {
    const command = { schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb: "plan-library-save",
      target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" } } as PlanLibraryCommand;
    const answer = withCommandContext(commandId, PERSON, () => applyPlanLibraryCommand(deps, command)) as { result?: { entryId: string; sha256: string }; error?: unknown };
    expect(answer.error).toBeUndefined();
    return (JSON.parse(readVersion(f.store, answer.result!.entryId, answer.result!.sha256)!.doc) as { tasks: SavedTask[] }).tasks;
  };
  return { f, save, service: new WebControlService(f.deps) };
}
const task = (tasks: SavedTask[], id: string) => tasks.find((t) => t.taskId === id)!;

describe("plan-library-save from a group saves the group as it runs (#154)", () => {
  it("control: with no amendment and no override, the saved document carries the archive's goal and labels", async () => {
    const w = await world();
    try {
      const tasks = w.save("save-plain");
      expect(task(tasks, "b").loop!.inputs.goal).toBe("loop goal");
      expect(task(tasks, "b").labels).toEqual(["feature"]);
      expect(task(tasks, "a").labels).toBeUndefined();
    } finally { await w.f.dispose(); }
  });

  it("an amended loop task is saved with its amended recipe, not the archived one", async () => {
    const w = await world();
    try {
      const plan = readControlGroup(w.f.store, "epoch", "g").workItems.find((item) => item.taskId === "b")!.loopPlan!;
      const work = readBudgetProposal(w.f.store, "g").allocations.find((row) => row.ownerKind === "task" && row.ownerId === "b" && row.bucket === "work")!.amount;
      const changed = await w.service.setTaskLoop(w.f.taskCommand("set-task-loop", "b", {
        baseLoopVersion: plan.loopVersion, plan: "standard", inputs: { ...plan.inputs, goal: "amended goal" },
        work: { tokens: work.tokens, activeMs: work.activeMs!, attempts: work.attempts! },
      }));
      expect(changed).toMatchObject({ result: { kind: "task-loop-set", taskId: "b" } });
      expect(task(w.save("save-amended"), "b").loop!.inputs.goal).toBe("amended goal");
    } finally { await w.f.dispose(); }
  });

  it("an operator's label override is saved; a cleared override drops the archive's labels", async () => {
    const w = await world();
    try {
      expect(w.service.setTaskLabels(w.f.taskCommand("set-task-labels", "a", { labels: ["bug"], baseLabelsVersion: 0 }))).toMatchObject({ result: { kind: "task-labels-set" } });
      expect(w.service.setTaskLabels(w.f.taskCommand("set-task-labels", "b", { labels: [], baseLabelsVersion: 0 }))).toMatchObject({ result: { kind: "task-labels-set" } });
      const tasks = w.save("save-labels");
      expect(task(tasks, "a").labels).toEqual(["bug"]);
      expect(task(tasks, "b").labels).toBeUndefined();
    } finally { await w.f.dispose(); }
  });
});

// Issue #164 (session f958ec3f): the agents an operator chose with proposal-set-agent (the group's worker and reconcile
// layers, each task's layer) were not in the saved document, so a group imported from it -- by hand or by a schedule's
// fire -- ran on whatever the importing operator's defaults said, or could not resolve an agent at all. Each panel layer
// is now folded into the plan layer at its level, as resolution merges the two (agentSelection.ts levelLayers).
type SavedAgents = { agent?: object; reconcileAgent?: object; tasks: Array<{ taskId: string; agent?: object }> };

async function agentWorld(options: Parameters<typeof webFixture>[2], tasks: Parameters<typeof webFixture>[1] = [{ taskId: "a" }]) {
  const f = await webFixture(profileSnapshot(), tasks, options);
  const repo = join(f.root, "repo");
  const deps = { store: f.store, resolveRepository: (repoId: string) => { if (repoId !== "repo") throw new ControlError("control-target-not-allowed"); return repo; } };
  const service = new WebControlService(f.deps);
  let version = 1;
  const setAgent = async (scope: { kind: "group"; slot: "worker" | "reconcile" } | { kind: "task"; taskId: string }, partial: object | null) => {
    const answer = await service.proposalSetAgent(f.command("proposal-set-agent", { baseProposalVersion: version, scope, partial } as never));
    expect(answer).toMatchObject({ result: { kind: "proposal-edited" } });
    version += 1;
  };
  const save = (commandId: string) => {
    const command = { schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb: "plan-library-save",
      target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" } } as PlanLibraryCommand;
    const answer = withCommandContext(commandId, PERSON, () => applyPlanLibraryCommand(deps, command)) as { result?: { entryId: string; sha256: string }; error?: unknown };
    expect(answer.error).toBeUndefined();
    const ref = { entryId: answer.result!.entryId, sha256: answer.result!.sha256 };
    return { ref, doc: JSON.parse(readVersion(f.store, ref.entryId, ref.sha256)!.doc) as SavedAgents };
  };
  const importFrom = async (groupId: string, libraryEntry: { entryId: string; sha256: string }) => {
    const answer = await importControlPlanAsync({ ...f.deps, resolveRepository: deps.resolveRepository } as never, {
      schema: "orca-raw-command-v1", commandId: `import-${groupId}`, actorId: "human", expectedRevision: 0, verb: "import-plan",
      target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", libraryEntry },
    } as ImportCommand) as { error?: unknown };
    expect(answer.error).toBeUndefined();
  };
  /** Each slot's resolved partial, from the layers as stored -- the panel's and the archived plan's. */
  const resolved = (groupId: string) => Object.fromEntries(groupSelectionPartials(f.store, groupId, "human").slots
    .map((slot) => [slot.key, "resolved" in slot ? slot.resolved.partial : slot.code]));
  return { f, setAgent, save, importFrom, resolved };
}

describe("plan-library-save from a group keeps the operator's agent choices (#164)", () => {
  it("set-agent, save, import into a new group: the new group resolves the same agents with no set-agent of its own", async () => {
    // No operator default, so without the panel's choices no slot resolves (the tester's "agent-unselected").
    const w = await agentWorld({ preferences: null });
    try {
      expect(w.resolved("g")).toEqual({ reconcile: "agent-unselected", "task:a": "agent-unselected" });
      await w.setAgent({ kind: "group", slot: "worker" }, { agent: FIXTURE_AGENT_ID });
      await w.setAgent({ kind: "group", slot: "reconcile" }, { model: "reconcile-model" });
      await w.setAgent({ kind: "task", taskId: "a" }, { model: "task-model" });
      const chosen = w.resolved("g");
      expect(chosen).toEqual({ reconcile: { agent: FIXTURE_AGENT_ID, model: "reconcile-model" }, "task:a": { agent: FIXTURE_AGENT_ID, model: "task-model" } });
      const { ref, doc } = w.save("save-agents");
      // mutation: drop the worker fold -> no `agent` -> red here and every slot of g2 agent-unselected
      expect(doc.agent).toEqual({ agent: FIXTURE_AGENT_ID });
      // mutation: drop the reconcile fold -> no `reconcileAgent` -> red
      expect(doc.reconcileAgent).toEqual({ model: "reconcile-model" });
      // mutation: drop the task fold -> task a has no `agent` -> red
      expect(doc.tasks.find((t) => t.taskId === "a")!.agent).toEqual({ model: "task-model" });
      await w.importFrom("g2", ref);
      const fresh = JSON.parse(String(w.f.store.db.prepare("SELECT body FROM groups WHERE id='g2'").get()!.body)) as { agentOverrides: object };
      expect(fresh.agentOverrides).toEqual({});
      expect(w.resolved("g2")).toEqual(chosen);
      const preview = await resolveGroupSelections({ store: w.f.store, port: w.f.deps.port }, "g2", "human", "preview");
      expect(preview.slots.map((slot) => slot.outcome.kind)).toEqual(["resolved", "resolved"]);
      expect(preview.selectionsHash).not.toBeNull();
    } finally { await w.f.dispose(); }
  });

  it("folds each panel layer over the plan's as resolution merges them: a null field masks, a null agent drops, a new agent drops the plan's model", async () => {
    const plan = { agent: "other", model: "plan-model" };
    const w = await agentWorld({ preferences: null, planAgents: { agent: plan, reconcileAgent: { agent: "other", model: "plan-reconcile" } } },
      [{ taskId: "a", agent: { agent: "other", model: "plan-task" } }, { taskId: "b", dependsOn: ["a"], agent: { model: "plan-b" } }]);
    try {
      // Control: with no panel layer, the saved document carries the plan's layers verbatim.
      const untouched = w.save("save-plain").doc;
      expect(untouched.agent).toEqual(plan);
      expect(untouched.reconcileAgent).toEqual({ agent: "other", model: "plan-reconcile" });
      expect(untouched.tasks.find((t) => t.taskId === "a")!.agent).toEqual({ agent: "other", model: "plan-task" });
      await w.setAgent({ kind: "group", slot: "worker" }, { model: null });
      await w.setAgent({ kind: "group", slot: "reconcile" }, { agent: null });
      await w.setAgent({ kind: "task", taskId: "a" }, { agent: FIXTURE_AGENT_ID });
      await w.setAgent({ kind: "task", taskId: "b" }, { contextWindow: 1_000_000 });
      const chosen = w.resolved("g");
      const { ref, doc } = w.save("save-folded");
      // mutation: ignore a panel null field -> the plan's model stays -> red
      expect(doc.agent).toEqual({ agent: "other" });
      // mutation: treat a null agent as absent -> the plan's reconcile layer stays -> red
      expect(doc).not.toHaveProperty("reconcileAgent");
      // mutation: keep the plan's fields when the panel names another agent -> plan-task stays on codex -> red
      expect(doc.tasks.find((t) => t.taskId === "a")!.agent).toEqual({ agent: FIXTURE_AGENT_ID });
      // A field the panel adds under the plan's own agent joins the plan's.
      expect(doc.tasks.find((t) => t.taskId === "b")!.agent).toEqual({ model: "plan-b", contextWindow: 1_000_000 });
      await w.importFrom("g2", ref);
      expect(w.resolved("g2")).toEqual(chosen);
    } finally { await w.f.dispose(); }
  });

  it("refuses to save a task whose stored agent layer is damaged, as confirmation would", async () => {
    const w = await agentWorld({ preferences: null });
    try {
      w.f.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.agentOverride',json('{\"sandbox\":\"x\"}')) WHERE group_id='g' AND id='a'").run();
      const command = { schema: "orca-raw-command-v1", commandId: "save-damaged", actorId: "human", expectedRevision: 0, verb: "plan-library-save",
        target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" } } as PlanLibraryCommand;
      const deps = { store: w.f.store, resolveRepository: () => join(w.f.root, "repo") };
      // mutation: drop the override's schema check -> the unknown field reaches the codec as control-plan-rejected -> red
      const answer = withCommandContext("save-damaged", PERSON, () => applyPlanLibraryCommand(deps, command)) as { error?: { code: string } };
      expect(answer.error?.code).toBe("recovery-blocked");
    } finally { await w.f.dispose(); }
  });
});
