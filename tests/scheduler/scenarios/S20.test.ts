import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MaterialisedConflict } from "../../../src/scheduler/reconcile.js";
import { synthesizeReconcileContract } from "../../../src/scheduler/reconcile.js";
import type { PlanTask } from "../../../src/scheduler/planFile.js";
import { contractObject, makeSandbox } from "../sandbox.js";
import type { Sandbox } from "../sandbox.js";

const side = (taskId: string): PlanTask => ({ taskId, contract: `/outside/${taskId}.json`, dependsOn: [] });

// Hand-built rather than materialised through git, and deliberately so: the
// refusal under test happens before a single field of this is read, so a real
// conflict here would only make the test slower and imply the refusal depends
// on one. The fields are still the real shape, because the non-escalating half
// of each criterion does read them.
const conflictIn = (s: Sandbox): MaterialisedConflict => ({
  copyPath: join(s.runsDir, "r1", "repo"),
  wTip: "0".repeat(40),
  incomingRef: "refs/orca/r1",
  conflictedPaths: ["src/a.ts"],
  conflictCommit: "1".repeat(40),
  blocks: [],
});

describe("S20 (spec 5.2)", () => {
  it("S20: a reconciliation contract that names only one side's taskId is refused, and the run escalates", async () => {
    // "Not the conflicting party" cannot be enforced by process boundaries -- it
    // is the same model, possibly the same context. What can be enforced is the
    // context it is given: a contract carrying only one side's goal is, by
    // construction, the conflicting party's view. That difference is mechanical,
    // so it is a check.
    const s = await makeSandbox();
    try {
      const conflict = conflictIn(s);
      const t1 = await contractObject(s, "T1", { goal: "rename the helper", targetPaths: ["src/a.ts"], requiredChecks: ["true"] });
      const t2 = await contractObject(s, "T2", { goal: "inline the helper", targetPaths: ["src/a.ts"], requiredChecks: ["true"] });
      const contractsMissingOneSide = new Map<string, unknown>([["T1", t1]]);

      const r = await synthesizeReconcileContract(side("T1"), side("T2"), contractsMissingOneSide, s.runsDir, conflict);

      expect("escalate" in r).toBe(true);
      // Names the side it could not see. A refusal that said only "cannot
      // reconcile" would satisfy the line above just as well, and would also
      // be satisfied by a function that refuses everything -- which the next
      // assertion is here to rule out.
      expect((r as { escalate: string }).escalate).toContain("T2");

      const bothSides = new Map<string, unknown>([["T1", t1], ["T2", t2]]);
      const ok = await synthesizeReconcileContract(side("T1"), side("T2"), bothSides, s.runsDir, conflict);
      expect("escalate" in ok).toBe(false);
    } finally {
      await s.cleanup();
    }
  });

  it("S20: a side that declares no execution budget is refused for the same reason", async () => {
    // The other half of "the context it is given". maxAttempts, the timeouts
    // and the token budget are the only numbers saying how much the
    // reconciliation may spend, and neither side's is the scheduler's to
    // invent -- 0.1 forbids exactly that kind of quiet substitution. A
    // contract missing them is a side that contributed nothing to size the
    // work, so it is refused rather than silently given a made-up budget.
    const s = await makeSandbox();
    try {
      const t1 = await contractObject(s, "T1", { goal: "rename the helper", targetPaths: ["src/a.ts"], requiredChecks: ["true"] });
      const t2 = await contractObject(s, "T2", { goal: "inline the helper", targetPaths: ["src/a.ts"], requiredChecks: ["true"] });
      const budgetless = { ...(t2 as Record<string, unknown>) };
      delete budgetless.executionPolicy;

      const r = await synthesizeReconcileContract(
        side("T1"),
        side("T2"),
        new Map<string, unknown>([["T1", t1], ["T2", budgetless]]),
        s.runsDir,
        conflictIn(s),
      );

      expect("escalate" in r).toBe(true);
      expect((r as { escalate: string }).escalate).toContain("T2");
    } finally {
      await s.cleanup();
    }
  });
});
