import { describe, expect, it } from "vitest";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// OMP single call (spec 2026-10-14 §4): clarify and split are single calls too, so they send the same bound as the estimate --
// the larger of the preflight's cap and the agent's own -- or ccloop's spawn check refuses every omp call whose catalog
// cap is above the preflight's. The bound is frozen at requirement-open with the rest of the requirement (DR8).
const open = (groupId: string) => ({
  schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId },
  payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", contentLanguage: "zh" },
}) as never;

describe("clarify and split send the estimate's output bound", () => {
  it("freezes the agent's cap as the requirement's maxOutputTokens when it is above the preflight value, and the preflight value otherwise", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      for (const [groupId, cap, expected] of [["cap-high", 100_000, 100_000], ["cap-low", 1_000, 64_000], ["cap-null", null, 64_000]] as const) {
        const port = { ...x.fake.port, resolveAgent: async (partial: Parameters<typeof x.fake.port.resolveAgent>[0]) => ({ ...await x.fake.port.resolveAgent(partial), singleCallOutputCap: cap }) };
        const profile = resolveProfile(profileSnapshot(), port);
        const service = new WebControlService({ ...x.service.deps, profileRouter: createExecutionProfileRouter([profile]),
          defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: profile.profileHash, estimateMode: "strict" as const }) });
        expect(await service.openRequirement(open(groupId))).toMatchObject({ result: { kind: "requirement-opened", groupId } });
        expect([groupId, readRequirementGroup(x.store, groupId).requirement.maxOutputTokens]).toEqual([groupId, expected]);
      }
    } finally { await x.dispose(); }
  });
});
