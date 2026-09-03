import { describe, expect, it } from "vitest";
import { planReconciliation } from "../../../src/scheduler/reconcile.js";
import { requiredChecksUnion } from "../../../src/scheduler/writeSet.js";
import { contractObject, makeSandbox } from "../sandbox.js";

describe("S4 (spec 5.3)", () => {
  it("S4: an empty requiredChecks union refuses automatic reconciliation and escalates", async () => {
    // Both sides declaring no checks makes the union empty, so any reconciliation
    // "passes" -- green that is empty, and automatically generated at that.
    //
    // 🔴 ccloop's own contract schema is `requiredChecks: z.array(z.string())
    // .min(1)` (ccloop/src/contract/schema.ts:65), so a contract ccloop would
    // accept can never contribute an empty union: the `requiredChecks: []`
    // below is DELIBERATELY invalid by ccloop's rules. The branch is reachable
    // anyway because subsystem C reads contract files as opaque JSON and never
    // validates them against that schema, which is exactly what makes the check
    // worth having -- it catches at plan time what would otherwise cost a spawn
    // to discover. Without this note a later reader concludes it is dead code.
    const s = await makeSandbox();
    try {
      const noChecks = await contractObject(s, "T1", { goal: "no checks at all", targetPaths: ["src/a.ts"], requiredChecks: [] });
      const withChecks = await contractObject(s, "T2", { goal: "one real check", targetPaths: ["src/a.ts"], requiredChecks: ["true"] });

      expect(requiredChecksUnion(noChecks, noChecks)).toEqual([]);
      expect(planReconciliation(noChecks, noChecks).escalate).toBe(true);

      // A planner that escalated unconditionally would pass the line above and
      // would also refuse every conflict this design exists to reconcile, so
      // the criterion has to measure both answers.
      expect(planReconciliation(noChecks, withChecks).escalate).toBe(false);
    } finally {
      await s.cleanup();
    }
  });
});
