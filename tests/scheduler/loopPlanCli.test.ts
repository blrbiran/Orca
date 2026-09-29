import { describe, expect, it } from "vitest";
import { ControlService } from "../../src/control/service.js";
import { loadRound } from "../../src/scheduler/run.js";
import { openTestStore } from "../control/fixtures/store.js";
import { captureStreams, makeSandbox, runCli, seedRejectablePlan, type Sandbox } from "./sandbox.js";

/**
 * Loop plans spec §3.4 (C1; criterion 4): a loop task is expanded only by Web import. Every CLI consumer -- `orca
 * plan`, `orca run` and a controlled CLI round -- refuses it by name before reading any contract, rather than running a
 * round without it.
 */
const LOOP = { plan: "standard", goal: "write a.txt", successCondition: "a.txt exists", targetPaths: ["a.txt"], checks: ["true"] };
const loopPlan = (s: Sandbox): Promise<string> => seedRejectablePlan(s, { tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] });

describe("the CLI refuses a loop task by name (spec §3.4)", () => {
  it.each([["plan"], ["run"]])("orca %s exits 1 naming loop-plan-cli-unsupported:T1", async (command) => {
    const s = await makeSandbox();
    try {
      const planPath = await loopPlan(s);
      const { result, stderr } = await captureStreams(() => runCli([command, planPath]).catch((err: Error) => err.message));
      expect(result).toBe(1);
      expect(stderr).toContain("rejected: loop-plan-cli-unsupported:T1:");
    } finally { await s.cleanup(); }
  });

  it("reports it together with the plan's other rejections, all at once (final review Minor 3)", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, { runsDir: "relative-runs", tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] });
      const loaded = await loadRound(planPath);
      expect("rejections" in loaded && loaded.rejections.map((rejection) => rejection.code)).toEqual(["relative-path", "loop-plan-cli-unsupported:T1"]);
    } finally { await s.cleanup(); }
  });

  it("reads loop tasks from a malformed plan's raw tasks without failing on their shape", async () => {
    const s = await makeSandbox();
    try {
      for (const tasks of ["not a list", ["x", null, { taskId: 7, loop: LOOP, dependsOn: [] }, { taskId: "T2", contract: "/nowhere.json", dependsOn: [] }]]) {
        const loaded = await loadRound(await seedRejectablePlan(s, { tasks }));
        expect("rejections" in loaded && [...new Set(loaded.rejections.map((rejection) => rejection.code))]).toEqual(["malformed"]);
      }
    } finally { await s.cleanup(); }
  });

  it("a controlled CLI round refuses it with the same name", async () => {
    const s = await makeSandbox(), h = await openTestStore();
    try {
      await expect(new ControlService(h.store).run("g", await loopPlan(s))).rejects.toThrow("control-plan-rejected:loop-plan-cli-unsupported:T1");
    } finally { await h.dispose(); await s.cleanup(); }
  });

  it("a profiled controlled round refuses it with the same name", async () => {
    // loadRound runs before any profile is resolved, so a well-formed but unregistered selection suffices here.
    const selection = { workKind: "task" as const, profileId: "p", profileHash: "a".repeat(64) };
    const s = await makeSandbox(), h = await openTestStore();
    try {
      await expect(new ControlService(h.store).runProfiled("g", await loopPlan(s), selection, selection)).rejects.toThrow("control-plan-rejected:loop-plan-cli-unsupported:T1");
    } finally { await h.dispose(); await s.cleanup(); }
  });
});
