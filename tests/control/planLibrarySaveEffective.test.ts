import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ControlError } from "../../src/control/errors.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { readVersion } from "../../src/control/planLibrary/store.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
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
