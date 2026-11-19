import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { normalizeControlPlan, writeImportedPlan } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, legacyProfileHash, resolveProfile } from "../../src/control/profiles.js";
import { readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readSchedulerControlPlanSource } from "../../src/scheduler/planFile.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";

// #381 review C1 (session 3ba26002): a group last estimated before the binding hash names its estimator by the legacy
// hash; the Web budget editor sends that frozen hash back on a re-estimate, and the router accepts it through the alias.
// The new estimate record must name the binding hash its request and contract froze, or every read of the group refuses
// it (queries.ts readEstimateRecord) and the claim refuses it (webService.ts claimEstimate). The same holds for an import
// whose payload carries the legacy hash. (Reviewer's probe, made a criterion.)
const LEGACY = legacyProfileHash(profileSnapshot());

async function fixture() {
  const h = await webFixture(undefined, undefined, { tokenPolicy: "optional-v1" });
  const router = createExecutionProfileRouter([h.frozen], { aliases: new Map([[LEGACY, h.frozen.profileHash]]) });
  const deps = { ...h.deps, profileRouter: router };
  return { h, deps, router };
}

describe("an estimate bound through a legacy hash records the binding hash (#381 review C1)", () => {
  it("a re-estimate carrying the legacy hash writes a record every read accepts, and its estimate is claimed", async () => {
    const { h, deps } = await fixture();
    try {
      const service = new WebControlService(deps as never);
      const answer = await service.createEstimate(h.command("estimate", { proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, estimatorProfileId: "all", estimatorProfileHash: LEGACY, estimateMode: "soft" })) as { result?: { estimateId?: string; estimateState?: string } };
      expect(answer.result?.estimateState).toBe("queued");
      const id = answer.result!.estimateId!;
      // mutation: store the payload's hash on the record again -> recovery-blocked here
      const record = readEstimateRecord(h.store, "g", id);
      expect([record.profile?.profileHash, record.request?.estimatorProfile.profileHash]).toEqual([h.frozen.profileHash, h.frozen.profileHash]);
      expect(await service.claimEstimate("g", id)).toMatchObject({ state: "starting" });
    } finally { await h.dispose(); }
  });

  it("an import carrying the legacy hash writes a record every read accepts", async () => {
    const { h, deps } = await fixture();
    try {
      const plan = normalizeControlPlan({ ...readSchedulerControlPlanSource(h.deps.trustedConfig.resolveTarget()), repoId: "repo", planId: "plan" });
      const observed = h.frozen.snapshot.profile.capabilities;
      const written = writeImportedPlan({ ...deps, estimatorObservation: (profile: unknown) => ({ profile, observed, probeFailureCode: null, resolution: fixtureResolutionFor(observed, "v1") }) } as never,
        { groupId: "g2", repoId: "repo", planId: "plan", plan, actorId: "human", commandId: "import-g2", estimatorProfileId: "all", estimatorProfileHash: LEGACY, estimateMode: "soft" }, null, { estimate: "preflight" });
      expect(written.estimateId).not.toBe(null);
      // mutation: store input.estimatorProfileHash on the import's record again -> recovery-blocked here
      expect(readEstimateRecord(h.store, "g2", written.estimateId!).profile?.profileHash).toBe(h.frozen.profileHash);
    } finally { await h.dispose(); }
  });

  // #381 review I2: the #144 dedupe compares the newest blocked estimate's profile with the payload's through the router's
  // aliases, so a repeat naming the same profile by its other hash answers the same blocked estimate.
  it("a repeated blocked estimate naming the profile by its legacy hash answers the same one (#144)", async () => {
    const h = await webFixture();
    try {
      const unused = async (): Promise<never> => { throw new Error("unused"); };
      const refusing: ExecutionPort = { resolveAgent: async () => { throw new ControlError("agent-installation-missing"); }, listAgents: unused, readEvidence: unused, accept: unused, inspect: unused, requestHandoff: unused, collect: unused };
      const profile = resolveProfile(profileSnapshot(), refusing);
      const router = createExecutionProfileRouter([profile], { aliases: new Map([[LEGACY, profile.profileHash]]) });
      const service = new WebControlService({ ...h.deps, profileRouter: router });
      const estimate = (hash: string) => service.createEstimate(h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: hash, estimateMode: "soft" })) as Promise<{ result?: { estimateId?: string; estimateState?: string } }>;
      const first = await estimate(profile.profileHash);
      expect(first.result?.estimateState).toBe("blocked-capability");
      // mutation: drop the aliases from the dedupe comparison -> a new version, red
      expect((await estimate(LEGACY)).result?.estimateId).toBe(first.result!.estimateId);
    } finally { await h.dispose(); }
  });
});
