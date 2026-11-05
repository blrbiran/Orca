// Session 3cfc2e73, issue #144: `group estimate` on a group whose estimator does not resolve added a new blocked
// version on every call (no token is spent either way, but the history filled with identical rows). While nothing has
// changed, the newest blocked estimate is the answer; any change (mode, the estimator resolving) still adds a version.
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { WebControlService } from "../../src/control/webService.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

const refusingPort = (): ExecutionPort => {
  const unused = async (): Promise<never> => { throw new Error("unused"); };
  return { resolveAgent: async () => { throw new ControlError("agent-installation-missing"); }, listAgents: unused, readEvidence: unused, accept: unused, inspect: unused, requestHandoff: unused, collect: unused };
};

describe("a blocked estimate is not duplicated (#144)", () => {
  it("a repeated estimate with the same estimator refusal answers the newest blocked one; a changed mode adds a version", async () => {
    const h = await webFixture(); try {
      const refusing = createExecutionProfileRouter([resolveProfile(profileSnapshot(), refusingPort())]);
      const service = new WebControlService({ ...h.deps, profileRouter: refusing });
      const count = () => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM estimates WHERE group_id='g'").get()!.n);
      const estimate = (mode: "soft" | "strict") => service.createEstimate(h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: mode }));
      const before = count();
      const first = await estimate("soft");
      expect(first).toMatchObject({ result: { kind: "estimate-created", estimateState: "blocked-capability", reasonCode: "agent-selection-rejected:estimator:agent-installation-missing", wakeId: null } });
      expect(count()).toBe(before + 1);
      const second = await estimate("soft");
      expect(count()).toBe(before + 1);
      if (!("result" in first) || !("result" in second)) throw new Error("estimate refused");
      expect(second.result).toEqual(first.result);
      // A different mode is a different request: it gets its own version.
      const strict = await estimate("strict");
      expect(count()).toBe(before + 2);
      expect(strict).toMatchObject({ result: { estimateState: "blocked-capability" } });
      // Once the estimator resolves, the estimate is queued as a new version, as before.
      const queued = await new WebControlService(h.deps).createEstimate(h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "strict" }));
      expect(queued).toMatchObject({ result: { estimateState: "queued" } });
      expect(count()).toBe(before + 3);
    } finally { await h.dispose(); }
  });
});
