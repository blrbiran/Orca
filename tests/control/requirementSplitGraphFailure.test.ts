import { describe, expect, it, vi } from "vitest";
import { latestDraft, readDraft } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Issue 89 (human: fix the problem, not the tester's patch). When computing a split's layers threw (issue 88's cycle
// was one way), the error escaped the split's evaluation, the driver blocked the call's run at C and the draft stayed
// drafting. Nothing moved it on: retrying the run judged the same output and threw again, the group's retry found no
// failed draft to redraft, and archive was refused because the draft's call was still pending. Issue 88 removed that
// cycle, so this file makes buildGraph throw on purpose to keep the way out under test whatever the next throw is.
const graphFails = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/scheduler/graph.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/scheduler/graph.js")>();
  return { ...original, buildGraph: (...args: Parameters<typeof original.buildGraph>) => {
    if (graphFails.on) throw new Error("buildGraph: no schedulable task among a, b — a cycle slipped through");
    return original.buildGraph(...args);
  } };
});

describe("a split whose layers code cannot compute (issue 89)", () => {
  it("is handed back with the error as its reason, fails after the automatic retries with every run closed, and can be retried or archived", async () => {
    graphFails.on = true;
    const x = await requirementHarness({ answers: [1, 2, 3, 4].map(() => ({ purpose: "split" as const, output: VALID_SPLIT })), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 3).state === "failed");
      const reason = "graph:buildGraph: no schedulable task among a, b — a cycle slipped through";
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", reasons: [reason], layers: null });
      expect(readDraft(x.store, "r", 3)).toMatchObject({ state: "failed", reasonCode: "split-validation-exhausted", reasons: [reason] });
      // The point of the issue: no call is left in motion, so nothing holds the requirement.
      expect(x.runs().map((run) => run.active)).toEqual([0, 0, 0]);
      // The person's retry drafts again, and this time the layers compute.
      graphFails.on = false;
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: true } });
      await x.until(() => readDraft(x.store, "r", 4).state !== "drafting");
      expect(latestDraft(x.store, "r")).toMatchObject({ draftNo: 4, state: "awaiting-review" });
    } finally { graphFails.on = false; await x.dispose(); }
  });

  it("can be archived once it failed", async () => {
    graphFails.on = true;
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => ({ purpose: "split" as const, output: VALID_SPLIT })), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 3).state === "failed");
      expect(x.service.archiveGroup(x.command("archive-group", {}))).toMatchObject({ result: { kind: "archived", groupId: "r" } });
    } finally { graphFails.on = false; await x.dispose(); }
  });
});
