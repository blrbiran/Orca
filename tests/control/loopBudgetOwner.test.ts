import { describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { errorOf, loop } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §4.3 (C6, Rule 7; criterion 8's last line): a loop task's work allocation has one owner,
 * set-task-loop. proposal-edit refuses an operation on it by name; a loop task's handoff row, a hand-written task's rows,
 * the group limit and goal review stay with proposal-edit.
 */
describe("who owns a loop task's work budget (spec §4.3)", () => {
  it("refuses proposal-edit on a loop task's work row, and only there", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]);
    try {
      const service = new WebControlService(h.deps);
      const edit = (taskId: string, allocation: "work" | "handoff", value: number) => service.editProposal(h.command("proposal-edit", {
        baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion,
        operations: [{ target: { scope: "task", taskId, allocation, dimension: "tokens" }, value, provenance: "human" }],
      }));
      expect(errorOf(edit("a", "work", 2_000_000))).toMatchObject({ code: "budget-owned-by-loop-plan" });
      expect(edit("a", "handoff", 200_000)).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(edit("c", "work", 2_000_000)).toMatchObject({ result: { kind: "proposal-edited" } });
    } finally { await h.dispose(); }
  });
});
